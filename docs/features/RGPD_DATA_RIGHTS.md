# 🔐 RGPD — Données, consentement & droits utilisateur

## Overview

La plateforme expose une politique de confidentialité (`/rgpd`) alignée sur le
comportement réel du code (aucune affirmation non tenue), un consentement
explicite avant toute création de compte, et un export self-service des données
personnelles. Ce document décrit ces trois briques.

## 1. Politique de confidentialité (`/rgpd`)

La page est alimentée par `lib/shared/rgpd-policy.ts` (source unique des données
affichées dans le tableau « Données collectées ») :

- **`DONNEES_PROFIL`** — une ligne par donnée de profil, chacune avec **sa**
  base légale (exécution du contrat ou consentement) ; durée « Durée du
  compte », sauf la certification du tag, qui tombe aussi au retrait ou au
  changement du tag :
  - Pseudo site, Pseudo Overwatch (BattleTag), Pseudo Discord, **Certification
    du pseudo Discord**, Pseudo Marvel Rivals, Majorité déclarée, Avatar ;
  - les trois **identifiants de connexion** — ID Discord, identifiant Google,
    identifiant Blizzard —, chacun stocké **seulement** si le fournisseur est
    rattaché au compte, et retirable depuis `/profil` tant qu'il en reste un
    autre. L'ID Discord sert aussi au bot pour écrire en message privé (rappels
    de match, demandes d'adhésion). Le compte ne demande ni ne garde aucune
    adresse électronique.
  - Les pseudos Overwatch / Marvel Rivals servent **seulement** à la mise en
    relation entre joueurs (s'ajouter en jeu), **jamais** à des statistiques.
- **`DONNEE_TOURNOIS`** — résultats de tournois, base légale *Intérêt légitime*,
  conservation indéfinie (palmarès sportif).

### Affirmations alignées sur le code

- **Session** : le cookie `bg_session` expire **30 jours après la connexion**
  (TTL absolu fixé dans `createSession`, jamais rafraîchi) — et non « après
  30 jours d'inactivité ».
- **Suppression de compte** : deux gestes, décidés par `deleteOwnAccount`
  (`lib/server/users-service.ts`, règle pure `lib/shared/account-deletion.ts`)
  selon ce que le compte laisse derrière lui. Un compte qui n'a **joué aucun
  match**, n'a aucune **entrée solo inscrite** à un tournoi, n'**organise** aucun
  tournoi et ne **possède** aucune équipe vivante est **effacé** : sa ligne
  `bg_users` part, avec elle ses identités, ses sessions et le fichier de son
  avatar. Sinon il est **anonymisé** immédiatement — pseudo remplacé par un
  **pseudo d'emprunt** (`lib/shared/anonymous-pseudos.ts`), identités,
  coordonnées, avatar, rôles de plateforme et consentements effacés, la ligne restant pour que le palmarès des
  équipes adverses tienne debout. Dans les deux cas c'est immédiat, jamais un
  job différé. Les copies de sauvegarde chiffrées gardent le compte **30 jours au
  plus**, et une restauration rejoue les suppressions **de compte** intervenues
  depuis — et elles seules : un autre effacement postérieur à l'archive (tag
  retiré, réglage modifié…) reviendrait avec elle. Voir
  `docs/features/ACCOUNT_DELETION.md` et `docs/features/BACKUP_DATA_PROTECTION.md`.
- **Aucune mention de SIRET / SIREN / RNA** sur le site : l'association n'en publie pas, et l'hébergeur, particulier bénévole, n'en a pas.

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
  Rassemble le compte et ses identifiants bruts (ID Discord et méthode de
  rattachement, tag et date de certification, identifiants Google et Blizzard),
  le profil et ses réglages de visibilité, les statistiques, l'historique
  d'équipes, le palmarès, les changements de traitement dont le joueur a pris
  connaissance, ses **acceptations des conditions d'utilisation**, les
  **signalements et contestations** envoyés depuis le compte, et ses
  **notifications push** (appareils abonnés, sujets coupés) — type
  `PersonalDataExport` (`lib/shared/types.ts`). Le compte ne porte plus
  d'adresse électronique ; seule celle qu'un signalement a pu laisser pour la
  réponse y figure, avec ce signalement.
- **Format** : JSON téléchargeable (`Content-Disposition: attachment`,
  `bluegenji-donnees-<id>.json`).
- **UI** : bouton « Exporter mes données » sur `/profil`.

## 4. Changements du traitement — information des comptes existants

Quand la politique change, chaque compte existant voit, à partir de la date de
publication, une modale qui **cumule** les changements dont il n'a pas encore
pris connaissance, avec un seul bouton : « J'ai pris connaissance ». Elle
informe (art. 12 à 14) et ne demande aucun accord : ce qui repose sur
l'intérêt légitime ou le service se discute par le droit d'opposition, ce qui
repose sur le consentement se refuse par son réglage, et jamais par la
suppression du compte. Les comptes joignables sur Discord en reçoivent
aussi un résumé en message privé. Déclencher = ajouter une entrée à
`PRIVACY_CHANGES` (`lib/shared/privacy-changes.ts`). Voir
`docs/features/PRIVACY_CHANGES_CONSENT.md`.

## Fichiers concernés

| Fichier | Rôle |
| --- | --- |
| `lib/shared/rgpd-policy.ts` | Source des données affichées sur `/rgpd` |
| `app/rgpd/page.tsx` | Page politique de confidentialité |
| `components/cyber/RgpdConsentModal.tsx` | Popup de consentement |
| `app/connexion/_components/LoginForm.tsx` | Montage de l'information d'entrée et des conditions d'utilisation avant login |
| `app/api/profile/export/route.ts` | Endpoint d'export RGPD |
| `lib/server/users-service.ts` | `exportOwnData()` / `deleteOwnAccount()` |
| `app/(secured)/profil/page.tsx` | Bouton d'export + mentions OW/Marvel |
| `lib/shared/privacy-changes.ts` | Registre des changements du traitement |
| `components/privacy/PrivacyChangesModal.tsx` | Modale d'information sur les changements |
| `app/api/profile/privacy-changes/route.ts` | Enregistrement de l'acceptation |
