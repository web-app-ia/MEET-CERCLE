// ---------------------------------------------------------------------------
// Page Abonnement : statut, offres, achat simulé, historique.
// ---------------------------------------------------------------------------

import {
  OFFERS,
  getSubscription,
  getHistory,
  purchase,
  resetAll,
  remainingDays,
  formatDate,
  getOffer,
} from "./subscription.js";

const $ = (sel) => document.querySelector(sel);

let selectedOfferId = null;

// --- Rendu du statut -------------------------------------------------------

function renderStatus() {
  const sub = getSubscription();
  const planEl = $("#status-plan");
  const expiryEl = $("#status-expiry");
  const badgeEl = $("#status-badge");
  const barEl = $("#status-bar");
  const fillEl = $("#status-fill");
  const noteEl = $("#status-note");
  const resetBtn = $("#btn-reset");

  if (!sub) {
    planEl.textContent = "Aucun abonnement actif";
    expiryEl.textContent = "";
    badgeEl.textContent = "Starter";
    badgeEl.classList.remove("active");
    barEl.classList.add("hidden");
    noteEl.textContent =
      "Sans abonnement, les réunions pair-à-pair jusqu'à 4 participants restent gratuites.";
    return;
  }

  const offer = getOffer(sub.planId);
  const days = remainingDays(sub);
  planEl.textContent = sub.planName;
  expiryEl.textContent = `Valable jusqu'au ${formatDate(sub.expiryMs)}`;
  badgeEl.textContent = `Actif · ${days < 1 ? Math.round(days * 24) + " h" : Math.ceil(days) + " j"}`;
  badgeEl.classList.add("active");
  noteEl.textContent = offer
    ? offer.perks.join(" · ")
    : "Abonnement actif.";

  const total = sub.expiryMs - sub.startedMs;
  const left = sub.expiryMs - Date.now();
  const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
  barEl.classList.remove("hidden");
  fillEl.style.width = `${pct}%`;
}

function renderResetButton() {
  $("#btn-reset").classList.toggle("hidden", getHistory().length === 0);
}

// --- Rendu des offres ------------------------------------------------------

function renderOffers() {
  const grid = $("#offers");
  grid.innerHTML = "";
  for (const offer of OFFERS) {
    const card = document.createElement("article");
    card.className = "offer-card card" + (offer.featured ? " featured" : "");
    card.innerHTML = `
      ${offer.featured ? '<div class="offer-flag">Populaire</div>' : ""}
      <h3>${offer.name}</h3>
      <div class="offer-price">${offer.priceLabel}</div>
      <div class="muted offer-duration">${offer.durationLabel}</div>
      <ul class="offer-perks">
        ${offer.perks.map((p) => `<li>${p}</li>`).join("")}
      </ul>
      <button class="btn wide ${offer.featured ? "primary" : ""}" data-offer="${offer.id}">
        Acheter (simulation)
      </button>
    `;
    grid.appendChild(card);
  }
  grid.querySelectorAll("button[data-offer]").forEach((btn) => {
    btn.addEventListener("click", () => openCheckout(btn.dataset.offer));
  });
}

// --- Modale de paiement simulé ----------------------------------------------

function openCheckout(offerId) {
  const offer = getOffer(offerId);
  if (!offer) return;
  selectedOfferId = offerId;
  $("#checkout-offer").textContent = offer.name;
  $("#checkout-price").textContent = offer.priceLabel;
  $("#checkout-error").classList.add("hidden");
  $("#checkout-overlay").classList.remove("hidden");
  $("#buy-name").focus();
}

function closeCheckout() {
  $("#checkout-overlay").classList.add("hidden");
  selectedOfferId = null;
}

function pay() {
  if (!selectedOfferId) return;
  const name = $("#buy-name").value.trim();
  const email = $("#buy-email").value.trim();
  const card = $("#buy-card").value.replace(/\D/g, "");

  const errEl = $("#checkout-error");
  if (!name || !email) {
    errEl.textContent = "Renseignez un nom et un e-mail (données fictives acceptées).";
    errEl.classList.remove("hidden");
    return;
  }
  if (card.length < 12) {
    errEl.textContent = "Numéro de carte factice requis (ex. 4242 4242 4242 4242).";
    errEl.classList.remove("hidden");
    return;
  }

  purchase(selectedOfferId, { name, email, card });
  closeCheckout();
  renderStatus();
  renderResetButton();
  renderHistory();
}

// --- Historique --------------------------------------------------------------

function renderHistory() {
  const body = $("#history-body");
  const history = getHistory();
  if (!history.length) {
    body.innerHTML =
      '<tr><td colspan="5" class="muted">Aucun achat pour le moment.</td></tr>';
    return;
  }
  body.innerHTML = history
    .map((h) => {
      const offer = getOffer(h.planId);
      const label = offer ? offer.priceLabel : `${(h.payment.amountCents / 100).toFixed(2)} $`;
      return `
      <tr>
        <td>${formatDate(h.purchasedMs)}</td>
        <td>${h.planName}</td>
        <td>${label}</td>
        <td>${formatDate(h.expiryMs)}</td>
        <td><code>${h.payment.transactionId}</code></td>
      </tr>`;
    })
    .join("");
}

// --- Init ---------------------------------------------------------------------

function resetDemo() {
  if (!confirm("Effacer l'abonnement et tout l'historique (démonstration) ?")) return;
  resetAll();
  renderStatus();
  renderResetButton();
  renderHistory();
}

$("#checkout-close").addEventListener("click", closeCheckout);
$("#checkout-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeCheckout();
});
$("#checkout-pay").addEventListener("click", pay);
$("#btn-reset").addEventListener("click", resetDemo);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#checkout-overlay").classList.contains("hidden")) {
    closeCheckout();
  }
});

renderStatus();
renderResetButton();
renderOffers();
renderHistory();
