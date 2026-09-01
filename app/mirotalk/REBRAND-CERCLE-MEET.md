# CERCLE MEET — modifications par rapport à MiroTalk P2P upstream

Ce dossier est une copie de [MiroTalk P2P v1.9.31](https://github.com/miroslavpejic85/mirotalk)
(commit shallow au 01/09/2026), rebrandée **CERCLE MEET** pour le projet
[MEET-CERCLE](https://github.com/web-app-ia/MEET-CERCLE).

La licence upstream (`LICENSE`, AGPL) et l'attribution de l'auteur
(Miroslav Pejic, section « À propos » de l'interface) sont conservées.

## Modifications effectuées

| Fichier | Modification |
|---|---|
| `app/src/config.template.js` | Section `brand` : nom, titres, descriptions et libellés en français « CERCLE MEET » ; langue par défaut `fr` ; sections sponsor/promo désactivées ; logo `logo-cercle.svg` ; analytique stats tierce **désactivée** par défaut ; note About créditant MiroTalk |
| `public/js/brand.js` | Mêmes valeurs par défaut côté client (fallback si `/brand` indisponible) |
| `package.json` | `name: cercle-meet`, description FR |
| `public/images/logo-cercle.svg` | Nouveau logo (cercle dégradé) |
| `.github/` | Supprimé (workflows CI upstream non pertinents) |

## Non modifié

- Tout le code fonctionnel (signaling Socket.io, WebRTC, REST API, host protection…)
- `LICENSE`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, crédits auteur dans la section « À propos »

## Mise à jour upstream

Pour intégrer une nouvelle version de MiroTalk : re-cloner la version cible puis
ré-appliquer les modifications ci-dessus (elles sont toutes localisées dans les
fichiers listés — aucun code fonctionnel modifié).
