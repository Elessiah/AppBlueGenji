# Rôles de permission cumulables

Système de contrôle d'accès par rôles, cumulables sur un même utilisateur. Un
utilisateur porte zéro, un ou plusieurs rôles ; les permissions associées
s'additionnent.

## Rôles

| Rôle                | Périmètre (permission)                                   |
| ------------------- | -------------------------------------------------------- |
| `ADMIN`             | **Tous les droits**, dont l'attribution des rôles.       |
| `ARBITRE`           | Création et gestion des tournois / matchs (`tournaments`).|
| `CASTER`            | Aperçu du plateau avant lancement en lecture seule (`casting`), et diffusion en direct des matchs (`live`). |
| `COMMUNITY_MANAGER` | Site vitrine (sponsors) + association (`showcase`).       |
| `RECRUTEUR`         | Page recrutement (`recruitment`).                         |

`ADMIN` est un super-rôle : il débloque toutes les permissions, y compris
`roles` (attribution des rôles à n'importe quel utilisateur).

## Permissions (domaines protégés)

- `tournaments` — `POST /api/tournaments`, `PATCH /api/admin/matches/[id]/scores`,
  `POST /api/admin/matches/[id]/resolve`, gestion via `GET /api/tournaments/[id]`.
- `live` — état de diffusion des matchs : marquer un match comme casté, sa
  chaîne, l'ouverture et la fermeture de son antenne. C'est un droit d'**écriture**,
  volontairement distinct de `casting` (lecture seule) et de `tournaments` : un
  streamer ouvre l'antenne sans toucher aux scores. Voir `LIVE_STREAMS.md`.
- `casting` — `TournamentDetail.preview`, l'aperçu du plateau avant le lancement
  (`docs/features/TOURNAMENT_PREVIEW.md`). Permission de **lecture seule** :
  elle n'ouvre aucune écriture. `ARBITRE` l'obtient avec `tournaments`.
- `showcase` — `/api/landing/sponsors/*`, `/api/association/*`, `/api/benevoles/*`.
- `recruitment` — `/api/recruitment/*`.
- `roles` — `POST /api/admin/users/[id]/roles` (réservé `ADMIN`).
- `moderation` — panneau `/admin/signalements`, `/api/admin/reports/*`,
  `/api/admin/logo-quarantines/*`, `DELETE /api/admin/teams/[id]/logo`,
  `DELETE /api/admin/users/[id]/avatar` (réservé `ADMIN` : retirer le contenu
  d'un membre engage la responsabilité de l'association). Voir
  `CONTENT_REPORTS.md`.

## Implémentation

- **Logique pure** : [`lib/shared/permissions.ts`](../../lib/shared/permissions.ts)
  (`PlatformRole`, `Permission`, `can()`, `hasPermission()`,
  `permissionsForRoles()`, `sanitizePlatformRoles()`). Importable partout.
- **Stockage** : le rôle `ADMIN` reste porté par la colonne `bg_users.is_admin` ;
  les autres rôles cumulables sont sérialisés dans `bg_users.platform_roles_json`
  (migration automatique dans `lib/server/database/`).
- **Résolution** : `resolveRoles(isAdmin, platform_roles_json)` (dans
  `lib/server/auth.ts`) reconstitue la liste complète ; elle est exposée sur
  `AuthUser.roles` et via `GET /api/auth/me`.
- **Attribution** : `setUserRoles(userId, roles)` remplace l'ensemble des rôles
  d'un **autre** compte.
- **Ses propres rôles** (ADMIN-SELF-ROLES) : `setOwnPlatformRoles(adminId, roles)`
  — voir § « Un administrateur règle ses propres rôles ».
- **Journal du staff** : tout enregistrement réussi passe par
  `publishRolesChange` (`publishStaffAction`) — sur Discord une ligne sans
  personne nommée (`ROLES_CHANGE_DISCORD_LINE`), dans pm2 l'auteur, le compte
  visé par son identifiant (« son propre compte » quand c'est le sien) et les
  rôles enregistrés (`rolesChangeAuditLine`). Un refus ne laisse aucune trace.

## Un administrateur règle ses propres rôles

`POST /api/admin/users/[id]/roles` avec `id` = l'appelant :

- ✅ un **administrateur** (colonne `is_admin`) règle ses rôles cumulables
  (`ARBITRE`, `CASTER`, `COMMUNITY_MANAGER`, `RECRUTEUR`) — ils s'affichent en
  titres sur sa fiche (`displayRoles`) et lui restent si un autre administrateur
  lui retire l'administration ;
- ❌ il ne retire **jamais** son propre `ADMIN` : la sélection doit le contenir,
  sinon `400 CANNOT_REMOVE_OWN_ADMIN` (rattaché à la case « Administrateur » par
  `SELF_ROLES_FIELD_ERRORS`). Se retirer l'administration reste le geste d'un
  autre administrateur — sans quoi le dernier fermerait la plateforme ;
- ❌ tout autre compte reste refusé : `403` sans la permission `roles`, et
  `400 CANNOT_MODIFY_SELF` pour un `ADMIN` porté par le seul cumul sans la
  colonne `is_admin` (la colonne est ce que l'écriture conditionne) ;
- **course** avec une rétrogradation : l'écriture ne touche que
  `platform_roles_json`, sous `WHERE … AND is_admin = 1`. Un autre
  administrateur qui retire l'administration entre la lecture de la session et
  l'écriture fait échouer celle-ci (`NOT_ADMIN` → `403 FORBIDDEN`) au lieu de
  voir sa décision annulée par un `is_admin = 1` réécrit.

**Aucune plateforme sans administrateur** : sur le compte d'un autre aussi,
l'écriture (`setUserRoles(cible, rôles, auteur)`) exige que l'auteur soit
**encore** administrateur. Elle verrouille les deux lignes (auteur et cible) en
première instruction d'une transaction, par une seule requête sans jointure
(`WHERE id IN (?, ?) … FOR UPDATE`, syntaxe commune à MySQL et MariaDB),
avant de relire l'auteur et d'écrire. InnoDB prend les verrous dans l'ordre de
la clé primaire : deux administrateurs qui se modifient l'un l'autre au même
instant s'attendent au lieu de s'interbloquer, et le second relit l'état validé
par le premier — s'il vient de perdre l'administration, `NOT_ADMIN` → `403
FORBIDDEN`. Une jointure dans l'`UPDATE` (première version) prenait les deux
lignes dans un ordre propre à chaque requête : interblocage, `500`, dès que deux
administrateurs se modifiaient l'un l'autre.

L'écran : section « Mes rôles » de `/profil` (`SelfRolesField`, FR + EN,
espace `profile.platformRoles`), rendue pour un administrateur seulement
(`requires: "adminRoles"` dans `profile-sections.ts`). La case
« Administrateur » reste cochée et focalisable (`aria-disabled`), avec son
« i » ; tout écart passe par une confirmation (gagne / perd), puis
`router.refresh()`.

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
profil d'un autre utilisateur ; ses propres rôles, un administrateur les règle
depuis « Mon profil » (§ ci-dessus). Les cases à cocher sont cumulables et
enregistrées via `POST /api/admin/users/[id]/roles`.

Les rôles sont par ailleurs affichés publiquement comme badges (titres staff) en
en-tête de la fiche joueur, à côté du badge « Joueur BlueGenji ». Ce rendu
s'appuie sur le champ `displayRoles` de `FullProfileResponse`, renseigné pour
tous les visiteurs — distinct du champ `roles` (réservé au viewer admin pour
l'édition, non divulgué aux autres).

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Rôles de permission de plateforme** (cumulables, distincts des rôles d'équipe) : `ADMIN`, `ARBITRE` (tournois + diffusion), `CASTER` (aperçu du plateau en lecture seule + diffusion), `COMMUNITY_MANAGER` (site vitrine + association), `RECRUTEUR` (recrutement). Toujours protéger une route avec `can(user, "<permission>")` de `@/lib/shared/permissions` (permissions : `tournaments`, `casting`, `live`, `showcase`, `recruitment`, `roles`, `moderation`) — ne pas tester `user.isAdmin` directement pour un domaine scopé. `canAny(user, [...])` pour un accès ouvert à plusieurs domaines. `casting` ne donne **que** la lecture de l'aperçu ; `live` est le droit d'écriture sur l'état de diffusion. `ADMIN` a tous les droits. Voir `docs/features/PERMISSION_ROLES.md`.
