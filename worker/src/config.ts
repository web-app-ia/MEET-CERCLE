// ---------------------------------------------------------------------------
// Configuration : variables wrangler typées + dérivation des URLs
// ---------------------------------------------------------------------------

export interface Env {
  // Bindings
  ROOMS: DurableObjectNamespace;
  STATE: KVNamespace;

  // Vars
  ENVIRONMENT: string;
  P2P_MAX_PARTICIPANTS: string;
  SFU_NET_POLICY: string;
  SFU_SERVER_TYPE: string;
  SFU_LOCATION: string;
  SFU_IMAGE: string;
  SFU_GRACE_PERIOD_MS: string;
  SFU_DOMAIN: string;
  STUN_URLS: string;

  // Secrets
  HETZNER_API_TOKEN?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
  CF_DNS_TOKEN?: string;
  CF_ZONE_ID?: string;
  TURN_URL?: string;
  TURN_TCP_URL?: string;
  TURN_TLS_URL?: string;
  TURN_USERNAME?: string;
  TURN_CREDENTIAL?: string;
}

export function p2pMaxParticipants(env: Env): number {
  const n = parseInt(env.P2P_MAX_PARTICIPANTS ?? "4", 10);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

export function gracePeriodMs(env: Env): number {
  const n = parseInt(env.SFU_GRACE_PERIOD_MS ?? "600000", 10);
  return Number.isFinite(n) && n >= 0 ? n : 600000;
}

/** Construit la liste ICE serveurs renvoyée aux clients. */
export function iceServers(env: Env): Array<{
  urls: string | string[];
  username?: string;
  credential?: string;
}> {
  const list: Array<{ urls: string | string[]; username?: string; credential?: string }> = [];
  try {
    const stuns = JSON.parse(env.STUN_URLS || "[]") as string[];
    if (Array.isArray(stuns) && stuns.length > 0) list.push({ urls: stuns });
  } catch {
    // STUN_URLS mal formé : on ignore silencieusement
  }
  const turnEntries: Array<[string | undefined, boolean]> = [
    [env.TURN_URL, true],
    [env.TURN_TCP_URL, true],
    [env.TURN_TLS_URL, true],
  ];
  for (const [url] of turnEntries) {
    if (url) {
      list.push({
        urls: url,
        ...(env.TURN_USERNAME ? { username: env.TURN_USERNAME } : {}),
        ...(env.TURN_CREDENTIAL ? { credential: env.TURN_CREDENTIAL } : {}),
      });
    }
  }
  return list;
}

/** Génère un identifiant court aléatoire (sans caractères ambigus). */
export function shortId(len = 8): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

const ROOM_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export function newRoomName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let s = "";
  for (let i = 0; i < 10; i++) s += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
  // Format lisible : xxx-xxxx-xx
  return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7, 10)}`;
}

export function isValidRoomName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{2,63}$/.test(name);
}

export function isHex64(token: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(token);
}
