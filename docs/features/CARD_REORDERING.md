# ↕️ Réordonnancement des cartes (bureau, association, partenaires)

## Vue d'ensemble

En complément de l'ajout / modification / suppression déjà en place, **les
administrateurs** peuvent désormais **réordonner** les cartes des trois sections
gérables de la page, directement depuis l'interface et sans déploiement :

- **Bureau** (`SECTION 05`, `BureauSection`) — membres du bureau ;
- **L'association** (`SECTION 03`, `AboutStats`) — cartes chiffrées ;
- **Partenaires et soutiens** (`SECTION 04`, `SponsorsGrid`) — sponsors.

Chaque carte gérable expose deux flèches **↑ / ↓** à côté de « Modifier » /
« Supprimer ». Un déplacement met à jour l'ordre de façon **optimiste** (l'UI
bouge tout de suite) puis persiste ; en cas d'échec réseau/serveur, l'ordre
précédent est restauré et un **toast** d'erreur s'affiche.

Pour les visiteurs non-admins (et anonymes), les sections restent en lecture
seule. Les cartes « de secours » (`id` négatif, servies quand la table est vide)
ne sont pas réordonnables.

## Modèle de données

Aucune nouvelle table : le réordonnancement s'appuie sur la colonne
`display_order` déjà présente sur `bg_bureau_members`, `bg_about_stats` et
`bg_sponsors`. La liste est renvoyée triée par `display_order ASC` (pour les
partenaires, le tri par palier `tier` reste prioritaire).

`applyDisplayOrder(table, ids)` (`lib/server/reorder.ts`) réécrit la colonne dans
une **transaction** : le premier `id` reçoit `10`, le suivant `20`, etc. Le nom de
table est codé en dur par chaque appelant (jamais dérivé d'une entrée
utilisateur), l'interpolation est donc sûre.

## Validation partagée

`lib/shared/reorder.ts` (importable côté client et serveur) :

- `validateReorderIds(raw)` — exige un **tableau non vide** d'**entiers positifs
  distincts**. Codes d'erreur : `IDS_REQUIRED` (pas un tableau), `IDS_EMPTY`,
  `INVALID_ID` (non entier / ≤ 0), `DUPLICATE_ID`.

## API

Une route `PUT .../reorder` par section, réservée aux admins, corps
`{ "ids": number[] }` (l'ordre voulu, du premier au dernier) :

| Méthode & route                                   | Auth  | Effet                    |
| ------------------------------------------------- | ----- | ------------------------ |
| `PUT /api/association/bureau/reorder`             | admin | Réordonne le bureau      |
| `PUT /api/association/about-stats/reorder`        | admin | Réordonne les cartes     |
| `PUT /api/landing/sponsors/reorder`               | admin | Réordonne les partenaires|

Codes d'erreur : `UNAUTHORIZED` (401), `FORBIDDEN` (403), `INVALID_BODY` +
erreurs de `validateReorderIds` (400).

## Interface

Les trois composants clients ajoutent une fonction `move(index, direction)` qui
permute la carte avec son voisin, applique l'ordre localement, puis appelle la
route `reorder`. Particularité **partenaires** : l'affichage regroupe d'abord par
palier (`tier`), donc les flèches ne sont actives qu'entre deux partenaires du
**même palier** (`canMoveUp` / `canMoveDown`). Les flèches en bord de liste sont
désactivées. Tous les retours passent par les **toasts** bottom-left
(`useToast()`), jamais en inline.

## Tests

- `tests/lib/shared/reorder.test.ts` — validation (tableau, vide, entiers,
  doublons, coercition).
- `tests/app/api/association/bureau-reorder.test.ts`,
  `tests/app/api/association/about-stats-reorder.test.ts`,
  `tests/app/api/landing/sponsors-reorder.test.ts` — gardes d'auth, validation du
  corps, appel du service, codes HTTP.
