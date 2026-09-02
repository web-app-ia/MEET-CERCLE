# CERCLE MEET — Réservation et abonnement local

## Abonnement démontrable (sans paiement réel)

La page `frontend/abonnement.html` fournit une démonstration locale :

- trois offres de démonstration : Pass Réunion (5 € / 24 h), Mensuel (9,99 € / 30 jours), Annuel (89 € / 365 jours) ;
- consultation de la date d'expiration, du nombre de jours/heures restants et d'une barre de validité ;
- formulaire de paiement fictif (nom, e-mail et carte non transmis) ;
- historique local des achats avec identifiant `SIM-...` ;
- badge de l'abonnement actif dans le portail ;
- données conservées dans le `localStorage` du navigateur uniquement.

La démonstration ne protège pas encore l'accès aux salons et ne constitue pas un paiement. Pour la production, le module `frontend/assets/js/subscription.js` devra appeler le Worker pour créer une session Stripe Checkout ; seul un webhook Stripe devra confirmer l'achat et sa validité côté serveur.

## Données à personnaliser pour remplacer complètement MiroTalk par CERCLE MEET

### Identité de marque

- Nom court et nom officiel : `CERCLE MEET` ou `CERCLE TALK` — choisir une seule appellation définitive ;
- slogan court et promesse produit ;
- description courte, longue et description SEO ;
- langue(s) par défaut et traductions ;
- ton éditorial : institutionnel, associatif, professionnel, grand public, etc. ;
- nom du support client et adresse e-mail ;
- nom de l'éditeur légal, société/association, adresse, pays, numéro d'immatriculation et TVA si applicable.

### Logo et éléments graphiques

- logo principal SVG/PNG ;
- logo clair sur fond sombre et logo sombre sur fond clair ;
- icône seule pour favicon ;
- favicon 16/32/48 px ;
- icône Apple/Android 180/192/512 px ;
- image d'aperçu des liens sociaux (Open Graph) ;
- couleurs principales, secondaires, états succès/alerte/erreur ;
- polices et règles d'utilisation ;
- illustrations, avatars et visuels libres de droits ;
- charte d'espacement, rayons, ombres et composants.

### URLs et canaux officiels

- domaine portail ;
- domaine de l'app de visioconférence ;
- domaine/API du Worker ;
- URL GitHub officielle ou forge source ;
- URL de la politique de confidentialité ;
- URL des conditions générales d'utilisation ;
- URL des conditions de vente et politique de remboursement ;
- URL des mentions légales ;
- URL de la page contact/support ;
- URL des réseaux sociaux officiels ;
- URL de documentation et page d'état du service ;
- URLs STUN/TURN et domaine(s) SFU de production.

### Remplacements encore présents dans l'interface vendored

Les valeurs suivantes sont encore upstream ou liées à MiroTalk et doivent être remplacées ou validées dans `app/mirotalk` :

- liens GitHub MiroTalk et documentation `docs.mirotalk.com` ;
- crédits et liens de l'auteur Miroslav Pejic dans « À propos » — à conserver pour respecter l'AGPL, éventuellement avec une formulation co-brandée ;
- texte et lien de licence AGPLv3 ;
- image Open Graph actuellement référencée depuis `p2p.mirotalk.com` ;
- URLs de statistiques/analytics et identifiant Umami — désactivés par défaut dans CERCLE MEET, à remplacer uniquement par votre instance si nécessaire ;
- URL du questionnaire/survey ;
- URL de musique de salle d'attente ;
- URLs d'icônes, images, experts et widget support ;
- liens Stripe/don upstream visibles dans la landing upstream — désactiver ou remplacer par vos liens de vente ;
- texte « basé sur MiroTalk P2P » : ne pas supprimer l'attribution si la distribution AGPL l'exige ;
- nom `mirotalk` dans `package.json`, titres de pages, métadonnées, commentaires, documentation et messages d'erreur ;
- variables d'environnement et exemples contenant `MIROTALK`, lorsque vous souhaitez une nomenclature entièrement CERCLE.

### Informations commerciales à fournir

- offres exactes : nom, prix TTC/HT, devise, durée ;
- abonnement récurrent ou achat unique ;
- renouvellement automatique ou non ;
- période d'essai, coupons et promotions ;
- limites par offre : participants, durée, nombre de salons, enregistrement, stockage, SFU ;
- règles d'expiration, annulation, prorata et remboursement ;
- pays acceptés et moyens de paiement ;
- adresse Stripe du compte marchand et produits/prix Stripe ;
- e-mail d'envoi des reçus et factures ;
- politique de conservation et suppression des données de facturation.

### Données techniques de production

- compte Cloudflare et zone DNS ;
- compte Hetzner et région/plan ;
- secrets Stripe : clé secrète et secret de webhook — à saisir uniquement comme secrets du Worker, jamais dans le frontend ;
- stockage des utilisateurs/abonnements (D1, KV ou autre base) ;
- fournisseur d'authentification et méthode de connexion ;
- durée de session et politique de suppression de compte ;
- e-mail transactionnel et identifiants SMTP/API ;
- outil de monitoring et adresse d'alerte ;
- règles CORS, CSP, cookies, sauvegardes et rétention des logs ;
- certificat TLS et reverse-proxy ;
- règles de modération, signalement, bannissement et assistance.

### Important — limite juridique de la marque

Même avec tous les remplacements visuels, CERCLE MEET restera un logiciel incorporant MiroTalk tant que son code sera dérivé de MiroTalk. Pour un remplacement « 100 % CERCLE MEET » au sens commercial, il faut :

1. remplacer tous les liens, logos, textes, analytics et contacts upstream non nécessaires ;
2. conserver les mentions de licence et d'attribution exigées par l'AGPL ;
3. publier les sources correspondantes et les modifications ;
4. vérifier les conditions exactes de la version MiroTalk utilisée et, si nécessaire, obtenir un avis juridique ou une licence commerciale.

Le nom demandé dans cette session est **CERCLE MEET**. Si la marque finale doit être **CERCLE TALK**, il faudra renommer de manière cohérente le portail, l'app, les titres, les URLs, les e-mails, les offres et les documents.
