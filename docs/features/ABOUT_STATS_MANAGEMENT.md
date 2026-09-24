# 📊 Cartes « L'association » (SECTION 03)

## Vue d'ensemble

Les **cartes chiffrées** affichées sous le titre de la **SECTION 03 —
« L'association »** (valeur + titre, ex. `100% / Bénévole`, `€4 200 /
Prizepool 2025`) sont désormais dynamiques : elles sont stockées en base et **les
administrateurs** peuvent les **ajouter, modifier et supprimer** directement
depuis la page, sans déploiement.

Cette section (`AboutSection`) est **partagée** entre la page d'accueil `/` et la
page `/association` : les cartes proviennent de la même source et toute
modification est reflétée aux deux endroits. Les piliers à droite (Accessible /
Compétitif / Communautaire par défaut) sont eux aussi éditables — voir
`docs/features/ABOUT_PILLARS_MANAGEMENT.md`. Seul le texte d'intro reste
statique.

Pour les visiteurs non-admins (et anonymes), la section reste en lecture seule.

## Modèle de données

Table `bg_about_stats` (migration auto dans `lib/server/database.ts`) :

| Colonne         | Type          | Notes                                   |
| --------------- | ------------- | --------------------------------------- |
| `id`            | BIGINT PK     | Auto-increment                          |
| `value`         | VARCHAR(40)   | Valeur affichée (ex. « €4 200 », « 12 »)|
| `label`         | VARCHAR(60)   | Titre sous la valeur (ex. « Arbitres ») |
| `display_order` | INT           | Ordre d'affichage (tri croissant)       |
| `created_at`    | DATETIME      | Auto                                    |
| `updated_at`    | DATETIME      | Auto                                    |

Tant que la table est vide (ou en cas de base injoignable), `listAboutStats()`
renvoie des **cartes de secours** (`FALLBACK_ABOUT_STATS`) afin que la section
reste toujours peuplée. Les cartes de secours ont un `id` négatif et **ne sont
pas modifiables** dans l'interface.

## Validation partagée

Logique dans `lib/shared/about-stats.ts` (importable côté client et serveur) :

- `validateAboutStatInput(input)` — normalise (trim) et valide `value` + `label` :
  les deux sont **requis** ; `value` ≤ 40 car., `label` ≤ 60 car.
- `FALLBACK_ABOUT_STATS` — les 4 cartes historiques, servies quand la table est
  vide ou injoignable.

## API

| Méthode & route                             | Auth   | Effet                    |
| ------------------------------------------- | ------ | ------------------------ |
| `GET /api/association/about-stats`          | public | Liste les cartes         |
| `POST /api/association/about-stats`         | admin  | Crée une carte (201)     |
| `PUT /api/association/about-stats/[id]`     | admin  | Modifie une carte        |
| `DELETE /api/association/about-stats/[id]`  | admin  | Supprime une carte       |

Codes d'erreur : `UNAUTHORIZED` (401), `FORBIDDEN` (403), `INVALID_ID` /
`INVALID_BODY` / `VALUE_REQUIRED` / `LABEL_REQUIRED` / `VALUE_TOO_LONG` /
`LABEL_TOO_LONG` (400), `ABOUT_STAT_NOT_FOUND` (404).

## Interface

`components/cyber/landing/AboutStats.tsx` est un composant client (« island »)
rendu par `AboutSection`, à qui les pages serveur (`app/page.tsx`,
`app/association/page.tsx`) transmettent la liste initiale et le flag `isAdmin`.
Pour les admins :

- chaque carte expose **« Modifier »** et **« Supprimer »** ;
- un bouton **« + Ajouter une carte »** sous la grille ouvre la modale ;
- tous les retours (succès/erreur) passent par les **toasts** bottom-left
  (`useToast()`), jamais en inline.

La modale passe par **`LandingDialog`** (`components/cyber/landing/LandingDialog.tsx`,
partagé avec les partenaires) : portée dans `document.body`, elle confie focus
initial, Échap, piège de tabulation et verrou du défilement à
`useDialogBehavior`. Rendue dans la section, elle restait prisonnière du
contexte d'empilement que pose `.root` d'`AboutSection` (`position: relative;
z-index: 1`) : son `z-index: 1000` ne valait que dans la section, si bien que
la section des partenaires, peinte après, passait par-dessus selon la position
de défilement — et la page continuait de défiler sous le voile. Le voile ne se
ferme que sur un appui **commencé et relâché** sur lui (`useBackdropDismiss`) :
une sélection de texte relâchée hors du panneau ne jette plus la saisie. Les
trois règles communes à toutes les modales : `docs/features/MODAL_DIALOGS.md`.

## Tests

- `tests/app/modal-dialogs.test.ts` — modales de la vitrine passées par
  `LandingDialog` ; portail, pile commune et voile sur toutes les modales du
  site (balayage de source).
- `tests/lib/shared/backdrop-dismiss.test.ts` — fermeture par le voile.
- `tests/lib/shared/about-stats.test.ts` — validation (requis, trim, longueurs).
- `tests/lib/server/about-stats-service.test.ts` — CRUD + fallback (DB mockée).
- `tests/app/api/association/about-stats.test.ts` — gardes d'auth, validation,
  codes HTTP des routes.
