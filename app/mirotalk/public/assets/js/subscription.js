// ---------------------------------------------------------------------------
// CERCLE MEET — Abonnements (démonstration locale, sans paiement réel)
//
// Simule un parcours d'achat : offres, paiement factice, historique, validité.
// Les données sont stockées dans localStorage (par navigateur).
//
// BRANCHEMENT STRIPE PLUS TARD : remplacer `purchase()` par un appel au Worker
// Cloudflare qui crée une session Stripe Checkout et valide via webhook ; le
// format des enregistrements (`sub`, `history`) est déjà pensé pour ça.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "meet-cercle-subscription";
const HISTORY_KEY = "meet-cercle-subscription-history";

/** Offres d'abonnement — prix en $ et Fcfa uniquement. */
export const OFFERS = [
  {
    id: "pass",
    name: "Pass Réunion",
    priceLabel: "$5 / 3 000 Fcfa",
    priceCents: 500,
    durationMs: 24 * 60 * 60 * 1000, // 24 h
    durationLabel: "valable 24 h",
    perks: [
      "1 réunion à la date de votre choix",
      "Jusqu'à 8 participants (SFU inclus)",
      "Durée de réunion illimitée pendant 24 h",
    ],
  },
  {
    id: "mensuel",
    name: "Mensuel",
    priceLabel: "$11 / 6 500 Fcfa / mois",
    priceCents: 1100,
    durationMs: 30 * 24 * 60 * 60 * 1000,
    durationLabel: "renouvelable chaque mois",
    perks: [
      "Réunions illimitées",
      "Participants illimités (SFU)",
      "Salons privés verrouillables",
      "Support par e-mail",
    ],
    featured: true,
  },
  {
    id: "annuel",
    name: "Annuel",
    priceLabel: "$96 / 58 000 Fcfa / an",
    priceCents: 9600,
    durationMs: 365 * 24 * 60 * 60 * 1000,
    durationLabel: "soit 2 mois offerts",
    perks: [
      "Tous les avantages du Mensuel",
      "Support prioritaire",
      "Statistiques d'utilisation",
    ],
  },
];

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getOffer(id) {
  return OFFERS.find((o) => o.id === id) || null;
}

/** Abonnement actif ou null. Un abonnement est actif jusqu'à son expiryMs. */
export function getSubscription() {
  const sub = readJson(STORAGE_KEY, null);
  if (!sub || typeof sub.expiryMs !== "number") return null;
  if (sub.expiryMs <= Date.now()) return null;
  return sub;
}

/** Historique complet des achats (simulation) */
export function getHistory() {
  return readJson(HISTORY_KEY, []);
}

/** Jours restants (nombre à 1 décimale) pour l'abonnement actif. */
export function remainingDays(sub = getSubscription()) {
  if (!sub) return 0;
  return Math.max(0, (sub.expiryMs - Date.now()) / (24 * 60 * 60 * 1000));
}

export function formatDate(ms) {
  return new Date(ms).toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

/**
 * Achat simulé : aucun paiement réel. Prolonge l'abonnement actif s'il y en
 * a un, sinon démarre un nouvel abonnement à la date courante.
 * Retourne l'abonnement mis à jour.
 */
export function purchase(offerId, buyer = {}) {
  const offer = getOffer(offerId);
  if (!offer) throw new Error(`Offre inconnue : ${offerId}`);

  const now = Date.now();
  const current = getSubscription();
  const base = current ? Math.max(now, current.expiryMs) : now;
  const expiryMs = base + offer.durationMs;

  const sub = {
    planId: offer.id,
    planName: offer.name,
    startedMs: current ? current.startedMs : now,
    expiryMs,
    updatedAtMs: now,
    buyer: {
      name: buyer.name || "",
      email: buyer.email || "",
    },
    payment: {
      provider: "simulation",
      transactionId: `SIM-${now.toString(36).toUpperCase()}`,
      amountCents: offer.priceCents,
      cardLast4: (buyer.card || "").replace(/\D/g, "").slice(-4) || "4242",
    },
  };

  writeJson(STORAGE_KEY, sub);

  const history = getHistory();
  history.unshift({
    ...sub,
    purchasedMs: now,
  });
  writeJson(HISTORY_KEY, history.slice(0, 20));

  return sub;
}

/** Réinitialisation complète (utile en démonstration). */
export function resetAll() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(HISTORY_KEY);
}
