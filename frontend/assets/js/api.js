// ---------------------------------------------------------------------------
// Client API MEET-CERCLE
// MEET_CERCLE_API_BASE peut être défini dans index.html pour pointer vers le
// Worker (ex. https://meet-cercle-worker.<compte>.workers.dev) lorsque le
// frontend est hébergé sur un domaine différent.
// ---------------------------------------------------------------------------

export const API_BASE = (window.MEET_CERCLE_API_BASE || "").replace(/\/+$/, "");

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // corps vide
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Erreur HTTP ${res.status}`);
  }
  return data;
}

export function createRoom(name) {
  return request("/api/rooms", { method: "POST", body: JSON.stringify({ name }) });
}

export function joinRoom(room, identity) {
  return request(`/api/rooms/${encodeURIComponent(room)}/join`, {
    method: "POST",
    body: JSON.stringify({ identity }),
  });
}

export function leaveRoom(room, pid) {
  return request(`/api/rooms/${encodeURIComponent(room)}/leave`, {
    method: "POST",
    body: JSON.stringify({ pid }),
  }).catch(() => undefined);
}

export function heartbeat(room, pid) {
  return request(`/api/rooms/${encodeURIComponent(room)}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({ pid }),
  }).catch(() => undefined);
}

export async function getIceServers() {
  try {
    const cfg = await request("/api/config");
    if (cfg && Array.isArray(cfg.iceServers)) return cfg.iceServers;
  } catch {
    // Worker injoignable : STUN public par défaut
  }
  return [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
}

/** Convertit le wsUrl relatif renvoyé par /join en URL absolue. */
export function resolveWsUrl(wsUrl) {
  if (/^wss?:\/\//.test(wsUrl)) return wsUrl;
  if (API_BASE) {
    return `${API_BASE.replace(/^http/, "ws")}${wsUrl}`;
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${wsUrl}`;
}
