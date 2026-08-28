# Équipes fantômes

Une **équipe fantôme** est une équipe créée par le staff pour représenter une
formation qui n'a aucun compte joueur sur le site : équipe invitée, équipe
inscrite hors plateforme, ou simple remplissage de bracket.

Elle porte `bg_teams.is_ghost = 1` et **n'a aucun membre**. C'est cette absence
de propriétaire qui justifie la dérogation d'administration : le staff la gère
sans en être membre.

## Permission

Tout passe par `can(user, "tournaments")` — donc `ADMIN` et `ARBITRE`
(voir `PERMISSION_ROLES.md`). Aucun contrôle ne teste `isAdmin` directement.

La dérogation est **strictement bornée aux équipes fantômes** : sur une équipe
réelle, un arbitre n'a pas plus de droits qu'un visiteur.

## Modèle

| Élément | Détail |
| --- | --- |
| Colonne | `bg_teams.is_ghost TINYINT(1) NOT NULL DEFAULT 0` (migration auto) |
| Membres | aucun (`bg_team_members` reste vide pour l'équipe) |
| Logique pure | — |
| Service | `lib/server/ghost-teams-service.ts` (création, attribution, liste) |
| Dérogations | `lib/server/teams-service.ts`, paramètre `viewerManagesGhostTeams` |

## Cycle de vie

```
création (staff)  →  inscription à un tournoi  →  attribution à un joueur
                                              ↘  ou dissolution (soft-delete)
```

1. **Création** — `POST /api/teams` avec `{ name, description?, ghost: true }`.
   Contrairement à une équipe réelle, l'auteur n'en devient pas propriétaire :
   il garde son équipe active.
2. **Administration** — nom, description et logo passent par les routes
   existantes (`PATCH /api/teams/[id]`, `POST|DELETE /api/teams/[id]/logo`).
   Les services acceptent un dernier argument `viewerManagesGhostTeams`, fourni
   par la route depuis les rôles du viewer.
3. **Inscription à un tournoi** — `POST /api/admin/tournaments/[id]/ghost-registrations`
   avec `{ teamId }`. La route refuse (`NOT_A_GHOST_TEAM`, 409) toute équipe
   réelle : le staff n'inscrit jamais l'équipe d'un joueur à sa place. Les
   contrôles d'état, de doublon et de capacité sont ceux de l'inscription
   normale (`registerTeam` dans `lib/server/tournaments/registration.ts`).
4. **Attribution** — `POST /api/teams/[id]/claim` avec `{ pseudo }`. Le joueur
   devient `OWNER`, `is_ghost` repasse à 0 et l'équipe redevient ordinaire.
   Refus si le joueur appartient déjà à une équipe (`USER_ALREADY_IN_TEAM`),
   si le compte est anonymisé (`bg_users.is_deleted = 1` → `USER_NOT_FOUND`),
   si l'équipe est réelle (`NOT_A_GHOST_TEAM`) ou dissoute
   (`TEAM_ALREADY_DELETED`).

   L'attribution est le **seul** chemin de passation sur une fantôme : faute de
   ligne `bg_team_members`, `POST /api/teams/[id]/transfer-ownership` y répond
   toujours `FORBIDDEN` (personne n'y est `OWNER`). Une fois attribuée,
   l'équipe est ordinaire et son propriétaire transfère la propriété comme
   n'importe quelle autre (voir ci-dessous).
5. **Dissolution** — `DELETE /api/teams/[id]`, le même soft-delete que pour une
   équipe réelle : nom anonymisé, historique de tournois conservé.

## Interface

- **`/equipes`** — bouton « Équipe fantôme » (staff uniquement) ouvrant
  `GhostTeamDialog`; badge `FANTÔME` sur les cartes concernées.
- **`/equipes/[id]`** — badge dans le titre, formulaire de gestion habituel
  (`canManage` est vrai pour le staff sur une fantôme), et deux actions
  spécifiques : « Attribuer à un joueur » et « Supprimer l'équipe fantôme ».
  Le bloc d'adhésion est remplacé par un message : une fantôme ne se rejoint
  pas, elle s'attribue. Le bloc « Inviter un membre » et la relève des demandes
  d'adhésion sont masqués (`canManage && !isGhost`) : les routes de roster
  refusent la dérogation fantôme, ces contrôles ne pourraient que renvoyer 403.
- **`/tournois/[id]`** — bouton « + Équipe fantôme » pendant les inscriptions,
  permettant de choisir une fantôme existante ou d'en créer une à la volée.

## Champs exposés

`TeamListItem.isGhost`, `TeamDetailResponse.team.isGhost` et
`TeamDetailResponse.managedAsGhost` (le viewer administre cette équipe au titre
de la permission, pas d'une appartenance). `GET /api/teams` renvoie aussi
`canManageGhostTeams` pour piloter l'affichage des contrôles.

## Tests

- `tests/lib/server/ghost-teams-service.test.ts` — création, attribution
  (tous les refus), liste, rollback transactionnel.
- `tests/lib/server/teams-service.ghost.test.ts` — la dérogation autorise le
  staff sur une fantôme et **jamais** sur une équipe réelle.
- `tests/app/api/teams/ghost-teams.test.ts` — création et attribution côté route.
- `tests/app/api/admin/ghost-registrations.test.ts` — inscription en tournoi.

> **Piège connu.** L'attribution filtrait le futur propriétaire sur
> `bg_users.deleted_at`, colonne qui n'existe que sur `bg_teams` — `bg_users`
> marque l'anonymisation avec `is_deleted`. MySQL rejetait donc la requête
> (`ER_BAD_FIELD_ERROR`) et **toute** attribution répondait 400. Les tests
> simulent la base : ils ne voient pas une colonne absente. D'où le test
> `cherche le futur propriétaire sur is_deleted, jamais sur deleted_at`, qui
> vérifie la forme de la requête, et la règle du `CLAUDE.md` : passer par
> `npm run seed` et l'application réelle avant de conclure.

## Transfert de propriété (équipes réelles)

Distinct de l'attribution : `POST /api/teams/[id]/transfer-ownership` avec
`{ newOwnerUserId }`, réservé au propriétaire en place
(`transferTeamOwnership`, `lib/server/teams-service.ts`). La cible doit être un
**membre actif** de l'équipe.

| Règle | Effet |
| --- | --- |
| Demandeur non `OWNER` (ou étranger à l'équipe) | `FORBIDDEN` → 403 |
| Cible hors du roster | `MEMBER_NOT_FOUND` → 404 |
| Cible = demandeur | `TRANSFER_TO_SELF` → 400 |
| Succès | `OWNER` passe à la cible, en tête de ses rôles existants |

L'ancien propriétaire **reste dans l'équipe** : il perd `OWNER` et garde ses
autres rôles, ou reçoit `DPS` s'il n'en avait aucun (même repli que
`addTeamMember`). Les deux lignes sont réécrites dans une transaction.

Interface : `TransferOwnershipDialog` (`/equipes/[id]`), liste des membres non
propriétaires et confirmation en deux temps.

Tests : `tests/lib/server/teams-service.ownership.test.ts` (service, refus et
rollback) et `tests/app/api/teams/transfer-ownership.test.ts` (route, codes
HTTP).
