// ---------------------------------------------------------------------------
// Lobby : création / rejoindre un salon
// ---------------------------------------------------------------------------

import { createRoom } from "./api.js";

const $ = (sel) => document.querySelector(sel);

const identityInput = $("#identity");
const roomInput = $("#room-name");
const createBtn = $("#create-room");
const joinBtn = $("#join-room");
const errorBox = $("#lobby-error");

identityInput.value = localStorage.getItem("meet-cercle-identity") || "";

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

createBtn.addEventListener("click", async () => {
  const identity = currentIdentity();
  if (!identity) return;
  createBtn.disabled = true;
  try {
    const { room } = await createRoom();
    location.href = `/room/?room=${encodeURIComponent(room)}`;
  } catch (err) {
    showError(`Création impossible : ${err.message}`);
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
  location.href = `/room/?room=${encodeURIComponent(room)}`;
});

roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinBtn.click();
});
