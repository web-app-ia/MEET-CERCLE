# Déploiement — Comptes abonnés & verrou anti-partage (CERCLE MEET)

Guide pas-à-pas pour mettre en production la fonctionnalité **Comptes abonnés + 1 réunion simultanée / compte**
(verrou anti-partage), sans serveur admin payant : tout tient dans la stack Cloudflare gratuite
(Workers + KV + Durable Objects `AccountDO`).

> Prérequis : voir `docs/DEPLOYMENT.md` pour la mise en place générale (KV `STATE`, secrets Hetzner/LiveKit/CF/TURN,
> déploiement Worker + Pages, variables `window.MEET_CERCLE_*`). Ce guide ne couvre **que** la partie comptes/verrou.

---

## 0. Ce qui est déjà en place (à ne pas refaire)

- `worker/src/account-do.ts` — Durable Object `AccountDO` (identité + `activeRoomId`).
- `worker/src/index.ts` — routes `/auth/register`, `/auth/login`, `/me`, `/room/lock`, `/room/unlock`,
  `/internal/room/unlock-by-room`.
- `worker/wrangler.toml` — binding `ACCOUNTS` + migration `v2` (`new_sqlite_classes = ["AccountDO"]`) → **déjà déclaré**.
- `frontend/assets/js/api.js` — helpers `register/login/getMe/lockRoom/unlockRoom` + session JWT `localStorage`.
- `frontend/index.html` — header (Connexion / Mon compte / Déconnexion) + variable `window.MEET_CERCLE_API_BASE`.
- `app/mirotalk/app/src/server.js` — libère le verrou quand un salon se vide (`releaseAccountLock`).
- `app/mirotalk/app/src/config.js` — bloc `account { apiUrl, secret }` (désactivé si `ACCOUNT_API` vide).

Il reste **3 actions** à faire pour la prod :
1. créer le secret `SESSION_SECRET` du Worker ;
2. déployer le Worker ;
3. câbler le frontend (`MEET_CERCLE_API_BASE`) et MiroTalk (`ACCOUNT_API` + `ACCOUNT_SECRET`).

---

## 1. Prérequis

```bash
# Wrangler installé et connecté à votre compte Cloudflare
npx wrangler --version
npx wrangler whoami

# Node 18+ (pour le build du frontend et MiroTalk)
node --version
```

Placez-vous à la racine du dépôt :

```bash
cd "C:\Users\Fouit\.verdent\verdent-projects\code-ce-projet-realise"
```

---

## 2. KV `STATE` (si pas encore fait)

Le Worker stocke l'index des salons **et** le mapping `roomOwner:<roomId> → email` dans ce KV.
Si vous avez déjà déployé le Worker une première fois, cette étape est faite — sinon :

```bash
npx wrangler kv namespace create STATE
```

Récupérez l'`id` affiché et renseignez-le dans `worker/wrangler.toml` :

```toml
[[kv_namespaces]]
binding = "STATE"
id = "REPLACE_WITH_KV_NAMESPACE_ID"   # <- collez l'id ici
```

---

## 3. Secret `SESSION_SECRET` du Worker

Ce secret sert à **deux** choses :
- signer/vérifier les JWT de session des comptes (`HS256`) ;
- authentifier l'appel interne `/internal/room/unlock-by-room` venant de MiroTalk
  (le Worker rejette `403` si `X-Internal-Secret` ≠ `SESSION_SECRET`).

⚠️ **Ne laissez pas la valeur de dev** (`"dev-session-secret-change-me"`) en production. Générez une chaîne
longue et aléatoire, et **réutilisez exactement la même** pour `ACCOUNT_SECRET` côté MiroTalk (§6).

```bash
# Génère une clé aléatoire de 32 octets (affichage base64, à copier)
openssl rand -base64 32
```

Puis :

```bash
cd worker
npx wrangler secret put SESSION_SECRET
# Collez la valeur générée ci-dessus quand il le demande.
```

> Le `[vars] SESSION_SECRET = "dev-session-secret-change-me"` de `wrangler.toml` est **écrasé** en prod par le
> secret. En local (dev), c'est cette valeur de secours qui est utilisée — gardez-la cohérente si vous testez
> en local les deux bouts.

---

## 4. Déployer le Worker

`AccountDO` est déjà déclaré dans les migrations `v2`, donc le déploiement crée/Met à jour le DO automatiquement :

```bash
cd worker
npx wrangler deploy
```

À la fin, notez l'URL de déploiement, typiquement :

```
https://meet-cercle-worker.<votre-sous-domaine>.workers.dev
```

### Vérification rapide

```bash
curl https://meet-cercle-worker.<votre-sous-domaine>.workers.dev/api/health
# -> {"ok":true,"service":"meet-cercle-worker","time":"..."}
```

### Test de l'inscription (smoke test)

```bash
curl -s -X POST https://meet-cercle-worker.<votre-sous-domaine>.workers.dev/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@exemple.com","password":"motdepasse123","name":"Test"}'
# -> {"token":"<jwt>","account":{"accountId":"test@exemple.com",...}}
```

Notez le `token` retourné, vous en aurez besoin pour tester le verrou (§7).

---

## 5. Câbler le frontend (portal)

Dans `frontend/index.html`, décommentez et renseignez la variable `window.MEET_CERCLE_API_BASE` (lignes ~10-15) :

```html
<script>
  window.MEET_CERCLE_API_BASE = "https://meet-cercle-worker.<votre-sous-domaine>.workers.dev";
  // window.MEET_CERCLE_MIROTALK_BASE = "https://meet.mon-domaine.tld"; // si MiroTalk sur autre origine
</script>
```

- Sans cette variable, le frontend suppose que le Worker est sur la **même origine** (utile en dev local).
- En prod (Pages sur un domaine différent du Worker), elle **doit** pointer vers l'URL du Worker.

Puis déployez le frontend (ex. Cloudflare Pages, comme décrit dans `docs/DEPLOYMENT.md`) :

```bash
cd frontend
# build/ upload selon votre hébergeur (Pages: connectez le dossier /frontend)
```

Le header affiche alors **« Connexion »** (puis **« Mon compte » + « Déconnexion »** une fois connecté),
et le bouton **« Créer un salon »** appelle `/room/lock` automatiquement.

---

## 6. Câbler MiroTalk (libération du verrou quand le salon se vide)

Le portail **prend** le verrou (`/room/lock`). MiroTalk doit le **rendre** quand le dernier participant quitte,
sinon un compte resterait bloqué indéfiniment. C'est géré par `releaseAccountLock` dans `server.js`.

Renseignez ces deux variables d'environnement pour le service `app/mirotalk` :

| Variable       | Valeur                                                                 | Obligation |
|----------------|------------------------------------------------------------------------|-----------|
| `ACCOUNT_API`  | URL de base du Worker : `https://meet-cercle-worker.<votre-sous-domaine>.workers.dev` | requise pour activer le release |
| `ACCOUNT_SECRET` | **identique** à `SESSION_SECRET` (§3)                                | requise, doit matcher le secret Worker |

Exemple (Docker/`.env` ou variables d'environnement du process) :

```bash
ACCOUNT_API=https://meet-cercle-worker.<votre-sous-domaine>.workers.dev
ACCOUNT_SECRET=<LA_MEME_VALEUR_QUE_SESSION_SECRET>
```

> Si `ACCOUNT_API` reste vide, le bloc `config.account` est désactivé : comportement identique à avant
> (aucun verrou, aucune libération). La fonctionnalité est donc **OFF par défaut** côté MiroTalk tant que
> ces deux variables ne sont pas renseignées.

Redémarrez MiroTalk après avoir défini ces variables. Vérifiez dans les logs au démarrage que
`config.account` vaut `{ apiUrl: "https://...", secret: "..." }` (et non `{ apiUrl: "", secret: "" }`).

---

## 7. Test de bout en bout (anti-partage)

Scénario : un compte ne peut avoir **qu'une** réunion active à la fois.

### 7.1 Inscription + connexion

```bash
# Inscription (récupère token)
TOKEN=$(curl -s -X POST https://meet-cercle-worker.<votre-sous-domaine>.workers.dev/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@exemple.com","password":"secret123","name":"Alice"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
echo "$TOKEN"
```

### 7.2 Première réunion → verrou OK

```bash
curl -s -X POST https://meet-cercle-worker.<votre-sous-domaine>.workers.dev/room/lock \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"salon-alice-1"}'
# -> {"ok":true}
```

### 7.3 Deuxième réunion → doit être refusée

```bash
curl -s -X POST https://meet-cercle-worker.<votre-sous-domaine>.workers.dev/room/lock \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"salon-alice-2"}'
# -> {"error":"already_in_meeting"}   (HTTP 409)
```

C'est exactement ce que le portail intercepte : le bouton « Créer un salon » affiche
**« Vous avez déjà une réunion en cours… »** et bloque la création.

### 7.4 Libération du verrou (MiroTalk)

Quand le salon `salon-alice-1` se vide, MiroTalk appelle :

```bash
curl -s -X POST https://meet-cercle-worker.<votre-sous-domaine>.workers.dev/internal/room/unlock-by-room \
  -H "X-Internal-Secret: <LA_MEME_VALEUR_QUE_SESSION_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"salon-alice-1"}'
# -> {"ok":true}
```

Après cela, un nouveau `/room/lock` pour ce compte redevient accepté (`{"ok":true}`).

### 7.5 Via l'UI (parcours utilisateur)

1. Ouvrir le portail → **Connexion** → s'inscrire/se connecter (`alice@exemple.com`).
2. **Créer un salon** → la réunion démarre, verrou posé.
3. Dans **Mon compte**, « Réunion en cours » affiche le salon.
4. Tenter de créer un second salon → message « Vous avez déjà une réunion en cours ».
5. Quitter/vider le premier salon → le verrou se libère seul (MiroTalk → Worker).
6. `Déconnexion` efface la session locale.

---

## 8. Sécurité & limites connues

- **`SESSION_SECRET` = `ACCOUNT_SECRET`.** Les deux doivent être identiques, sinon le Worker répond `403`
  à l'appel de libération et le compte reste bloqué. Stockez-les comme secrets (jamais en clair dans le repo).
- **CORS ouvert (`*`)** : acceptable pour une API publique de ce type, mais si vous voulez durcir,
  restreignez `Access-Control-Allow-Origin` aux origines du portail + MiroTalk dans `worker/src/index.ts`.
- **Mots de passe hachés** (SHA-256 + sel, via Web Crypto) — pas de texte en clair en KV. Pas de reset de mot de passe
  pour l'instant (hors périmètre).
- **Limite du verrou par le portail** : le verrou est posé côté portail (`lockRoom` au clic « Créer un salon »).
  Si une réunion est créée **en contournant le portail** (URL MiroTalk directe sans passer par l'app), le verrou
  n'est pas posé. Hardening possible : faire émettre un *room token* signé par le Worker que MiroTalk exigerait pour
  ouvrir un salon — à ajouter si nécessaire.
- **Pas de serveur admin** : l'état des comptes vit entièrement dans le Durable Object `AccountDO` (gratuit,
  serverless). Aucun service freemium ou serveur dédié requis pour la règle « 1 réunion / compte ».
- **Données de test** : pensez à supprimer les comptes de test (`alice@`, `test@`) après les essais — purge KV/DO
  hors périmètre de ce guide, à faire manuellement côté Cloudflare Dashboard si besoin.

---

## 9. Récapitulatif des variables

| Où                         | Variable                | Valeur                                                        |
|----------------------------|-------------------------|---------------------------------------------------------------|
| Worker (secret)            | `SESSION_SECRET`        | chaîne aléatoire 32+ octets (↔ `ACCOUNT_SECRET`)              |
| Worker `wrangler.toml`     | `STATE` (KV id)         | id du namespace KV `STATE`                                    |
| Frontend `index.html`      | `window.MEET_CERCLE_API_BASE` | URL Worker (`https://meet-cercle-worker.<sub>.workers.dev`) |
| MiroTalk (env)             | `ACCOUNT_API`           | URL Worker (active le release de verrou)                     |
| MiroTalk (env)             | `ACCOUNT_SECRET`        | = `SESSION_SECRET`                                           |

---

## 10. Ordre de déploiement recommandé

1. `wrangler kv namespace create STATE` → renseigner `wrangler.toml`.
2. `wrangler secret put SESSION_SECRET`.
3. `wrangler deploy` (Worker, avec `AccountDO` v2).
4. `curl /api/health` + `/auth/register` (smoke test).
5. `frontend/index.html` → `MEET_CERCLE_API_BASE` → déployer le portail.
6. MiroTalk → `ACCOUNT_API` + `ACCOUNT_SECRET` → redémarrer.
7. Test bout en bout §7 (register → lock → 2ᵉ lock refusé → unlock).

Une fois ces 7 étapes vertes, la fonctionnalité **Comptes abonnés + verrou anti-partage** est en production
réelle, sur la stack 0 FCFA.
