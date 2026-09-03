// ---------------------------------------------------------------------------
// Lobby : création / rejoindre un salon
// ---------------------------------------------------------------------------

import { createRoom } from "./api.js";
import { getSubscription, remainingDays } from "./subscription.js";
import { getSession, clearSession, lockRoom, unlockRoom } from "./api.js";

const $ = (sel) => document.querySelector(sel);

// Base de l'app de visio CERCLE MEET (MiroTalk P2P rebrandé).
// Vide = même origine (MiroTalk servi à la racine ou derrière un reverse-proxy).
// Sinon ex. "https://meet.mon-domaine.tld" (voir docs/DEPLOYMENT.md).
// En local (localhost), on cible par défaut MiroTalk sur le port 3000.
const MIROTALK_BASE = (
  window.MEET_CERCLE_MIROTALK_BASE ||
  (["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)
    ? `${location.protocol}//${location.hostname}:3000`
    : "")
).replace(/\/+$/, "");

const identityInput = $("#identity");
const roomInput = $("#room-name");
const createBtn = $("#create-room");
const joinBtn = $("#join-room");
const errorBox = $("#lobby-error");

identityInput.value = localStorage.getItem("meet-cercle-identity") || "";

// Badge d'abonnement actif dans la barre supérieure.
function renderSubscriptionBadge() {
  const badge = $("#subscription-badge");
  const sub = getSubscription();
  if (!sub) return;
  const days = remainingDays(sub);
  badge.textContent = `${sub.planName} · ${days < 1 ? Math.round(days * 24) + " h" : Math.ceil(days) + " j"}`;
  badge.classList.remove("hidden");
}
renderSubscriptionBadge();

// --- État du compte dans le header --------------------------------------------
const navAccount = $("#nav-account");
const navLogout = $("#nav-logout");

function updateAccountNav() {
  const s = getSession();
  if (s && s.token) {
    navAccount.textContent = "Mon compte";
    navLogout.classList.remove("hidden");
  } else {
    navAccount.textContent = "Connexion";
    navLogout.classList.add("hidden");
  }
}

if (navLogout) {
  navLogout.addEventListener("click", () => {
    clearSession();
    updateAccountNav();
  });
}
updateAccountNav();

function currentIdentity() {
  const v = identityInput.value.trim();
  if (!v) {
    showError("Indiquez votre nom pour rejoindre un salon.");
    identityInput.focus();
    return null;
  }
  localStorage.setItem("meet-cercle-identity", v);
  return v;
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove("hidden");
}

/** Ouvre le salon dans l'interface CERCLE MEET (MiroTalk /join/). */
function openMiroTalk(room, identity) {
  const params = new URLSearchParams({
    room,
    name: identity,
    audio: "1",
    video: "1",
    screen: "1",
    chat: "1",
  });
  location.href = `${MIROTALK_BASE}/join/?${params.toString()}`;
}

createBtn.addEventListener("click", async () => {
  const identity = currentIdentity();
  if (!identity) return;
  createBtn.disabled = true;
  try {
    const { room } = await createRoom();
    localStorage.setItem("meet-cercle-last-room", room);

    // Verrou anti-partage : un compte ne peut héberger qu'une réunion à la fois.
    // Le verrou est posé avant d'ouvrir MiroTalk ; s'il est déjà pris, on bloque.
    const session = getSession();
    if (session && session.token) {
      try {
        const lock = await lockRoom(room);
        if (lock && lock.ok) {
          localStorage.setItem("meet-cercle-locked-room", room);
        }
      } catch (lockErr) {
        const msg = lockErr && lockErr.message ? lockErr.message : "";
        if (/already_in_meeting/i.test(msg)) {
          showError("Vous avez déjà une réunion en cours. Fermez-la avant d'en créer une nouvelle.");
          createBtn.disabled = false;
          return;
        }
        // Autre erreur (Worker injoignable) : on ouvre quand même, verrou best-effort.
      }
    }

    openMiroTalk(room, identity);
  } catch (err) {
    // Orchestrateur indisponible : ouverture directe du salon MiroTalk
    // (le salon est créé à la volée par MiroTalk, sans provisionnement SFU).
    const fallback = localStorage.getItem("meet-cercle-last-room");
    openMiroTalk(fallback || `salon-${Math.random().toString(36).slice(2, 10)}`, identity);
  } finally {
    createBtn.disabled = false;
  }
});

joinBtn.addEventListener("click", () => {
  const identity = currentIdentity();
  if (!identity) return;
  const room = roomInput.value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(room)) {
    showError("Code de salon invalide (lettres minuscules, chiffres et tirets).");
    return;
  }
  localStorage.setItem("meet-cercle-last-room", room);
  openMiroTalk(room, identity);
});

roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinBtn.click();
});
