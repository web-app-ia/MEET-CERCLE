// ---------------------------------------------------------------------------
// Types partagés de l'orchestrateur MEET-CERCLE
// ---------------------------------------------------------------------------

export type RoomPhase = "p2p" | "provisioning" | "sfu" | "closing" | "closed";

export interface Participant {
  id: string;
  identity: string;
  joinedAt: number;
  lastSeen: number;
}

export interface SfuInfo {
  /** Nom du host SFU, ex. sfu-abc123.sfu.example.com */
  host: string;
  /** URL WebSocket LiveKit (wss) */
  wsUrl: string;
  /** ID serveur Hetzner */
  serverId: number;
  /** ID du record DNS Cloudflare (AAAA) — pour suppression à la destruction */
  dnsRecordId: string | null;
  /** ID du record DNS A (uniquement en politique dual_stack) */
  dnsRecordIdV4: string | null;
  createdAt: number;
  netPolicy: string;
  serverType: string;
}

export interface JoinResponse {
  room: string;
  identity: string;
  participantId: string;
  mode: "p2p" | "sfu";
  phase: RoomPhase;
  /** En mode P2P : URL WebSocket de signalisation */
  wsUrl: string | null;
  /** En mode SFU (ou lorsque le SFU est prêt) */
  sfu: {
    url: string;
    token: string;
  } | null;
  /** Vrai si un SFU est en cours de provisionnement — le client recevra
   *  un message "sfu_ready" sur la WebSocket de signalisation. */
  sfuPending: boolean;
  participants: Array<{ id: string; identity: string }>;
  iceServers: RTCIceServerLite[];
}

export interface RTCIceServerLite {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface RoomEvent {
  ts: number;
  room: string;
  type: string;
  detail?: Record<string, unknown>;
}

// --- API Hetzner -----------------------------------------------------------

export interface HetznerServer {
  id: number;
  name: string;
  status: string;
  public_net: {
    ipv4: { id: number; ip: string } | null;
    ipv6: { id: number; ip: string };
  };
}

// --- Messages de signalisation P2P (relais via RoomDO) ----------------------

export type SignalMessage =
  | { type: "hello"; from: string; identity: string }
  | { type: "heartbeat"; from?: string }
  | { type: "peers"; from: string; peers: Array<{ id: string; identity: string }> }
  | { type: "peer-joined"; from: string; identity: string }
  | { type: "peer-left"; from: string }
  | { type: "offer"; from: string; to: string; sdp: string }
  | { type: "answer"; from: string; to: string; sdp: string }
  | { type: "ice"; from: string; to: string; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }
  | { type: "chat"; from: string; text: string; ts: number }
  | { type: "sfu-ready"; host: string; url: string }
  | { type: "presence"; count: number };
