// ---------------------------------------------------------------------------
// LiveKit : génération de tokens d'accès (JWT vidéo) + vérification de santé
// Le serveur LiveKit est éphémère (Hetzner) ; sa config est injectée au
// provisionnement via cloud-init (voir infra/cloud-init-livekit.yaml).
// ---------------------------------------------------------------------------

import type { Env } from "./config";
import { signJwtHS256 } from "./jwt";

export interface LiveKitVideoGrant {
  room?: string;
  roomJoin?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
  roomList?: boolean;
  roomCreate?: boolean;
  hidden?: boolean;
}

interface AccessTokenOptions {
  identity: string;
  name?: string;
  room?: string;
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
  grant: LiveKitVideoGrant;
}

/**
 * Génère un token d'accès LiveKit (format officiel : JWT HS256 avec
 * claims vidéo). Voir https://docs.livekit.io/concepts/authentication/
 */
export async function createLiveKitToken(
  env: Env,
  opts: AccessTokenOptions,
): Promise<string> {
  if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    throw new Error("LiveKit API key/secret non configurés (secrets wrangler)");
  }
  const now = Math.floor(Date.now() / 1000);
  const ttl = opts.ttlSeconds ?? 6 * 3600;
  const claims = {
    iss: env.LIVEKIT_API_KEY,
    sub: opts.identity,
    jti: crypto.randomUUID(),
    nbf: now - 10,
    exp: now + ttl,
    name: opts.name ?? opts.identity,
    ...(opts.metadata ? { metadata: JSON.stringify(opts.metadata) } : {}),
    video: opts.grant,
  };
  return signJwtHS256(env.LIVEKIT_API_SECRET, claims);
}

/** Token participant : rejoindre une salle précise. */
export function participantToken(
  env: Env,
  identity: string,
  room: string,
): Promise<string> {
  return createLiveKitToken(env, {
    identity,
    room,
    ttlSeconds: 6 * 3600,
    metadata: { room },
    grant: {
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  });
}

/**
 * Vérifie que le serveur LiveKit répond. On interroge ListRooms (API
 * RoomService, endpoint twirp). Retourne true dès une réponse HTTP 200.
 */
export async function isLiveKitHealthy(host: string, env: Env): Promise<boolean> {
  if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return false;
  const token = await createLiveKitToken(env, {
    identity: "orchestrator-healthcheck",
    ttlSeconds: 120,
    grant: { roomList: true },
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://${host}/twirp/livekit.RoomService/ListRooms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
