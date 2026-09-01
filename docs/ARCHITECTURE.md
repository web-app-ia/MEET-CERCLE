# Architecture — MEET-CERCLE (conforme devis V4)

## 1. Vue d'ensemble

| Couche | Composant | Rôle |
|---|---|---|
| Interface | `frontend/` (statique) | Portail : lobby, création de salon, redirection vers CERCLE MEET |
| App de visio | `app/mirotalk/` — **CERCLE MEET** (MiroTalk P2P v1.9.31 rebrandé) | Salons vidéo complets : WebRTC P2P mesh, chat, partage d'écran, tableau blanc, signaling Node/Socket.io |
| Orchestration | `worker/` (Cloudflare Workers) | Décision P2P/SFU, provisionnement/destruction Hetzner, tokens |
| État | Durable Object `RoomDO` + KV `STATE` | État transactionnel par salon + index/journaux globaux |
| Média | LiveKit Server éphémère (Hetzner CPX22) | SFU à la demande, détruit après usage |
| Réseau | IPv6-first + TURN mutualisé | Compatibilité NAT/firewalls sans surcoût IPv4 systématique |

Le portail crée/réserve le salon via l'orchestrateur puis ouvre l'interface
**CERCLE MEET** (`/join/?room=...&name=...`). MiroTalk embarque sa propre
signalisation et son app P2P complète ; le rebrandage passe par son système de
marque intégré (`app/src/config.template.js` section `brand` + `public/js/brand.js`),
sans modification du code fonctionnel (voir `app/mirotalk/REBRAND-CERCLE-MEET.md`).
Pour les grandes réunions, la variante [mirotalksfu](https://github.com/miroslavpejic85/mirotalksfu)
(qui s'appuie sur LiveKit) est la cible naturelle du provisionnement éphémère —
voir `A-COMPLETER-MANUELLEMENT.md` §5.

## 2. Cycle de vie d'un salon (devis §8)

1. **Création** — `POST /api/rooms` → index KV `room:<nom>` ; le salon naît en phase `p2p`.
2. **Contrôle** — `POST /api/rooms/:room/join` → le `RoomDO` (verrou implicite : exécution
   mono-thread) vérifie quotas/droits/état, purges des participants fantômes.
3. **Provisionnement** — si `participants + 1 > P2P_MAX_PARTICIPANTS` et phase `p2p` :
   passage en phase `provisioning` (une seule création possible même si 10 joins arrivent
   en parallèle) puis appel orchestrateur :
   - `POST https://api.hetzner.cloud/v1/servers` avec `public_net.enable_ipv4 = false`
     (politique A/B) ou `true` (politique C), `user_data` = cloud-init LiveKit ;
   - attente état `running` (poll borné) ;
   - création record DNS **AAAA** éphémère (record gris, non proxifié) chez Cloudflare ;
   - poll de santé `POST /twirp/livekit.RoomService/ListRooms` jusqu'à 200 OK (≤ 3 min).
4. **Initialisation** — cloud-init installe livekit-server (installeur officiel),
   config `bind_addresses: ["::"]` (IPv6-first), ports RTC 7881/TCP + 50000-50200/UDP.
5. **Ouverture** — le DO diffuse `sfu-ready` sur les WebSockets de signalisation ; chaque
   client ferme sa session P2P, récupère un token JWT via `/join` et connecte LiveKit.
6. **Maintien** — présence : WS heartbeat (P2P) + HTTP heartbeat 30 s (les deux modes),
   ce qui protège contre la destruction prématurée.
7. **Fin** — dernier participant parti → `lastEmptyAt` horodaté.
8. **Anti-suppression** — cron (5 min) : salon vide **et** délai de sécurité
   (`SFU_GRACE_PERIOD_MS`, 10 min par défaut) **et** re-vérification finale dans le DO
   (`activeCount() === 0`) avant toute action irréversible.
9. **Destruction** — suppression serveur Hetzner + records DNS AAAA/A ; journalisation
   `sfu_destroyed` avec durée de vie (facturation réelle) ; index KV archivé.

Cas d'échec couverts : provisionnement échoué → nettoyage best-effort serveur+DNS,
retour en phase `p2p`, cooldown 2 min ; salon mort pendant provisioning → SFU détruit
immédiatement ; crash du DO → phase/SFU persistés dans le stockage transactionnel.

## 3. Politique réseau (devis §4–7)

| Mode | Config SFU | Déclenchement | Coût |
|---|---|---|---|
| A — IPv6-only | CPX22 + Primary IPv6 (gratuite), IPv4 désactivée | défaut (`SFU_NET_POLICY=ipv6_only`) | ~0,0312 €/h |
| B — IPv6 + TURN | idem A + TURN mutualisé permanent | défaut avec TURN configuré | + trafic TURN |
| C — Dual stack | + Primary IPv4 (0,50 €/mois HT) | `SFU_NET_POLICY=dual_stack` | ~0,0320 €/h |

Règle centrale : **IPv6-first, jamais IPv6-only par principe.** Le client reçoit la
liste ICE (STUN + TURN/TCP + TURN/TLS) depuis `GET /api/config` ; un client IPv4-only
ne peut joindre un SFU IPv6-only **que via TURN** (le TURN, lui, est dual-stack).
La bascule automatique vers IPv4 n'est **pas** implémentée : elle doit être décidée à
partir de signaux observés (erreurs ICE, tests réels) — voir §16 du devis et
`A-COMPLETER-MANUELLEMENT.md`.

## 4. Signalisation P2P

Protocole JSON sur WebSocket (`/api/rooms/:room/ws`), relayé par le `RoomDO`
(hibernation API : les sockets survivent aux redéploiements courts) :

`hello` → `peers` (liste aux nouveaux) · `peer-joined` · `peer-left` · `offer` ·
`answer` · `ice` · `chat` · `presence` · `heartbeat` · `sfu-ready`.

Négociation WebRTC : pattern *perfect negotiation* avec rôle `polite` déterministe
(comparaison lexicographique des `participantId`), donc sans boucle de collision d'offre.

## 5. Sécurité et garde-fous (devis §14)

- Tokens LiveKit **JWT HS256** signés côté Worker (Web Crypto) ; jamais de secret dans le client.
- CORS ouvert par défaut (`*`) à **restreindre** à l'origine du frontend en production.
- Idempotence : verrou d'unicité du provisionnement dans le DO ; `deleteServer`/`deleteDnsRecord` idempotents (404 = succès).
- Retries bornés : tous les polls ont une deadline (120 s Hetzner, 180 s LiveKit).
- Double vérification avant destruction (cron + DO).
- Journal KV des événements (`room_created`, `sfu_provision_start/failed`, `sfu_ready`,
  `sfu_destroyed`, …) avec rétention 30 jours — à aligner sur vos obligations légales.
- Secrets Hetzner/LiveKit/TURN/DNS uniquement via `wrangler secret`.

## 6. Limites connues et hypothèses

- **Démarrage à froid** : 60–180 s entre le 5ᵉ participant et le SFU prêt (devis §15) ;
  la réunion continue en P2P pendant ce temps.
- **Pas de migration fine** des flux P2P → SFU : bascule par reconnexion (toutes les
  tuiles se reconstruisent), acceptable pour des réunions courtes.
- **Pas de paiement, d'enregistrement, de modération** : hors périmètre du devis (§18).
- `TURN_URL/TURN_USERNAME/TURN_CREDENTIAL` statiques conviennent au test ; pour la
  production préférer l'auth REST TURN (secret partagé + timestamps), non implémentée ici.
- Le frontend suppose que la page est servie en **HTTPS** (contexte sécurisé obligatoire
  pour `getUserMedia`) — en dev local, `http://localhost` est exempté par les navigateurs.
