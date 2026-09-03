// ---------------------------------------------------------------------------
// Compte abonné : inscription / connexion / profil
// ---------------------------------------------------------------------------

import { getSession, setSession, clearSession, login, register, getMe } from "./api.js";

const $ = (sel) => document.querySelector(sel);

const authView = $("#auth-view");
const profileView = $("#profile-view");
const authForm = $("#auth-form");
const nameField = $("#name-field");
const tabLogin = $("#tab-login");
const tabRegister = $("#tab-register");
const authSubmit = $("#auth-submit");
const authError = $("#auth-error");
const logoutBtn = $("#logout-btn");

let mode = "login"; // "login" | "register"

function setMode(next) {
  mode = next;
  const isRegister = mode === "register";
  tabLogin.classList.toggle("active", !isRegister);
  tabRegister.classList.toggle("active", isRegister);
  nameField.hidden = !isRegister;
  authSubmit.textContent = isRegister ? "Créer le compte" : "Se connecter";
}

tabLogin.addEventListener("click", () => setMode("login"));
tabRegister.addEventListener("click", () => setMode("register"));

function showError(msg) {
  authError.textContent = msg;
  authError.classList.remove("hidden");
}

async function renderProfile() {
  const session = getSession();
  if (!session || !session.token) {
    authView.classList.remove("hidden");
    profileView.classList.add("hidden");
    return;
  }
  try {
    const { account } = await getMe();
    authView.classList.add("hidden");
    profileView.classList.remove("hidden");
    $("#profile-name").textContent = account.name || account.email;
    $("#profile-email").textContent = account.email;
    const planLabels = { free: "Gratuit", pass: "Pass Réunion", mensuel: "Mensuel", annuel: "Annuel" };
    $("#profile-plan").textContent = planLabels[account.planId] || account.planId || "Gratuit";
    $("#profile-active").textContent = account.activeRoomId
      ? `Salon « ${account.activeRoomId} »`
      : "Aucune";
  } catch {
    // Token invalide/expiré : on revient à l'écran de connexion
    clearSession();
    authView.classList.remove("hidden");
    profileView.classList.add("hidden");
  }
}

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");
  const email = $("#email").value.trim();
  const password = $("#password").value;
  const name = $("#name").value.trim();
  if (!email || !password) return showError("E-mail et mot de passe requis.");

  authSubmit.disabled = true;
  try {
    if (mode === "register") {
      await register(email, password, name);
    } else {
      await login(email, password);
    }
    // Connexion réussie : on revient au portail (le badge y apparaît)
    window.location.href = "/";
  } catch (err) {
    showError(err.message || "Échec de l'authentification.");
  } finally {
    authSubmit.disabled = false;
  }
});

logoutBtn.addEventListener("click", () => {
  clearSession();
  setSession(null);
  authView.classList.remove("hidden");
  profileView.classList.add("hidden");
});

setMode("login");
renderProfile();
