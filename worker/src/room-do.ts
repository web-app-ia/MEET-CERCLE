// ---------------------------------------------------------------------------
// RoomDO — état transactionnel d'un salon (un DO par salon, idempotence et
// verrous garantis par le modèle d'exécution mono-thread du DO).
//
// Rôles (devis V4 §2, §3.3) :
//  - présence des participants + signalisation P2P (relais SDP/ICE/chat)
//  - décision de bascule P2P → SFU (seuil P2P_MAX_PARTICIPANTS)
//  - verrou d'unicité du provisionnement (jamais deux créations simultanées)
//  - anti-suppression : vérification participants/flux avant destruction
//  - phase "sfu" persistée : survit à un redémarrage du DO (pas d'orphelin)
// ---------------------------------------------------------------------------

import type { Env } from "./config";
import { iceServers, p2pMaxParticipants } from "./config";
import { participantToken } from "./livekit";
import { destroySfu, logEvent, provisionSfu } from "./orchestrator";
import type {
  JoinResponse,
  Participant,
  RoomPhase,
  RTCIceServerLite,
  SignalMessage,
  SfuInfo,
} from "./types";

interface RoomState {
  phase: RoomPhase;
  createdAt: number;
  sfu: SfuInfo | null;
  provisionStartedAt: number | null;
  provisionCooldownUntil: number | null;
  provisionError: string | null;
  lastActivity: number;
  lastEmptyAt: number | null;
}

const ACTIVE_WINDOW_MS = 90_000; // présence considérée active si vu < 90 s
const STALE_PARTICIPANT_MS = 10 * 60_000; // purge des entrées fantômes

export class RoomDO implements DurableObject {
  private roomName: string;
  private participants = new Map<string, Participant>();
  private stateLoaded = false;

  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    this.roomName = ctx.id.name ?? "unknown";
  }

  // --- État persistant -----------------------------------------------------

  private async loadState(): Promise<RoomState> {
    const st = (await this.ctx.storage.get<RoomState>("roomState")) ?? null;
    if (st) return st;
    const fresh: RoomState = {
      phase: "p2p",
      createdAt: Date.now(),
      sfu: null,
      provisionStartedAt: null,
      provisionCooldownUntil: null,
      provisionError: null,
      lastActivity: Date.now(),
      lastEmptyAt: Date.now(),
    };
    await this.ctx.storage.put("roomState", fresh);
    return fresh;
  }

  private async saveState(st: RoomState): Promise<void> {
    st.lastActivity = Math.max(st.lastActivity, Date.now());
    await this.ctx.storage.put("roomState", st);
  }

  private async loadParticipants(): Promise<void> {
    if (this.stateLoaded) return;
    const list = (await this.ctx.storage.get<Array<[string, Participant]>>("participants")) ?? [];
    this.participants = new Map(list);
    this.stateLoaded = true;
  }

  private async saveParticipants(): Promise<void> {
    await this.ctx.storage.put("participants", Array.from(this.participants.entries()));
  }

  // --- Routage HTTP ----------------------------------------------------------

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    await this.loadParticipants();

    if (req.method === "POST" && path === "/join") {
      return this.handleJoin(req);
    }
    if (req.method === "GET" && path === "/ws") {
      return this.handleWebSocketUpgrade(req, url);
    }
    if (req.method === "POST" && path === "/heartbeat") {
      return this.handleHeartbeat(req);
    }
    if (req.method === "POST" && path === "/leave") {
      return this.handleLeave(req);
    }
    if (req.method === "GET" && path === "/state") {
      const st = await this.loadState();
      return Response.json({
        room: this.roomName,
        phase: st.phase,
        participantCount: this.activeCount(),
        totalParticipants: this.participants.size,
        lastActivity: st.lastActivity,
        lastEmptyAt: st.lastEmptyAt,
        sfu: st.sfu,
        provisionError: st.provisionError,
      });
    }
    if (req.method === "POST" && path === "/destroy") {
      return this.handleDestroy();
    }
    return new Response("Not found in RoomDO", { status: 404 });
  }

  // --- Join -------------------------------------------------------------------

  private async handleJoin(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as { identity?: string };
    const identity = (body.identity || "").trim().slice(0, 64) || `invité-${Math.floor(Math.random() * 9000 + 1000)}`;
    const st = await this.loadState();

    // Purge des fantômes avant décision
    await this.purgeStale();

    // --- Décision P2P / SFU (devis §2) -------------------------------------
    const max = p2pMaxParticipants(this.env);
    const count = this.participants.size;
    let sfuPending = false;

    if (st.phase === "p2p" && count + 1 > max) {
      if (st.provisionCooldownUntil && Date.now() < st.provisionCooldownUntil) {
        sfuPending = false; // échec récent : on reste en P2P (dégradé mais fonctionnel)
      } else {
        await this.startProvisioning(st);
        sfuPending = true;
      }
    } else if (st.phase === "provisioning") {
      sfuPending = true;
    }

    const stNow = await this.loadState();

    const pid = crypto.randomUUID();
    this.participants.set(pid, {
      id: pid,
      identity,
      joinedAt: Date.now(),
      lastSeen: Date.now(),
    });
    await this.saveParticipants();
    await this.saveState(stNow);

    const iceServers = this.iceServersList();
    const resp: JoinResponse = {
      room: this.roomName,
      identity,
      participantId: pid,
      mode: stNow.phase === "sfu" ? "sfu" : "p2p",
      phase: stNow.phase,
      wsUrl: null,
      sfu: null,
      sfuPending,
      participants: Array.from(this.participants.values())
        .filter((p) => p.id !== pid)
        .map((p) => ({ id: p.id, identity: p.identity })),
      iceServers,
    };

    if (stNow.phase === "sfu" && stNow.sfu) {
      resp.sfu = {
        url: stNow.sfu.wsUrl,
        token: await participantToken(this.env, identity, this.roomName),
      };
    } else {
      // P2P : la signalisation passe par ce DO
      resp.wsUrl = `/api/rooms/${this.roomName}/ws?pid=${encodeURIComponent(pid)}&identity=${encodeURIComponent(identity)}`;
    }

    await logEvent(this.env, this.roomName, "participant_joined", {
      pid,
      identity,
      phase: stNow.phase,
      count: this.participants.size,
    });
    return Response.json(resp);
  }

  private iceServersList(): RTCIceServerLite[] {
    return iceServers(this.env) as RTCIceServerLite[];
  }

  private async startProvisioning(st: RoomState): Promise<void> {
    st.phase = "provisioning";
    st.provisionStartedAt = Date.now();
    st.provisionError = null;
    await this.saveState(st);
    await logEvent(this.env, this.roomName, "sfu_requested", { count: this.participants.size });

    this.ctx.waitUntil(
      (async () => {
        try {
          const { sfu } = await provisionSfu(this.env, this.roomName);
          const stNow = await this.loadState();
          if (stNow.phase === "provisioning") {
            stNow.phase = "sfu";
            stNow.sfu = sfu;
            await this.saveState(stNow);
            this.broadcast({ type: "sfu-ready", host: sfu.host, url: sfu.wsUrl });
            await logEvent(this.env, this.roomName, "sfu_active", { host: sfu.host });
          } else if (stNow.phase === "closing" || stNow.phase === "closed") {
            // Le salon est mort pendant le provisionnement : on détruit le SFU
            await destroySfu(this.env, this.roomName, sfu).catch(() => undefined);
          }
        } catch (err) {
          const stNow = await this.loadState();
          if (stNow.phase === "provisioning") {
            stNow.phase = "p2p";
            stNow.provisionError = String(err);
            stNow.provisionCooldownUntil = Date.now() + 120_000;
            await this.saveState(stNow);
            await logEvent(this.env, this.roomName, "sfu_provision_error", { error: String(err) });
          }
        }
      })(),
    );
  }

  // --- WebSocket (signalisation P2P) ------------------------------------------

  private async handleWebSocketUpgrade(req: Request, url: URL): Promise<Response> {
    const pid = url.searchParams.get("pid") ?? "";
    const identity = url.searchParams.get("identity") ?? "invité";
    if (!pid || !this.participants.has(pid)) {
      return new Response("Participant inconnu — refaites /join", { status: 401 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [`pid:${pid}`, `identity:${identity}`]);
    // Marquer présent dès l'ouverture
    const p = this.participants.get(pid);
    if (p) p.lastSeen = Date.now();
    await this.saveParticipants();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    await this.loadParticipants();
    let msg: SignalMessage;
    try {
      msg = JSON.parse(message) as SignalMessage;
    } catch {
      return;
    }
    const tags = this.ctx.getTags(ws);
    const pidTag = tags.find((t) => t.startsWith("pid:"));
    const from = pidTag ? pidTag.slice(4) : "";
    const me = this.participants.get(from);
    if (me) me.lastSeen = Date.now();

    switch (msg.type) {
      case "hello": {
        ws.send(
          JSON.stringify({
            type: "peers",
            from,
            peers: Array.from(this.participants.values())
              .filter((p) => p.id !== from)
              .map((p) => ({ id: p.id, identity: p.identity })),
          } satisfies SignalMessage),
        );
        this.broadcastExcept(
          { type: "peer-joined", from, identity: me?.identity ?? "invité" },
          from,
        );
        this.broadcastPresence();
        break;
      }
      case "heartbeat":
        break; // lastSeen déjà mis à jour
      case "offer":
      case "answer":
      case "ice": {
        if (!msg.to) break;
        this.sendTo(msg.to, { ...msg, from });
        break;
      }
      case "chat": {
        const text = String((msg as { text?: string }).text ?? "").slice(0, 2000);
        this.broadcast({ type: "chat", from, text, ts: Date.now() });
        break;
      }
      default:
        break;
    }
    const st = await this.loadState();
    st.lastActivity = Date.now();
    await this.saveState(st);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.loadParticipants();
    const tags = this.ctx.getTags(ws);
    const pidTag = tags.find((t) => t.startsWith("pid:"));
    if (!pidTag) return;
    const pid = pidTag.slice(4);
    this.participants.delete(pid);
    await this.saveParticipants();
    this.broadcast({ type: "peer-left", from: pid });
    this.broadcastPresence();
    if (this.participants.size === 0) {
      const st = await this.loadState();
      st.lastEmptyAt = Date.now();
      await this.saveState(st);
      await logEvent(this.env, this.roomName, "room_empty");
    }
  }

  // --- Présence / heartbeat / leave ---------------------------------------------

  private async handleHeartbeat(req: Request): Promise<Response> {
    const { pid } = (await req.json().catch(() => ({}))) as { pid?: string };
    if (pid && this.participants.has(pid)) {
      const p = this.participants.get(pid)!;
      p.lastSeen = Date.now();
      await this.saveParticipants();
    }
    return Response.json({ ok: true });
  }

  private async handleLeave(req: Request): Promise<Response> {
    const { pid } = (await req.json().catch(() => ({}))) as { pid?: string };
    if (pid && this.participants.has(pid)) {
      this.participants.delete(pid);
      await this.saveParticipants();
      this.broadcast({ type: "peer-left", from: pid });
      this.broadcastPresence();
      if (this.participants.size === 0) {
        const st = await this.loadState();
        st.lastEmptyAt = Date.now();
        await this.saveState(st);
      }
      await logEvent(this.env, this.roomName, "participant_left", { pid });
    }
    return Response.json({ ok: true });
  }

  // --- Sweep / destruction (devis §8 étapes 8–9) ---------------------------------

  private activeCount(): number {
    const now = Date.now();
    let n = 0;
    for (const p of this.participants.values()) {
      if (now - p.lastSeen < ACTIVE_WINDOW_MS) n++;
    }
    return n;
  }

  private async purgeStale(): Promise<void> {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.participants) {
      if (now - p.lastSeen > STALE_PARTICIPANT_MS) {
        this.participants.delete(id);
        changed = true;
      }
    }
    if (changed) await this.saveParticipants();
  }

  /**
   * Double vérification avant destruction : aucun participant actif + délai
   * de sécurité écoulé. Appelée par le cron (sweep) qui a déjà vu l'état vide.
   */
  private async handleDestroy(): Promise<Response> {
    const st = await this.loadState();
    await this.purgeStale();
    const active = this.activeCount();
    if (active > 0) {
      return Response.json({ destroyed: false, reason: "participants_actifs", active });
    }
    if (!st.sfu) {
      return Response.json({ destroyed: false, reason: "aucun_sf" });
    }
    if (st.phase === "closing" || st.phase === "closed") {
      return Response.json({ destroyed: false, reason: `deja_${st.phase}` });
    }
    st.phase = "closing";
    await this.saveState(st);
    try {
      await destroySfu(this.env, this.roomName, st.sfu);
      st.phase = "closed";
      st.sfu = null;
      await this.saveState(st);
      await logEvent(this.env, this.roomName, "room_closed");
      return Response.json({ destroyed: true });
    } catch (err) {
      // On revient en "sfu" pour retenter au prochain sweep
      st.phase = "sfu";
      await this.saveState(st);
      return Response.json({ destroyed: false, reason: "erreur", error: String(err) }, { status: 500 });
    }
  }

  // --- Diffusion -------------------------------------------------------------------

  private broadcast(msg: SignalMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        // socket fermée : le close handler fera le ménage
      }
    }
  }

  private broadcastExcept(msg: SignalMessage, exceptPid: string): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const tags = this.ctx.getTags(ws);
      const pidTag = tags.find((t) => t.startsWith("pid:"));
      if (pidTag && pidTag.slice(4) === exceptPid) continue;
      try {
        ws.send(data);
      } catch {
        // idem
      }
    }
  }

  private sendTo(pid: string, msg: SignalMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets(`pid:${pid}`)) {
      try {
        ws.send(data);
      } catch {
        // idem
      }
    }
  }

  private broadcastPresence(): void {
    const now = Date.now();
    const count = Array.from(this.participants.values()).filter(
      (p) => now - p.lastSeen < ACTIVE_WINDOW_MS,
    ).length;
    this.broadcast({ type: "presence", count });
  }
}
