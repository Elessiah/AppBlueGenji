# Portée de l'entretien de fond des tournois

`lib/server/tournaments/sync-scope.ts` (lecture seule) + `syncVisibleTournaments`
(`lib/server/tournaments/index.ts`).

## Le symptôme

Sur une base fraîchement peuplée par `npm run seed` (76 tournois, dont 46 en
cours), `GET /api/landing/live` répondait en 160 s, puis en ~300 s aux appels
suivants. L'accueil restait sur sa dernière valeur, et **toute écriture
concurrente** sur `bg_tournaments` — un simple `UPDATE` — attendait derrière.

## La cause

`listTournamentBuckets` **attend** `syncVisibleTournaments()`, l'entretien de
fond qui recale les états. Celui-ci :

1. ouvrait **une** transaction ;
2. y repassait sur **tous** les tournois non terminés ;
3. appelait `syncTournamentState` pour chacun, qui refait à chaque fois le tour
   de son entretien — plateau à créer, byes, reports expirés, clôture — et, pour
   un format à classement, sa réconciliation complète (rejeu de la Suisse, de la
   Survie, de la BG Survie, des phases).

D'où deux effets qui se cumulent : le temps de la passe s'ajoute à celui de la
lecture, et la transaction unique tient un verrou sur `bg_tournaments` pendant
toute sa durée.

## Le principe retenu

Deux règles, indépendantes l'une de l'autre.

### 1. On ne visite que ce qui a quelque chose à faire

`findTournamentsNeedingSync` répond en deux temps, parce que la question a deux
natures :

- **Un jalon de calendrier est franchi.** L'état stocké ne dit plus la même
  chose que les dates. Le test est celui de `computeTournamentState` — la règle
  partagée avec le client. On lit les seules colonnes de date des tournois non
  terminés (table courte, une requête) et on tranche **en mémoire** : réécrire
  la règle en SQL en ferait une seconde, et les deux finiraient par diverger.
- **Un entretien de tournoi en cours est dû.** Chacune des tâches de la branche
  `RUNNING` de `syncTournamentState` a une précondition qui, elle, s'écrit en
  SQL et ne coûte qu'un `EXISTS` indexé :

  | Tâche | Précondition |
  | --- | --- |
  | `createBracketIfMissing` | élimination sans `bracket_size`, ou sans aucun match |
  | `resolveExpiredScoreReports` | une manche `AWAITING_CONFIRMATION` dont le délai est passé |
  | `tryAutoResolveByes` | un bye ou un match fantôme encore ouvert |
  | `finalizeTournamentIfDone` | élimination dont toutes les rencontres sont jouées |
  | `finalizeUnderfilledTournament` | moins de `MIN_ENTRANTS_FOR_MATCHES` engagés |

Un plateau en cours, sans bye ni report expiré, ne coûte donc plus rien à la
passe.

**Ce que le filtre n'a pas à couvrir**, et pas par oubli : la *reconstruction*
d'un plateau dont l'effectif aurait changé. Les inscriptions sont closes avant
le coup d'envoi et aucune n'est retirée ensuite — seule la suppression du
tournoi les efface. Un plateau à refaire se signale donc toujours par un
`bracket_size` remis à `NULL`, ce que fait précisément le réordonnancement du
seeding pour demander sa régénération (`SEEDING_ORDER.md`).

### 2. Une transaction par tournoi

L'ancienne passe n'en ouvrait qu'une, pour tous : sa durée était la **somme**
des entretiens, et le verrou qui en découlait aussi. Les tournois sont
indépendants — le découpage ne perd aucune garantie et borne le verrou à un
seul d'entre eux.

Corollaire : l'échec d'un tournoi n'emporte plus les suivants. Sa transaction
est défaite, ses lignes de journal jetées (`discardBotLogs`), et la passe
continue. L'entretien étant idempotent, le prochain balayage le retrouvera.

La lecture de repérage, elle, se fait **hors transaction** : l'ouvrir dedans
rendrait à la première la durée qu'on vient de lui retirer.

## Ce qui n'a pas bougé

- L'étranglement à 15 s (`SYNC_THROTTLE_MS`) et le vol unique (`pendingSync`).
- L'appel **hors** du chargeur mis en cache, et l'échec avalé côté
  `listTournamentBuckets` (`REALTIME_REFRESH.md`).
- `syncTournamentState` lui-même : la portée change, pas ce qu'un tournoi
  visité subit. Un format ajouté demain n'a rien à déclarer ici — au pire il
  sera visité une fois de moins qu'avant, jamais une fois de trop.

## Tests

`tests/lib/server/tournament-sync-scope.test.ts` : le filtre de jalon (état
stocké contre dates), les cinq préconditions d'entretien, le dédoublonnage, et
la passe elle-même — une transaction par tournoi, un échec isolé, la lecture de
repérage hors transaction.
