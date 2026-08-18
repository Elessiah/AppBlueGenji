# Tournois individuels

Un tournoi peut se jouer **par équipes** (comportement historique) ou
**en individuel** : les joueurs s'inscrivent alors eux-mêmes, sans passer par
une équipe.

Le choix se fait à la création, indépendamment du format de bracket : simple et
double élimination, ronde suisse, survie, BlueGenji Survie et multi-phases
fonctionnent à l'identique dans les deux modes.

## Modèle

| Élément | Détail |
| --- | --- |
| Colonne | `bg_tournaments.participant_type ENUM('TEAM','SOLO') NOT NULL DEFAULT 'TEAM'` |
| Colonne | `bg_teams.solo_user_id BIGINT NULL` + index unique (migrations auto) |
| Logique pure | `lib/shared/participants.ts` (vocabulaire, noms candidats, liens) |
| Service | `lib/server/solo-entries-service.ts` (entrée solo d'un joueur) |
| Inscription | `lib/server/tournaments/registration.ts` (`resolveUserEntrantTeamId`) |

### L'entrée solo

Le moteur de tournoi ne connaît qu'une notion d'**engagé**, identifié par un
`team_id` : plateaux, classements, scores et abandons pointent tous vers
`bg_teams`. Plutôt que de dupliquer ce modèle, un joueur qui s'inscrit à un
tournoi individuel reçoit une **entrée solo** : une ligne `bg_teams` qui le
représente, portant `solo_user_id` et **aucun membre** — exactement le principe
des [équipes fantômes](GHOST_TEAMS.md).

Conséquences :

- tous les formats existants fonctionnent sans modification ;
- l'entrée solo garde son historique de matchs d'un tournoi à l'autre ;
- elle n'est **pas** une équipe : elle est exclue de `/equipes`, du classement
  du site et du compteur d'équipes de la landing, et sa fiche d'équipe renvoie
  404 — son identité publique est le profil du joueur.

L'entrée n'est créée qu'à la **première inscription** à un tournoi individuel :
un joueur qui n'en a jamais joué n'a aucune ligne parasite.

### Nom et avatar

`bg_teams.name` est unique. L'entrée solo essaie donc, dans l'ordre
(`soloEntryNameCandidates`) :

1. le pseudo tel quel ;
2. `<pseudo> #<id du compte>` si le pseudo est déjà pris ;
3. `Joueur #<id du compte>` en dernier recours.

Le logo de l'entrée est l'avatar du joueur. Nom et logo sont resynchronisés à
chaque inscription, à chaque changement de pseudo ou d'avatar, et lors de
l'anonymisation du compte — un renommage se voit donc immédiatement dans les
brackets. Si le nouveau nom est déjà pris, l'entrée garde le précédent plutôt
que de faire échouer la mise à jour du profil.

## Inscription

`POST /api/tournaments/[id]/register` ne change pas d'interface : c'est le
tournoi qui décide de ce qui est engagé.

| Type | Engagé | Refus |
| --- | --- | --- |
| `TEAM` | l'équipe active du joueur | `NO_ACTIVE_TEAM` s'il n'en a pas |
| `SOLO` | son entrée solo, créée à la volée | — (aucune équipe requise) |

Les autres contrôles sont communs : état `REGISTRATION`, pas de doublon
(`ALREADY_REGISTERED`), capacité (`TOURNAMENT_FULL`).

`resolveUserEntrantTeamId(connection, tournament, userId)` est la résolution à
utiliser **partout** où l'on demandait « l'équipe du joueur » à propos d'un
tournoi : inscription, report de score (`lib/server/tournaments/scoring.ts`),
abandon (`app/api/tournaments/[id]/forfeit/route.ts`). Elle ne crée jamais
d'entrée : seule l'inscription le fait.

### Engagés sans compte

Le staff (permission `tournaments`) complète un plateau avec des **équipes
fantômes**, y compris en individuel — c'est le même mécanisme, présenté comme
« joueur invité ».

## Interface

- **`/tournois/creer`** — sélecteur « Type de participants » (Équipes / Joueurs).
- **`/tournois`** — les cartes comptent des « Joueurs » et le ticker parle de
  « joueurs engagés ».
- **`/tournois/[id]`** — badge `Individuel`, bouton « M'inscrire », colonne
  « Joueur » dans les inscriptions et les classements, dialogue « Inscrire un
  joueur invité ».
- **Liens** — dans les brackets et les classements, un engagé solo pointe vers
  `/joueurs/[id]` et non `/equipes/[id]`.

Tout le vocabulaire vit dans `PARTICIPANT_WORDING` (`lib/shared/participants.ts`)
et se diffuse dans la page de tournoi par le contexte
`app/(secured)/tournois/[id]/_lib/entrant-link.tsx` (`useEntrantLink`,
`useParticipantWording`), sans traverser les composants par les props.

## Profil du joueur

Les tournois joués en individuel comptent dans le palmarès et les statistiques
du joueur au même titre que ceux joués en équipe : les requêtes de
`lib/server/users-service.ts` passent par `USER_ENTRIES_SQL`, l'union de ses
adhésions d'équipe et de son entrée solo.

## Champs exposés

`TournamentCard.participantType` (donc partout où une carte est rendue) et
`TournamentDetail.soloUserIds` (`team_id → user_id`, vide hors individuel).

## Jeu de test

`npm run seed` crée une entrée solo par joueur nommé, et trois tournois
individuels : inscriptions ouvertes, simple élimination en cours, ronde suisse
terminée (`lib/server/seed-cases.ts`, champ `participantType`).

## Tests

- `tests/lib/shared/participants.test.ts` — vocabulaire, noms candidats, liens.
- `tests/lib/server/solo-entries-service.test.ts` — création, réutilisation,
  collisions de nom, course concurrente, synchronisation d'identité.
- `tests/tournois/solo-registration.test.ts` — résolution de l'engagé et
  inscription dans les deux modes, avec tous les refus.
- `tests/app/api/tournaments/create-solo.test.ts` — validation de la route.
- `tests/tournois/tournament-mappers.test.ts` — repli sur `TEAM`.
