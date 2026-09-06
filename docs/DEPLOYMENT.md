# Déploiement — MEET-CERCLE

Prérequis : comptes **Cloudflare** (Workers plan Free suffit pour tester) et
**Hetzner Cloud** (projet + jeton API), un **domaine** dont la zone DNS est gérée par
Cloudflare, Node.js ≥ 18.

## 1. Orchestrateur (Cloudflare Workers)

```bash
cd worker
npm install

# Créer le namespace KV et reporter son id dans wrangler.toml
npx wrangler kv namespace create STATE

# Adapter wrangler.toml :
#   - [[kv_namespaces]] id = <id renvoyé>
#   - SFU_DOMAIN = "sfu.votre-domaine.tld"
#   - SFU_NET_POLICY = "ipv6_only" | "dual_stack"
#   - P2P_MAX_PARTICIPANTS, SFU_SERVER_TYPE, SFU_LOCATION si besoin

# Secrets (interactif)
npx wrangler secret put HETZNER_API_TOKEN     # jeton API Hetzner Cloud (lecture/écriture serveurs)
npx wrangler secret put LIVEKIT_API_KEY       # ex. "APIxxxxxxxx" (clé arbitraire, injectée au SFU)
npx wrangler secret put LIVEKIT_API_SECRET    # secret arbitraire fort (injecté au SFU)
npx wrangler secret put CF_DNS_TOKEN          # jeton Cloudflare : Zone > DNS > Edit (zone du SFU_DOMAIN)
npx wrangler secret put CF_ZONE_ID            # id de la zone Cloudflare de SFU_DOMAIN
# TURN mutualisé (peut rester vide au début ; le P2P et l'IPv6 natif marchent sans)
npx wrangler secret put TURN_URL              # ex. turn:turn.votre-domaine.tld:3478
npx wrangler secret put TURN_TCP_URL          # ex. turn:turn.votre-domaine.tld:3478?transport=tcp
npx wrangler secret put TURN_TLS_URL          # ex. turns:turn.votre-domaine.tld:5349
npx wrangler secret put TURN_USERNAME
npx wrangler secret put TURN_CREDENTIAL

npx wrangler deploy
# Noter l'URL : https://meet-cercle-worker.<compte>.workers.dev
```

> `LIVEKIT_API_KEY/SECRET` sont **vos** clés (n'importe quel couple fort) : elles sont
> injectées dans la config du SFU au provisionnement et signent les tokens côté Worker.

Vérification immédiate :

```bash
BASE_URL=https://meet-cercle-worker.<compte>.workers.dev bash scripts/smoke-test.sh
```

## 2. App de visio CERCLE MEET (MiroTalk) + portail

**CERCLE MEET** est l'app de visio (MiroTalk P2P v1.9.31 rebrandé, vendored dans
`app/mirotalk`). Elle requiert Node.js ≥ 18 et sert sa propre signalisation
(Socket.io) sur un port unique (3000 par défaut).

```bash
cd app/mirotalk
npm install
# Le premier démarrage copie config.template.js -> config.js (section brand
# déjà rebrandée CERCLE MEET) ; personnalisez ensuite config.js si besoin :
#   PORT, HTTPS, STUN/TURN, CORS_ORIGIN, etc.
#   Salons ouverts par défaut (HOST_PROTECTED=false) ; le mot de passe et la
#   salle d'admission s'activent manuellement dans le salon par l'hôte.
npm start
# Vérification : http://<host>:3000/brand -> { "message": { "app": { "name": "CERCLE MEET" ... } } }
```

- **HTTPS obligatoire en production** (`getUserMedia` exige un contexte sécurisé) :
  placer un reverse-proxy TLS (Caddy/Nginx) devant le port 3000, ou utiliser la
  config HTTPS native de MiroTalk (certs dans `app/ssl/`).
- Ne pas oublier `npm install @mattermost/types --no-save` si `npm start` échoue
  avec `Cannot find module '@mattermost/types/client4'` (défaut de packaging upstream).
- L'analytique tierce upstream est désactivée par défaut dans la config CERCLE MEET.

**Portail** (`frontend/`, statique) :

```bash
cd frontend
npx wrangler pages deploy . --project-name meet-cercle
# ou tout hébergement statique (Puter.com à valider)
```

Le bouton « Créer un salon » appelle l'orchestrateur (traçabilité) puis ouvre
CERCLE MEET sur `/join/?room=...&name=...`. Si l'app et le portail ne partagent
pas la même origine, définir dans `frontend/index.html` :

```js
window.MEET_CERCLE_API_BASE = "https://meet-cercle-worker.<compte>.workers.dev";
window.MEET_CERCLE_MIROTALK_BASE = "https://meet.votre-domaine.tld";
```

L'API du Worker autorise CORS (`*` par défaut) ; **restreindre** `CORS_HEADERS`
(`worker/src/index.ts`) à l'origine exacte du portail en production.

Le portail et l'app doivent être servis en **HTTPS** (ou `http://localhost` en dev).

## 3. Firewall Hetzner

Créer (console → Firewalls) et attacher aux SFU, ou automatiser via l'API :

| Protocole/Port | Usage |
|---|---|
| TCP 22 | SSH administration (optionnel, à restreindre) |
| TCP 7880 | API LiveKit (twirp) — utilisé par le health-check orchestrateur |
| TCP 7881 | ICE/TCP WebRTC |
| UDP 50000–50200 | ICE/UDP WebRTC |
| UDP/TCP 3478, TCP 5349 | TURN **embarqué** LiveKit (si activé dans le cloud-init) |

## 4. DNS

- Zone du domaine gérée dans Cloudflare ; les records SFU (`sfu-<id>.SFU_DOMAIN`, AAAA/A)
  sont créés et supprimés **automatiquement** par l'orchestrateur via `CF_DNS_TOKEN`.
- Records **gris** (non proxifiés) : obligatoire — le proxy Cloudflare ne peut pas relayer
  le WebRTC UDP et bloquerait la validation Let's Encrypt côté serveur.

## 5. TLS du SFU

Le client se connecte en `wss://sfu-<id>.SFU_DOMAIN` : le SFU **doit** présenter un
certificat valide. Deux approches :

1. **Recommandée** : ajouter dans le cloud-init un reverse-proxy **Caddy** en face de
   LiveKit (7880/7881) — Let's Encrypt automatisé dès que le record DNS est créé
   (l'orchestrateur crée le DNS **avant** le health-check, il y a donc une fenêtre
   suffisante). Modèle : `infra/cloud-init-livekit.reference.yaml` à étendre.
2. **Alternative** : LiveKit embarque TURN/TLS avec ses propres certs (`turn:` config) —
   même prérequis DNS.

> ⚠ Le cloud-init actuel démarre LiveKit en clair sur le port 7880 : le health-check de
> l'orchestrateur appelle `https://<host>/twirp/...`. **C'est le principal chantier à
> finaliser** (Caddy/TLS) — listé dans `A-COMPLETER-MANUELLEMENT.md`, section 4.

## 6. TURN mutualisé (permanent)

Déployer coturn sur une petite instance permanente (guide complet en tête de
`infra/turn/coturn.conf.example`) : `apt install coturn`, certificat Let's Encrypt pour
`turn.votre-domaine.tld`, ouvrir 3478/UDP+TCP, 5349/TCP, 49160–49200/UDP, puis reporter
`TURN_*` dans les secrets du Worker. Le TURN **n'est jamais détruit** avec les SFU.

## 7. Tests à exécuter avant production (devis §16)

1. `bash scripts/smoke-test.sh` contre l'URL déployée.
2. Local : 2–4 onglets/ navigateurs → vérifier la tuile P2P (badge « P2P direct »).
3. Ouvrir ≥ 5 participants → vérifier `sfu_requested` dans les logs (`npx wrangler tail`),
   puis création du serveur Hetzner, DNS, bascule badge « SFU LiveKit ».
4. Quitter tous les participants → après ~10–15 min, vérifier la destruction
   (serveur disparu de la console Hetzner, event `sfu_destroyed`).
5. Matrice réseau : IPv6 natif, IPv4-only, dual stack, NAT domestique, 4G/5G,
   Wi-Fi, réseau d'entreprise restrictif.
6. Mesurer : temps de création CPX22, temps d'initialisation LiveKit, egress média.
