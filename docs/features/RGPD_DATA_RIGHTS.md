# 🔐 RGPD — Données, consentement & droits utilisateur

## Overview

La plateforme expose une politique de confidentialité (`/rgpd`) alignée sur le
comportement réel du code (aucune affirmation non tenue), un consentement
explicite avant toute création de compte, et un export self-service des données
personnelles. Ce document décrit ces trois briques.

## 1. Politique de confidentialité (`/rgpd`)

La page est alimentée par `lib/shared/rgpd-policy.ts` (source unique des données
affichées dans le tableau « Données collectées ») :

- **`DONNEES_PROFIL`** — données de profil, base légale *Consentement*, durée
  « Durée du compte » :
  - Pseudo site, Pseudo Discord, Pseudo Overwatch, Pseudo Marvel Rivals, Avatar
  - **ID Discord** — stocké **uniquement** en cas de connexion via Discord
    (envoi du code d'authentification en DM).
  - Les pseudos Overwatch / Marvel Rivals servent **seulement** à la mise en
    relation entre joueurs (s'ajouter en jeu), **jamais** à des statistiques.
- **`DONNEE_TOURNOIS`** — résultats de tournois, base légale *Intérêt légitime*,
  conservation indéfinie (palmarès sportif).

### Affirmations alignées sur le code

- **Session** : le cookie `bg_session` expire **30 jours après la connexion**
  (TTL absolu fixé dans `createSession`, jamais rafraîchi) — et non « après
  30 jours d'inactivité ».
- **Suppression de compte** : deux gestes, décidés par `deleteOwnAccount`
  (`lib/server/users-service.ts`) selon ce que le compte laisse derrière lui. Un
  compte **jamais engagé** est **effacé** : sa ligne `bg_users` part, avec elle
  ses identités, ses sessions et le fichier de son avatar. Un compte qui a
  **joué** est **anonymisé** immédiatement — pseudo neutralisé, identités,
  coordonnées et avatar effacés, la ligne restant pour que le palmarès des
  équipes adverses tienne debout. Dans les deux cas c'est immédiat, jamais un
  job différé ; des copies de sauvegarde techniques peuvent subsister quelques
  jours. Voir `docs/features/ACCOUNT_DELETION.md`.
- **Aucune mention de SIRET / RNA** (données non publiées) sur le site.

## 2. Consentement à l'inscription

`components/cyber/RgpdConsentModal.tsx`, monté sur `/connexion` :

- S'affiche **avant toute action de connexion** tant que le consentement n'a pas
  été accordé (clé `localStorage` `bg_rgpd_consent`).
- Présente l'usage des données et renvoie vers `/rgpd`.
- **Refus = retour en arrière total** : aucune requête d'authentification n'est
  déclenchée, donc **aucune donnée n'est enregistrée** (retour à l'accueil).
- Acceptation mémorisée pour ne pas re-solliciter à chaque visite.

## 3. Export des données (droit à la portabilité, art. 20)

- **Route** : `GET /api/profile/export` — réservée au **propriétaire** du compte
  (`getCurrentUser`). N'exporte jamais les données d'un tiers.
- **Service** : `exportOwnData(userId)` dans `lib/server/users-service.ts`.
  Rassemble les identifiants bruts (email, ID Discord, Google sub), le profil,
  les statistiques, l'historique d'équipes et le palmarès.
- **Format** : JSON téléchargeable (`Content-Disposition: attachment`,
  `bluegenji-donnees-<id>.json`).
- **UI** : bouton « Exporter mes données » sur `/profil`.

## Fichiers concernés

| Fichier | Rôle |
| --- | --- |
| `lib/shared/rgpd-policy.ts` | Source des données affichées sur `/rgpd` |
| `app/rgpd/page.tsx` | Page politique de confidentialité |
| `components/cyber/RgpdConsentModal.tsx` | Popup de consentement |
| `app/connexion/page.tsx` | Montage du consentement avant login |
| `app/api/profile/export/route.ts` | Endpoint d'export RGPD |
| `lib/server/users-service.ts` | `exportOwnData()` / `deleteOwnAccount()` |
| `app/(secured)/profil/page.tsx` | Bouton d'export + mentions OW/Marvel |
