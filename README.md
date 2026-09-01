# MEET-CERCLE

Visioconférence à **coûts maîtrisés** : petites réunions en **P2P direct** (WebRTC mesh),
serveur média **LiveKit provisionné à la demande** (Hetzner CPX22) et **détruit
automatiquement** en fin de session. Politique réseau **IPv6-first / IPv4
conditionnelle + TURN**.

> Implémentation du devis proforma V4 « Architecture éphémère de visioconférence :
> P2P prioritaire + LiveKit SFU à la demande » (30 août 2026).

## Architecture en un coup d'œil

```
 Navigateur(s)                    Cloudflare Worker                Hetzner Cloud
┌──────────────┐   REST/WS    ┌──────────────────────────┐   API   ┌────────────────┐
│  Frontend    │─────────────▶│  Orchestrateur           │────────▶│ SFU LiveKit    │
│  (statique)  │              │  · décision P2P/SFU      │         │ CPX22 éphémère │
│              │   WebRTC     │  · verrous/idempotence   │         │ IPv6-first     │
│  P2P mesh ◀──┼──────────────┤  · tokens LiveKit JWT    │         └───────┬────────┘
│  ou LiveKit  │              │  · sweep de destruction  │                 │ AAAA
└──────────────┘              └──────────┬───────────────┘          ┌──────▼────────┐
        │                                │                          │ DNS Cloudflare│
        └──────── TURN mutualisé ◀───────┴── KV (état + journal)    │ (record éph.) │
             (permanent, pas éphémère)                               └───────────────┘
```

- **P2P** : jusqu'à `P2P_MAX_PARTICIPANTS` (4 par défaut), la signalisation passe par
  un Durable Object et les flux vont directement de navigateur à navigateur.
- **SFU** : au-delà du seuil, un CPX22 est créé via l'API Hetzner (IPv6-only par
  défaut), un record DNS AAAA éphémère est créé chez Cloudflare, LiveKit est
  déployé par cloud-init ; les clients basculent automatiquement.
- **Destruction** : un cron toutes les 5 min détecte les salons vides, attend le
  délai de sécurité, **revérifie dans le Durable Object** (anti-suppression), puis
  supprime serveur + DNS. Coût ~0,0312 €/h en IPv6-only.

## Structure du dépôt

| Dossier | Contenu |
|---|---|
| `frontend/` | Application statique (lobby + salon, mesh P2P, LiveKit via CDN) |
| `worker/` | Orchestrateur Cloudflare Workers (TypeScript) : API, RoomDO, Hetzner, DNS, JWT |
| `infra/` | Config TURN (coturn) + cloud-init de référence LiveKit |
| `scripts/` | Smoke test de l'orchestrateur |
| `docs/` | Architecture, déploiement, **restes à finaliser manuellement** |

## Démarrage rapide (développement)

```bash
# 1. Orchestrateur (terminal 1)
cd worker
npm install
npx wrangler kv namespace create STATE   # reporter l'id dans wrangler.toml
npx wrangler dev                          # http://127.0.0.1:8787

# 2. Frontend (terminal 2) — n'importe quel serveur statique
cd frontend
python -m http.server 8080                # ou : npx serve .
# puis ouvrir http://localhost:8080
```

En dev local sans secrets Hetzner, la bascule SFU est « demandée » mais le
provisionnement échoue proprement (journalisé, salon dégradé en P2P, cooldown 2 min) —
le P2P reste fonctionnel de bout en bout.

## Déploiement

Voir **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** (Workers, KV, DO, secrets, frontend,
TURN, firewall) et surtout **[docs/A-COMPLETER-MANUELLEMENT.md](docs/A-COMPLETER-MANUELLEMENT.md)**
pour la liste des actions qui exigent vos comptes/identifiants (Hetzner, Cloudflare,
domaine, TURN, tests réseau réels).

## Statut

- Code orchestrateur + frontend + infra : **écrit et typé** (voir docs pour les vérifications à exécuter).
- Non finalisé par conception : secrets, domaine, déploiement cloud, TURN en
  production, tests de connectivité sur réseaux réels — tout est listé dans
  `docs/A-COMPLETER-MANUELLEMENT.md`.
