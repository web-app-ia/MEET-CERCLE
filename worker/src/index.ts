// ---------------------------------------------------------------------------
// MEET-CERCLE — Worker principal (Cloudflare Workers)
//
// API publique :
//   GET  /api/health                       — sonde
//   GET  /api/config                       — serveurs ICE (STUN/TURN) pour le client
//   POST /api/rooms                        — crée/réserve un salon { name? }
//   GET  /api/rooms/:room                  — état du salon (debug/observabilité)
//   POST /api/rooms/:room/join {identity}  — rejoint : décision P2P/SFU, token
//   WS   /api/rooms/:room/ws               — signalisation P2P (relais RoomDO)
//   POST /api/rooms/:room/heartbeat        — keepalive HTTP (fallback WS)
//   POST /api/rooms/:room/leave            — quitte proprement
//   POST /api/admin/sweep                  — nettoyage manuel (le cron l'appelle)
//
// Cron (*/5) : sweep des salons — destruction des SFU vides au-delà du délai
// de sécurité (devis V4 §8, garde-fous §14).
// ---------------------------------------------------------------------------

import type { Env } from "./config";
import { isValidRoomName, newRoomName, gracePeriodMs, iceServers } from "./config";
import { RoomDO } from "./room-do";
import { logEvent } from "./orchestrator";

export { RoomDO };

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...CORS_HEADERS } });
}

function errorJson(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function roomStub(env: Env, room: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(room));
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" } });
    }

    if (path === "/api/health" && req.method === "GET") {
      return json({ ok: true, service: "meet-cercle-worker", time: new Date().toISOString() });
    }

    if (path === "/api/config" && req.method === "GET") {
      return json({ iceServers: iceServers(env) });
    }

    if (path === "/api/rooms" && req.method === "POST") {
      return handleCreateRoom(req, env);
    }

    const roomMatch = path.match(/^\/api\/rooms\/([a-z0-9-]+)(\/.*)?$/);
    if (roomMatch) {
      const room = roomMatch[1];
      const action = roomMatch[2] ?? "";
      if (!isValidRoomName(room)) return errorJson("Nom de salon invalide", 400);

      if (action === "/join" && req.method === "POST") {
        const res = await roomStub(env, room).fetch("https://do/join", {
          method: "POST",
          body: await req.text(),
        });
        return withCors(res);
      }

      if (action === "/ws" && req.method === "GET") {
        // WebSocket : on transmet tel quel au DO (upgrade géré là-bas)
        const stub = roomStub(env, room);
        const doUrl = new URL(req.url);
        doUrl.pathname = "/ws";
        return stub.fetch(doUrl.toString(), req);
      }

      if (action === "/heartbeat" && req.method === "POST") {
        return withCors(await roomStub(env, room).fetch("https://do/heartbeat", { method: "POST", body: await req.text() }));
      }

      if (action === "/leave" && req.method === "POST") {
        return withCors(await roomStub(env, room).fetch("https://do/leave", { method: "POST", body: await req.text() }));
      }

      if (action === "" && req.method === "GET") {
        return withCors(await roomStub(env, room).fetch("https://do/state"));
      }
    }

    if (path === "/api/admin/sweep" && req.method === "POST") {
      ctx.waitUntil(runSweep(env));
      return json({ ok: true, message: "Sweep lancé (asynchrone)" });
    }

    return errorJson("Route inconnue", 404);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runSweep(env));
  },
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

// --- Création de salon -------------------------------------------------------

async function handleCreateRoom(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  let name = (body.name ?? "").trim().toLowerCase();
  if (name && !isValidRoomName(name)) {
    return errorJson("Nom de salon invalide : 3–64 caractères [a-z0-9-]", 400);
  }
  if (!name) name = newRoomName();

  // Idempotent : recréer un salon existant réinitialise simplement son index.
  const indexKey = `room:${name}`;
  const existing = await env.STATE.get(indexKey);
  if (!existing) {
    await env.STATE.put(
      indexKey,
      JSON.stringify({ createdAt: Date.now(), active: true }),
    );
    await logEvent(env, name, "room_created");
  }
  return json({ room: name, joinUrl: `/room/?room=${encodeURIComponent(name)}` }, existing ? 200 : 201);
}

// --- Sweep (cron + admin) ------------------------------------------------------

interface RoomIndexEntry {
  createdAt: number;
  active: boolean;
}

/**
 * Parcourt les salons actifs et détruit les SFU éligibles :
 *  - salon vide (aucun participant actif selon le DO) ET
 *  - délai de sécurité SFU_GRACE_PERIOD_MS écoulé depuis le dernier vide.
 * La double vérification finale est faite dans le RoomDO (POST /destroy).
 * Les salons sans SFU vides depuis 24 h sont archivés (hygiène KV).
 */
export async function runSweep(env: Env): Promise<{ checked: number; destroyed: number; archived: number }> {
  let checked = 0;
  let destroyed = 0;
  let archived = 0;
  const grace = gracePeriodMs(env);

  let cursor: string | undefined;
  for (;;) {
    const page = await env.STATE.list<RoomIndexEntry>({ prefix: "room:", cursor });
    for (const k of page.keys) {
      const key = k.name;
      const entry = { metadata: k.metadata as RoomIndexEntry | undefined };
      if (!entry.metadata?.active) continue;
      const room = key.slice("room:".length);
      if (!isValidRoomName(room)) continue;
      checked++;
      const stub = roomStub(env, room);
      const res = await stub.fetch("https://do/state");
      if (!res.ok) continue;
      const state = (await res.json()) as {
        phase: string;
        participantCount: number;
        sfu: unknown | null;
        lastEmptyAt: number | null;
      };

      const emptySince = state.lastEmptyAt ?? 0;
      if (state.sfu && state.participantCount === 0 && Date.now() - emptySince > grace) {
        const dRes = await stub.fetch("https://do/destroy", { method: "POST" });
        const dJson = (await dRes.json().catch(() => ({}))) as { destroyed?: boolean };
        if (dJson.destroyed) {
          destroyed++;
          await env.STATE.put(
            key,
            JSON.stringify({ ...entry.metadata, active: false, closedAt: Date.now() }),
          );
          await logEvent(env, room, "sweep_destroyed_sfu");
        }
      } else if (!state.sfu && state.participantCount === 0 && Date.now() - emptySince > 24 * 3600_000) {
        await env.STATE.put(
          key,
          JSON.stringify({ ...entry.metadata, active: false, archivedAt: Date.now() }),
        );
        archived++;
      }
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }

  return { checked, destroyed, archived };
}
