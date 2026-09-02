# CERCLE MEET (MEET-CERCLE)

Visioconférence à **coûts maîtrisés**, propulsée par **CERCLE MEET** — une
installation de [MiroTalk P2P](https://github.com/miroslavpejic85/mirotalk)
(open-source, AGPLv3) rebrandée, orchestrée en **infrastructure éphémère** :
petites réunions en **P2P direct**, serveur média **LiveKit provisionné à la
demande** (Hetzner CPX22) et **détruit automatiquement** en fin de session.
Politique réseau **IPv6-first / IPv4 conditionnelle + TURN**.

> Implémentation du devis proforma V4 « Architecture éphémère de visioconférence :
> P2P prioritaire + LiveKit SFU à la demande » (30 août 2026).

## L'app de visio : CERCLE MEET (MiroTalk)

L'interface de visioconférence est **MiroTalk P2P v1.9.31** (vendored dans
`app/mirotalk`), renommée **CERCLE MEET** dans toute son interface via son
système de marque intégré (`/brand` + `public/js/brand.js`) :

- nom, titres, descriptions et libellés en français ;
- langue de l'interface : **français** par défaut ;
- logo dédié (`public/images/logo-cercle.svg`) ;
- sections sponsors/promos upstream désactivées ;
- **analytique tierce désactivée** par défaut ;
- attribution upstream conservée (licence + section « À propos »).

Détail des modifications : `app/mirotalk/REBRAND-CERCLE-MEET.md`.

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
| `app/mirotalk/` | **CERCLE MEET** — app de visio (MiroTalk P2P rebrandé, signaling Node/Socket.io + WebRTC) |
| `frontend/` | Portail statique : lobby, création de salon, **abonnement local démontrable** et redirection vers CERCLE MEET |
| `worker/` | Orchestrateur Cloudflare Workers (TypeScript) : API, RoomDO, Hetzner, DNS, JWT |
| `infra/` | Config TURN (coturn) + cloud-init de référence LiveKit |
| `scripts/` | Smoke test de l'orchestrateur |
| `docs/` | Architecture, déploiement, **restes à finaliser manuellement** |

## Démarrage rapide (développement)

```bash
# 1. App de visio CERCLE MEET (MiroTalk) — http://localhost:3000
cd app/mirotalk
npm install
npm start            # copie config.template.js -> config.js au premier démarrage

# 2. Portail (terminal 2) — http://localhost:8080
cd frontend
python -m http.server 8080     # ou : npx serve .
# Le bouton « Créer un salon » ouvre le salon dans CERCLE MEET (/join/?room=...)
```

> Windows : si le démarrage échoue avec `Cannot find module '@mattermost/types/client4'`
> (dépendance transitive manquante upstream), exécuter :
> `npm install @mattermost/types --no-save`

```bash
# 3. Abonnement local démontrable — http://localhost:8080/abonnement.html
#    Aucun paiement réel : données stockées dans localStorage du navigateur
```

```bash
# 4. Orchestrateur (optionnel — provisionnement SFU éphémère Hetzner)
cd worker
npm install
npx wrangler kv namespace create STATE   # reporter l'id dans wrangler.toml
npx wrangler dev                          # http://127.0.0.1:8787
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

- App de visio **CERCLE MEET** (MiroTalk P2P rebrandé) : vendored, rebrand vérifié en exécution (API `/brand`, titres, logo).
- Orchestrateur + portail + infra : écrit et typé (`tsc` sans erreur, bundle wrangler validé).
- Non finalisé par conception : secrets, domaine, déploiement cloud, TURN en
  production, tests de connectivité sur réseaux réels — tout est listé dans
  `docs/A-COMPLETER-MANUELLEMENT.md`.
