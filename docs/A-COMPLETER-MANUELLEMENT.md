# À COMPLÉTER MANUELLEMENT

Tout ce qui exige **vos comptes, secrets, domaine ou décisions** et n'a donc pas pu être
finalisé dans le dépôt. Chaque point indique où intervenir. Cochez au fur et à mesure.

## 1. Comptes et secrets (bloquent tout déploiement)

- [ ] **KV namespace** : `cd worker && npx wrangler kv namespace create STATE`,
      reporter l'`id` dans `worker/wrangler.toml` (`[[kv_namespaces]]`).
- [ ] **Secrets Worker** (liste complète + commandes : `docs/DEPLOYMENT.md` §1) :
      `HETZNER_API_TOKEN`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `CF_DNS_TOKEN`,
      `CF_ZONE_ID`, puis les 5 `TURN_*`.
- [ ] **Projet Hetzner** : créer le projet, générer le jeton API avec les permissions
      lecture/écriture **Serveurs** (+ Firewalls si automatisation).
- [ ] **Zone Cloudflare** pour `SFU_DOMAIN` + jeton DNS `Zone.DNS Edit` limité à cette zone.

## 2. Configuration à valider

- [ ] `SFU_DOMAIN` dans `wrangler.toml` (sous-domaine dédié, ex. `sfu.mondomaine.tld`).
- [ ] `SFU_NET_POLICY` : `ipv6_only` (A/B, défaut) ou `dual_stack` (C) — **décision à
      prendre après tests réels**, pas par principe (devis V4, règle centrale §19).
- [ ] `P2P_MAX_PARTICIPANTS` (défaut 4) et `SFU_GRACE_PERIOD_MS` (défaut 10 min).
- [ ] Restreindre le CORS dans `worker/src/index.ts` (`CORS_HEADERS`) à l'origine du
      frontend ; idem si le domaine du Worker doit être verrouillé.

## 3. Déploiement

- [ ] `npx wrangler deploy` (worker) — noter l'URL workers.dev.
- [ ] Héberger `frontend/` en HTTPS (Pages, Puter.com à **valider** — quotas et
      conditions non confirmés, hypothèse proforma du devis) et configurer
      `window.MEET_CERCLE_API_BASE` dans `index.html` **et** `room.html` si hébergement séparé.
- [ ] `bash scripts/smoke-test.sh` contre l'URL déployée.

## 4. TLS du SFU — **chantier principal**

Le cloud-init actuel démarre LiveKit **en clair** (port 7880) alors que l'orchestrateur
health-check en `https://` et que le client se connecte en `wss://`. À faire :

- [ ] Étendre le cloud-init généré par `worker/src/hetzner.ts → renderCloudInit` pour
      installer **Caddy** en reverse-proxy TLS (Let's Encrypt, domaine = `sfu-<id>.SFU_DOMAIN`,
      DNS déjà créé avant le health-check) :
      - Caddy termine TLS sur 443 et proxyfie `wss` + `https` vers `127.0.0.1:7880` ;
      - ouvrir TCP 443 dans le firewall (au lieu de 7880 exposé) ;
      - mettre à jour `wsUrl` si le port diffère (`orchestrator.ts` : `wss://${host}` —
        le 443 est implicite, rien à changer côté Worker).
      Alternative : LiveKit `turn:` avec certs gérées par LiveKit.
- [ ] Re-tester le health-check (`isLiveKitHealthy`) derrière le proxy.

## 5. TURN en production (devis §13)

- [ ] Déployer le TURN **mutualisé permanent** (guide : `infra/turn/coturn.conf.example`) :
      petite instance, Let's Encrypt, firewall 3478/5349/49160-49200, auth REST
      (le couple statique `TURN_USERNAME/TURN_CREDENTIAL` ne convient qu'aux tests).
- [ ] Chiffrer le coût du trafic TURN relayé (aucun fournisseur retenu dans le devis).
- [ ] Décider TURN mutualisé vs embarqué LiveKit après tests de charge/connectivité.

## 6. Tests réels avant mise en production (devis §16)

- [ ] Cycle complet : P2P (2–4) → 5ᵉ participant → création CPX22 → DNS → bascule SFU
      (badge « SFU LiveKit ») → sortie de tous → destruction auto (~10–15 min) vérifiée
      côté console Hetzner et logs (`npx wrangler tail`).
- [ ] Matrice réseau : IPv6 natif · IPv4-only · dual stack · NAT domestique · 4G/5G ·
      Wi-Fi · réseau d'entreprise restrictif.
- [ ] Mesurer : temps création CPX22, temps init LiveKit (chronométrer entre
      `sfu_provision_start` et `sfu_ready` dans le journal KV), bitrate/egress.
- [ ] Si des clients IPv4-only échouent via TURN → basculer `SFU_NET_POLICY=dual_stack`
      (coût +0,50 €/mois HT par instance maintenue) et documenter la règle retenue.

## 7. Conformité / économie (hors code)

- [ ] Rétention des journaux KV : actuellement **30 jours** (`orchestrator.ts`,
      `expirationTtl`) — aligner sur vos obligations (RGPD/fournisseur d'accès, etc.).
- [ ] Valider les tarifs Hetzner/Cloudflare à la date de commande (le devis V4 date du
      30/08/2026 ; prix CPX22 19,49 €/mois, IPv4 0,50 €/mois HT).
- [ ] Paiement/monétisation (pass réunion 5 € mentionné au devis §11) : **hors périmètre**,
      aucune passerelle n'est implémentée.
- [ ] Surveillance continue : coûts SFU (heures), trafic TURN, erreurs ICE — les
      événements KV suffisent pour démarrer ; prévoir export/métriques si besoin.

## 8. Améliorations connues (non bloquantes)

- Migration fine des flux P2P→SFU (actuellement reconnexion complète, transparente côté UI).
- Préchauffage conditionnel d'un SFU (réservation anticipée) si le démarrage à froid
  (60–180 s) est inacceptable pour votre usage.
- Test automatisé de bout en bout (Playwright) du parcours 5 participants.
- Politique adaptative IPv4/IPv6 pilotée par les erreurs ICE observées (devis §7).
