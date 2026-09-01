// ---------------------------------------------------------------------------
// Orchestrateur SFU éphémère : cycle complet création → utilisation →
// destruction (devis V4, §8).
//
//  1. Provisionnement : Hetzner CPX22 (IPv6-first, IPv4 conditionnelle)
//  2. DNS : record AAAA/A éphémère chez Cloudflare (record gris, non proxifié)
//  3. Initialisation : cloud-init → LiveKit ; on attend la santé du service
//  4. Destruction : serveur Hetzner + records DNS, avec double vérification
//     effectuée par le RoomDO (aucun participant / flux actif)
//
// Toutes les étapes sont journalisées dans KV (traçabilité, devis §14).
// ---------------------------------------------------------------------------

import type { SfuInfo } from "./types";
import type { Env } from "./config";
import { shortId } from "./config";
import {
  createSfuServer,
  deleteServer,
  getServer,
  renderCloudInit,
  waitForServerStatus,
} from "./hetzner";
import { createDnsRecord, deleteDnsRecord } from "./cloudflare-dns";
import { isLiveKitHealthy } from "./livekit";

export async function logEvent(
  env: Env,
  room: string,
  type: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  const ts = Date.now();
  await env.STATE.put(`event:${ts}:${shortId(6)}`, JSON.stringify({ ts, room, type, detail }), {
    expirationTtl: 60 * 60 * 24 * 30, // rétention 30 jours (à aligner sur la politique légale)
  });
}

/** Découpe l'IPv6 Hetzner ("2a01:4f8:c012:1234::1/64") en adresse brute. */
function bareIp(cidr: string): string {
  return cidr.split("/")[0];
}

export interface ProvisionResult {
  sfu: SfuInfo;
}

/**
 * Provisionne un SFU complet pour un salon. Coût cible ~0,0312 €/h (CPX22
 * IPv6-only) ; l'appelant (RoomDO) garantit l'unicité via son verrou.
 * Durée typique : 60–180 s (démarrage à froid, devis §15).
 */
export async function provisionSfu(env: Env, room: string): Promise<ProvisionResult> {
  if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    throw new Error("LIVEKIT_API_KEY / LIVEKIT_API_SECRET requis pour le provisionnement");
  }
  const sfuId = shortId(8);
  const host = `sfu-${sfuId}.${env.SFU_DOMAIN}`;
  const netPolicy = env.SFU_NET_POLICY || "ipv6_only";
  const enableIpv4 = netPolicy === "dual_stack";
  const serverName = `meet-sfu-${room}-${sfuId}`.slice(0, 63);

  await logEvent(env, room, "sfu_provision_start", { host, netPolicy, serverName });

  let server: { id: number; ipv6: string; ipv4?: string | null } | null = null;
  let dnsRecordId: string | null = null;
  let dnsRecordIdV4: string | null = null;

  try {
    // --- 1. Création du serveur Hetzner -----------------------------------
    const userData = renderCloudInit({
      domain: host,
      livekitKeys: { key: env.LIVEKIT_API_KEY, secret: env.LIVEKIT_API_SECRET },
      region: env.SFU_LOCATION,
      nodeIp: "", // renseigné dynamiquement : LiveKit déduit l'IP externe (use_external_ip)
      enableLivekitTurn: netPolicy === "ipv6_plus_turn_embedded",
      corsOrigins: [],
    });

    const created = await createSfuServer(env, {
      name: serverName,
      serverType: env.SFU_SERVER_TYPE || "cpx22",
      location: env.SFU_LOCATION || "fsn1",
      image: env.SFU_IMAGE || "ubuntu-24.04",
      enableIpv4,
      userData,
      labels: { app: "meet-cercle", room, ephemeral: "true" },
    });

    const running = await waitForServerStatus(env, created.id, "running");
    const ipv6 = bareIp(running.public_net.ipv6.ip);
    const ipv4 = running.public_net.ipv4 ? bareIp(running.public_net.ipv4.ip) : null;
    server = { id: running.id, ipv6, ipv4 };

    await logEvent(env, room, "sfu_server_running", {
      serverId: running.id,
      ipv6,
      ipv4: ipv4 ?? undefined,
    });

    // --- 2. DNS éphémère ---------------------------------------------------
    dnsRecordId = (await createDnsRecord(env, { name: host, type: "AAAA", content: ipv6 })).id;
    if (enableIpv4 && ipv4) {
      dnsRecordIdV4 = (await createDnsRecord(env, { name: host, type: "A", content: ipv4 })).id;
    }

    // --- 3. Attente de la santé LiveKit ------------------------------------
    const deadline = Date.now() + 180000;
    let healthy = false;
    while (Date.now() < deadline) {
      if (await isLiveKitHealthy(host, env)) {
        healthy = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 10000));
    }
    if (!healthy) throw new Error(`LiveKit injoignable sur ${host} après 180 s`);

    const sfu: SfuInfo = {
      host,
      wsUrl: `wss://${host}`,
      serverId: running.id,
      dnsRecordId,
      dnsRecordIdV4,
      createdAt: Date.now(),
      netPolicy,
      serverType: env.SFU_SERVER_TYPE || "cpx22",
    };
    await logEvent(env, room, "sfu_ready", { host, serverId: running.id, durationMs: Date.now() - sfu.createdAt });
    return { sfu };
  } catch (err) {
    // --- Échec : nettoyage best-effort de toute ressource créée ------------
    await logEvent(env, room, "sfu_provision_failed", {
      error: String(err),
      serverId: server?.id,
      dnsRecordId,
    });
    if (dnsRecordId) await deleteDnsRecord(env, dnsRecordId).catch(() => undefined);
    if (dnsRecordIdV4) await deleteDnsRecord(env, dnsRecordIdV4).catch(() => undefined);
    if (server) await deleteServer(env, server.id).catch(() => undefined);
    throw err;
  }
}

/**
 * Destruction d'un SFU (devis §8 étapes 8–9). L'appelant (RoomDO / sweep)
 * a déjà vérifié : salon vide, délai de sécurité écoulé. Double vérification
 * de l'état Hetzner avant suppression (anti double-destroy).
 */
export async function destroySfu(env: Env, room: string, sfu: SfuInfo): Promise<void> {
  await logEvent(env, room, "sfu_destroy_start", { serverId: sfu.serverId, host: sfu.host });
  try {
    const srv = await getServer(env, sfu.serverId);
    if (srv && srv.status !== "deleting") {
      await deleteServer(env, sfu.serverId);
    }
    if (sfu.dnsRecordId) await deleteDnsRecord(env, sfu.dnsRecordId).catch(() => undefined);
    if (sfu.dnsRecordIdV4) await deleteDnsRecord(env, sfu.dnsRecordIdV4).catch(() => undefined);
    await logEvent(env, room, "sfu_destroyed", {
      serverId: sfu.serverId,
      host: sfu.host,
      lifetimeHours: ((Date.now() - sfu.createdAt) / 3600000).toFixed(3),
    });
  } catch (err) {
    await logEvent(env, room, "sfu_destroy_failed", { serverId: sfu.serverId, error: String(err) });
    throw err;
  }
}
