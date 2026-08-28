# Rôles de permission cumulables

Système de contrôle d'accès par rôles, cumulables sur un même utilisateur. Un
utilisateur porte zéro, un ou plusieurs rôles ; les permissions associées
s'additionnent.

## Rôles

| Rôle                | Périmètre (permission)                                   |
| ------------------- | -------------------------------------------------------- |
| `ADMIN`             | **Tous les droits**, dont l'attribution des rôles.       |
| `ARBITRE`           | Création et gestion des tournois / matchs (`tournaments`).|
| `CASTER`            | Aperçu du plateau avant lancement, en lecture seule (`casting`).|
| `COMMUNITY_MANAGER` | Site vitrine (sponsors) + association (`showcase`).       |
| `RECRUTEUR`         | Page recrutement (`recruitment`).                         |

`ADMIN` est un super-rôle : il débloque toutes les permissions, y compris
`roles` (attribution des rôles à n'importe quel utilisateur).

## Permissions (domaines protégés)

- `tournaments` — `POST /api/tournaments`, `PATCH /api/admin/matches/[id]/scores`,
  `POST /api/admin/matches/[id]/resolve`, gestion via `GET /api/tournaments/[id]`.
- `casting` — `TournamentDetail.preview`, l'aperçu du plateau avant le lancement
  (`docs/features/TOURNAMENT_PREVIEW.md`). Permission de **lecture seule** :
  elle n'ouvre aucune écriture. `ARBITRE` l'obtient avec `tournaments`.
- `showcase` — `/api/landing/sponsors/*`, `/api/association/*`, `/api/benevoles/*`.
- `recruitment` — `/api/recruitment/*`.
- `roles` — `POST /api/admin/users/[id]/roles` (réservé `ADMIN`).

## Implémentation

- **Logique pure** : [`lib/shared/permissions.ts`](../../lib/shared/permissions.ts)
  (`PlatformRole`, `Permission`, `can()`, `hasPermission()`,
  `permissionsForRoles()`, `sanitizePlatformRoles()`). Importable partout.
- **Stockage** : le rôle `ADMIN` reste porté par la colonne `bg_users.is_admin` ;
  les autres rôles cumulables sont sérialisés dans `bg_users.platform_roles_json`
  (migration automatique dans `lib/server/database.ts`).
- **Résolution** : `resolveRoles(isAdmin, platform_roles_json)` (dans
  `lib/server/auth.ts`) reconstitue la liste complète ; elle est exposée sur
  `AuthUser.roles` et via `GET /api/auth/me`.
- **Attribution** : `setUserRoles(userId, roles)` remplace l'ensemble des rôles.
  Un administrateur ne peut pas modifier ses propres rôles (anti-auto-verrouillage).

## Contrôle d'accès dans une route

```ts
import { can } from "@/lib/shared/permissions";

const user = await getCurrentUser();
if (!user) return fail("UNAUTHORIZED", 401);
if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);
```

`can(user, permission)` renvoie `true` pour tout administrateur (invariant
« admin = tous les droits »), sinon vérifie le cumul des rôles de l'utilisateur.

`canAny(user, [...])` couvre le cas d'un accès ouvert à **plusieurs** domaines —
l'aperçu du plateau, par exemple, que `tournaments` comme `casting` débloquent :

```ts
const canPreview = canAny(user, ["tournaments", "casting"]);
```

## UI

La gestion des rôles se fait depuis la fiche joueur (`/joueurs/[id]`), section
« Rôles & permissions », visible uniquement par un administrateur consultant le
profil d'un autre utilisateur. Les cases à cocher sont cumulables et
enregistrées via `POST /api/admin/users/[id]/roles`.

Les rôles sont par ailleurs affichés publiquement comme badges (titres staff) en
en-tête de la fiche joueur, à côté du badge « Joueur BlueGenji ». Ce rendu
s'appuie sur le champ `displayRoles` de `FullProfileResponse`, renseigné pour
tous les visiteurs — distinct du champ `roles` (réservé au viewer admin pour
l'édition, non divulgué aux autres).
