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
   avec `{ teamIds: [...] }`, **une ou plusieurs** à la fois (voir
   « Inscription en lot » ci-dessous). Le moteur refuse (`NOT_A_GHOST_TEAM`,
   409) toute équipe réelle : le staff n'inscrit jamais l'équipe d'un joueur à
   sa place. Les contrôles d'état, de doublon et de capacité sont ceux de
   l'inscription normale (`registerTeam` dans
   `lib/server/tournaments/registration.ts`).
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
  permettant de cocher plusieurs fantômes existantes ou d'en créer une à la
  volée (`GhostRegistrationDialog`). La liste porte une recherche (insensible à
  la casse et aux accents) et défile dans un `<ScrollArea>` ; un compteur
  « sélection / places restantes » désactive le bouton avant l'aller-retour.

## Champs exposés

`TeamListItem.isGhost`, `TeamDetailResponse.team.isGhost` et
`TeamDetailResponse.managedAsGhost` (le viewer administre cette équipe au titre
de la permission, pas d'une appartenance). `GET /api/teams` renvoie aussi
`canManageGhostTeams` pour piloter l'affichage des contrôles.

## Inscription en lot

`POST /api/admin/tournaments/[id]/ghost-registrations` prend `{ teamIds }` — une
liste, jamais un identifiant seul : inscrire une fantôme et en inscrire trente
suit désormais le même chemin, il n'y a pas deux règles à tenir.

| Élément | Détail |
| --- | --- |
| Logique pure | `lib/shared/ghost-registration.ts` (lecture de la sélection, recherche, phrases) |
| Orchestration | `registerGhostTeams` (`lib/server/tournaments/index.ts`) → `registerTeamsByIds` (`.../registration.ts`) |
| Liste proposée | `listGhostTeams(tournamentId)` — les déjà engagées sont écartées **en base** |
| Interface | `GhostRegistrationDialog` (`app/(secured)/tournois/[id]/_components/`) |

### Tout ou rien

Un lot est **une seule intention** : ou bien les fantômes choisies entrent
toutes, ou bien aucune n'entre. Une seule transaction, défaite au premier refus,
et **un seul** `publishUpdatedEvent` après le commit — le panneau d'inscriptions
et l'aperçu du plateau se refont une fois, sur l'état final, plutôt que N fois
sur des états intermédiaires qui n'ont jamais existé hors de la transaction.

Le résultat partiel a été écarté : il obligerait le staff à recouper sa
sélection contre la liste des inscrites pour savoir ce qui est passé, et
distribuerait les rangs de départ à un préfixe arbitraire de la sélection. En
contrepartie, le refus **nomme l'engagé qui a bloqué** — le corps de l'erreur
porte `teamId` quand le refus en désigne un (`ALREADY_REGISTERED`,
`NOT_A_GHOST_TEAM`, `TEAM_ALREADY_DELETED`, `TEAM_NOT_FOUND`), et le dialogue
retrouve le nom dans sa propre liste. Les refus qui valent pour le lot entier
(`REGISTRATION_CLOSED`, `TOURNAMENT_FULL`) n'en portent pas : les affubler d'un
nom laisserait croire que les autres seraient passés.

### Le plafond d'effectif tient

L'effectif est relu **à chaque insertion**, sur la connexion de la transaction :
le compte grandit avec le lot, et la place manquante arrête l'ensemble par
`TOURNAMENT_FULL`. Le compteur du dialogue n'est qu'une commodité — le serveur
reste le juge.

`registerTeam` prend en outre un verrou `SELECT … FOR UPDATE` sur la ligne du
tournoi **avant** de compter, en première écriture de la transaction (ordre de
verrouillage constant, donc pas d'interblocage). Sans lui, deux inscriptions
simultanées lisent le même effectif et passent toutes les deux : l'unicité
`(tournament_id, team_id)` protège du doublon, pas du dépassement d'effectif. Le
verrou est posé dans le tronc commun, il vaut donc aussi pour l'inscription d'un
joueur.

### Fenêtre d'inscription, et rien d'autre

L'état est *calculé* (`syncTournamentState`) : un tournoi qui n'est plus en
inscriptions au moment du clic refuse tout le lot par `REGISTRATION_CLOSED`
(409), quelle que soit la liste affichée. Aucune garde nouvelle : c'est celle de
l'inscription ordinaire.

### Ne pas reproposer les déjà inscrites

`listGhostTeams(tournamentId)` pose l'exclusion **en base**
(`NOT EXISTS … bg_tournament_registrations`) plutôt que côté client : la liste
est relue à chaque ouverture du dialogue et doit refléter les inscriptions
arrivées entre-temps. Le filtre ne remplace pas le contrôle d'écriture — une
inscription peut toujours arriver pendant qu'on coche, et le lot est alors
refusé en nommant l'équipe en cause.

### Tournois individuels

La multi-inscription **y a un sens et y fonctionne**, sans code particulier :
dans un tournoi `participant_type = 'SOLO'`, un « joueur invité » *est* une
équipe fantôme — la même ligne `bg_teams`, seul le vocabulaire change
(`PARTICIPANT_WORDING`). Ce qui n'y entre jamais, c'est une **entrée solo**
(`bg_teams.solo_user_id`) : elle naît avec `is_ghost = 0`, elle est donc écartée
de la liste et refusée à l'écriture par le même `NOT_A_GHOST_TEAM` qu'une équipe
réelle. Un joueur inscrit sur le site s'engage toujours lui-même.

## Tests

- `tests/lib/shared/ghost-registration.test.ts` — module pur : lecture de la
  sélection (lot vide, doublons, plafond de forme), places restantes, recherche
  sans accents, phrases au singulier et au pluriel.
- `tests/lib/server/ghost-bulk-registration.test.ts` — moteur : lot complet,
  rangs de départ qui se suivent, verrou avant le comptage, déjà inscrite,
  plafond atteint **en cours de lot**, hors fenêtre, équipe réelle, entrée solo,
  fantôme dissoute.
- `tests/lib/server/ghost-bulk-transaction.test.ts` — tout ou rien : une seule
  transaction, un seul évènement de flux, rollback sans publication.
- `tests/lib/server/ghost-teams-service.test.ts` — création, attribution
  (tous les refus), liste, exclusion des déjà engagées, rollback transactionnel.
- `tests/lib/server/teams-service.ghost.test.ts` — la dérogation autorise le
  staff sur une fantôme et **jamais** sur une équipe réelle.
- `tests/app/api/teams/ghost-teams.test.ts` — création et attribution côté route.
- `tests/app/api/admin/ghost-registrations.test.ts` — route : permissions, lot
  illisible, codes HTTP, `teamId` joint aux refus qui désignent un engagé.

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
