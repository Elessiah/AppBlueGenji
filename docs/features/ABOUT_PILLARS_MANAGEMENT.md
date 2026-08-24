# 🧱 Piliers « L'association » (SECTION 03, colonne droite)

## Vue d'ensemble

Les **piliers** affichés à droite de la **SECTION 03 — « L'association »**
(titre + texte, ex. « Accessible / Inscription gratuite, matchmaking par
niveau… ») sont dynamiques : ils sont stockés en base et **les administrateurs**
peuvent les **ajouter, modifier, réordonner et supprimer** directement depuis la
page, sans déploiement.

Cette section (`AboutSection`) est **partagée** entre la page d'accueil `/` et
la page `/association` : les piliers proviennent de la même source et toute
modification est reflétée aux deux endroits. Voir aussi les **cartes
chiffrées** de la colonne gauche de la même section
(`docs/features/ABOUT_STATS_MANAGEMENT.md`), gérées séparément.

Pour les visiteurs non-admins (et anonymes), la section reste en lecture seule.

## Modèle de données

Table `bg_about_pillars` (migration auto dans `lib/server/database.ts`) :

| Colonne         | Type          | Notes                                   |
| --------------- | ------------- | ---------------------------------------- |
| `id`            | BIGINT PK     | Auto-increment                           |
| `title`         | VARCHAR(60)   | Titre du pilier (ex. « Accessible »)     |
| `text`          | VARCHAR(240)  | Description sous le titre                |
| `display_order` | INT           | Ordre d'affichage (tri croissant)        |
| `created_at`    | DATETIME      | Auto                                     |
| `updated_at`    | DATETIME      | Auto                                     |

Tant que la table est vide (ou en cas de base injoignable), `listAboutPillars()`
renvoie des **piliers de secours** (`FALLBACK_ABOUT_PILLARS` — les 3 piliers
historiques : Accessible / Compétitif / Communautaire) afin que la section
reste toujours peuplée. Les piliers de secours ont un `id` négatif et **ne sont
pas modifiables** dans l'interface.

## Validation partagée

Logique dans `lib/shared/about-pillars.ts` (importable côté client et serveur) :

- `validateAboutPillarInput(input)` — normalise (trim) et valide `title` +
  `text` : les deux sont **requis** ; `title` ≤ 60 car., `text` ≤ 240 car.
- `FALLBACK_ABOUT_PILLARS` — les 3 piliers historiques, servis quand la table
  est vide ou injoignable.

## API

| Méthode & route                                | Auth   | Effet                      |
| ------------------------------------------------ | ------ | -------------------------- |
| `GET /api/association/about-pillars`             | public | Liste les piliers          |
| `POST /api/association/about-pillars`            | admin  | Crée un pilier (201)       |
| `PUT /api/association/about-pillars/[id]`        | admin  | Modifie un pilier          |
| `DELETE /api/association/about-pillars/[id]`     | admin  | Supprime un pilier         |
| `PUT /api/association/about-pillars/reorder`     | admin  | Réordonne les piliers      |

Codes d'erreur : `UNAUTHORIZED` (401), `FORBIDDEN` (403), `INVALID_ID` /
`INVALID_BODY` / `TITLE_REQUIRED` / `TEXT_REQUIRED` / `TITLE_TOO_LONG` /
`TEXT_TOO_LONG` (400), `ABOUT_PILLAR_NOT_FOUND` (404), et les erreurs de
`validateReorderIds` (`IDS_REQUIRED` / `IDS_EMPTY` / `INVALID_ID` /
`DUPLICATE_ID`, 400) pour la route de réordonnancement.

## Interface

`components/cyber/landing/AboutPillars.tsx` est un composant client (« island »)
rendu par `AboutSection`, à qui les pages serveur (`app/page.tsx`,
`app/association/page.tsx`) transmettent la liste initiale et le flag `isAdmin`.
Pour les admins, chaque pilier expose deux flèches **↑ / ↓** (réordonnancement
optimiste, avec rollback en cas d'échec — voir
`docs/features/CARD_REORDERING.md`), **« Modifier »** et **« Supprimer »** ; un
bouton **« + Ajouter une carte »** sous la liste ouvre la modale (titre + texte
sur textarea). Tous les retours (succès/erreur) passent par les **toasts**
bottom-left (`useToast()`), jamais en inline.

## Tests

- `tests/lib/shared/about-pillars.test.ts` — validation (requis, trim,
  longueurs).
- `tests/lib/server/about-pillars-service.test.ts` — CRUD + fallback (DB
  mockée).
- `tests/app/api/association/about-pillars.test.ts` — gardes d'auth,
  validation, codes HTTP des routes CRUD.
- `tests/app/api/association/about-pillars-reorder.test.ts` — gardes d'auth,
  validation, codes HTTP de la route de réordonnancement.
