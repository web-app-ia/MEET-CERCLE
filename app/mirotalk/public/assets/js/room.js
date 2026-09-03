// ---------------------------------------------------------------------------
// Contrôleur du salon : médias locaux, choix du mode (P2P/SFU), bascule
// transparente lorsque le SFU éphémère devient disponible, chat, contrôles.
// ---------------------------------------------------------------------------

import { API_BASE, getIceServers, heartbeat, joinRoom, leaveRoom, resolveWsUrl } from "./api.js";
import { P2PSession } from "./p2p.js";
import { SfuSession } from "./sfu.js";

const $ = (sel) => document.querySelector(sel);

const params = new URLSearchParams(location.search);
const ROOM = (params.get("room") || "").trim().toLowerCase();

if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(ROOM)) {
  location.href = "/";
}

const els = {
  roomCode: $("#room-code"),
  modeBadge: $("#mode-badge"),
  presence: $("#presence"),
  banner: $("#banner"),
  grid: $("#video-grid"),
  overlay: $("#join-overlay"),
  joinLabel: $("#join-room-label"),
  preview: $("#preview"),
  mediaError: $("#media-error"),
  identity: $("#join-identity"),
  joinBtn: $("#join-btn"),
  chatLog: $("#chat-log"),
  chatForm: $("#chat-form"),
  chatInput: $("#chat-input"),
  micBtn: $("#mic-btn"),
  camBtn: $("#cam-btn"),
  leaveBtn: $("#leave-btn"),
};

els.roomCode.textContent = ROOM;
els.joinLabel.textContent = `Salon : ${ROOM}`;
els.identity.value = localStorage.getItem("meet-cercle-identity") || "";

// --- État ---------------------------------------------------------------------

let localStream = null;
let session = null; // P2PSession | SfuSession
let myPid = null;
let myIdentity = null;
let iceServers = [];
let micOn = true;
let camOn = true;
let joinInfo = null;
let switching = false;

// --- Vidéo ---------------------------------------------------------------------

function tileFor(id, label, isLocal) {
  let tile = document.getElementById(`tile-${CSS.escape(id)}`);
  if (tile) return tile;
  tile = document.createElement("div");
  tile.className = `tile${isLocal ? " local" : ""}`;
  tile.id = `tile-${CSS.escape(id)}`;
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  if (isLocal) video.muted = true;
  const name = document.createElement("span");
  name.className = "tile-name";
  name.textContent = label;
  tile.append(video, name);
  els.grid.appendChild(tile);
  updateGridColumns();
  return tile;
}

function attachStream(id, label, stream, isLocal) {
  const tile = tileFor(id, label, isLocal);
  const video = tile.querySelector("video");
  if (video.srcObject !== stream) video.srcObject = stream;
}

function removeTile(id) {
  document.getElementById(`tile-${CSS.escape(id)}`)?.remove();
  updateGridColumns();
}

function updateGridColumns() {
  const n = els.grid.children.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  els.grid.style.setProperty("--cols", String(cols));
}

// --- Médias --------------------------------------------------------------------

async function acquireMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      camOn = false;
      els.mediaError.textContent = "Caméra indisponible — mode audio seul.";
      els.mediaError.classList.remove("hidden");
    } catch {
      localStream = null;
      els.mediaError.textContent = "Ni caméra ni micro accessibles — vous rejoindrez en spectateur.";
      els.mediaError.classList.remove("hidden");
    }
  }
  if (localStream) els.preview.srcObject = localStream;
}

// --- Sessions -------------------------------------------------------------------

function handlers() {
  return {
    onPeerDiscovered: (pid, identity) => {
      if (identity) {
        const tile = tileFor(pid, identity, false);
        tile.querySelector(".tile-name").textContent = identity;
      }
    },
    onRemoteStream: (pid, stream, _kind) => {
      // En SFU, l'identity arrive via onPeerDiscovered ; en P2P on retombe sur pid.
      const nameEl = document.querySelector(`#tile-${CSS.escape(pid)} .tile-name`);
      attachStream(pid, nameEl ? nameEl.textContent : pid, stream, false);
    },
    onPeerLeft: (pid) => removeTile(pid),
    onChat: (msg) => addChatLine(msg.from === myPid ? "moi" : msg.from, msg.text),
    onPresence: (count) => setPresence(count),
    onStatus: (s) => setBadge(s),
    onError: (err) => showBanner(`⚠ ${err.message || err}`, true, 5000),
    onDisconnected: () => showBanner("Connexion interrompue. Rechargez la page.", true),
    onSfuReady: (host, url) => onSfuReady(host, url),
  };
}

function setBadge(status) {
  if (status.startsWith("sfu")) {
    els.modeBadge.textContent = "SFU LiveKit";
    els.modeBadge.className = "mode-badge sfu";
  } else {
    els.modeBadge.textContent = "P2P direct";
    els.modeBadge.className = "mode-badge p2p";
  }
}

function setPresence(count) {
  els.presence.textContent = `${count} participant${count > 1 ? "s" : ""}`;
}

let bannerTimer = null;
function showBanner(text, isError = false, ttlMs = 0) {
  els.banner.textContent = text;
  els.banner.className = `banner${isError ? " error" : ""}`;
  if (bannerTimer) clearTimeout(bannerTimer);
  if (ttlMs) bannerTimer = setTimeout(() => els.banner.classList.add("hidden"), ttlMs);
}

function addChatLine(from, text) {
  const line = document.createElement("div");
  line.className = "chat-line";
  const who = document.createElement("b");
  who.textContent = from;
  line.append(who, document.createTextNode(` — ${text}`));
  els.chatLog.appendChild(line);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

// --- Join -----------------------------------------------------------------------

els.joinBtn.addEventListener("click", async () => {
  const identity = els.identity.value.trim();
  if (!identity) {
    els.identity.focus();
    return;
  }
  myIdentity = identity;
  localStorage.setItem("meet-cercle-identity", identity);
  els.joinBtn.disabled = true;
  try {
    iceServers = await getIceServers();
    await join(0);
    els.overlay.classList.add("hidden");
  } catch (err) {
    els.joinBtn.disabled = false;
    showBanner(`Impossible de rejoindre : ${err.message}`, true);
  }
});

async function join(attempt) {
  joinInfo = await joinRoom(ROOM, myIdentity);
  myPid = joinInfo.participantId;
  tileFor(myPid, myIdentity, true);
  if (localStream) attachStream(myPid, myIdentity, localStream, true);
  setPresence(joinInfo.participants.length + 1);
  await startSession(joinInfo);
  if (joinInfo.sfuPending) {
    showBanner("Serveur HD en cours d'activation (~2 min) — la réunion continue en P2P, bascule automatique à la fin.", false);
  }
  if (attempt > 0) showBanner("Connecté au serveur HD (SFU).", false, 4000);
}

async function startSession(info) {
  if (info.sfu) {
    setBadge("sfu-connecté");
    session = new SfuSession({
      url: info.sfu.url,
      token: info.sfu.token,
      localStream,
      handlers: handlers(),
    });
    await session.connect();
  } else {
    setBadge("p2p");
    session = new P2PSession({
      room: ROOM,
      pid: info.participantId,
      identity: info.identity,
      localStream,
      iceServers,
      wsUrl: resolveWsUrl(info.wsUrl),
      handlers: handlers(),
    });
    session.connect();
  }
}

/**
 * Bascule P2P → SFU : on détruit la session P2P, on récupère un token via
 * /join (le DO renvoie maintenant le SFU), et on connecte LiveKit.
 */
async function onSfuReady(host, _url) {
  if (switching) return;
  switching = true;
  showBanner(`Serveur HD prêt (${host}) — bascule en cours…`, false);
  try {
    session?.close();
    session = null;
    // Nettoyage des tuiles distantes (nouvelle session = nouveaux flux)
    for (const tile of Array.from(els.grid.querySelectorAll(".tile:not(.local)"))) tile.remove();
    await join(1);
  } catch (err) {
    showBanner(`Échec de la bascule SFU : ${err.message}. Rechargez la page.`, true);
  } finally {
    switching = false;
  }
}

// --- Contrôles -------------------------------------------------------------------

els.micBtn.addEventListener("click", () => {
  micOn = !micOn;
  if (session && typeof session.setTrackEnabled === "function") {
    session.setTrackEnabled("audio", micOn);
  } else if (localStream) {
    for (const t of localStream.getAudioTracks()) t.enabled = micOn;
  }
  els.micBtn.classList.toggle("off", !micOn);
});

els.camBtn.addEventListener("click", () => {
  camOn = !camOn;
  if (session && typeof session.setTrackEnabled === "function") {
    session.setTrackEnabled("video", camOn);
  } else if (localStream) {
    for (const t of localStream.getVideoTracks()) t.enabled = camOn;
  }
  els.camBtn.classList.toggle("off", !camOn);
});

els.leaveBtn.addEventListener("click", () => {
  cleanup();
  location.href = "/";
});

els.chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text || !session) return;
  session.sendChat ? session.sendChat(text) : null;
  addChatLine("moi", text);
  els.chatInput.value = "";
});

function cleanup() {
  if (myPid) leaveRoom(ROOM, myPid);
  session?.close();
  session = null;
  if (localStream) for (const t of localStream.getTracks()) t.stop();
}

window.addEventListener("beforeunload", cleanup);

// Heartbeat HTTP de présence : maintient le DO informé même en mode SFU,
// ce qui empêche la destruction prématurée du serveur (garde-fou devis §8).
setInterval(() => {
  if (myPid) heartbeat(ROOM, myPid);
}, 30000);

// Démarrage : acquisition des médias dès l'arrivée sur la page
acquireMedia();
