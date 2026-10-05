# Portée de l'entretien de fond des tournois

`lib/server/tournaments/sync-scope.ts` (lecture seule) + `syncVisibleTournaments`
(`lib/server/tournaments/index.ts`).

## Le symptôme

Sur une base fraîchement peuplée par `npm run seed` (76 tournois, dont 46 en
cours), `GET /api/landing/live` répondait en 160 s, puis en ~300 s aux appels
suivants. L'accueil restait sur sa dernière valeur, et **toute écriture
concurrente** sur `bg_tournaments` — un simple `UPDATE` — attendait derrière.

## La cause

`listTournamentBuckets` **attendait** `syncVisibleTournaments()`, l'entretien de
fond qui recale les états (il ne l'attend plus depuis : voir `REALTIME_REFRESH.md`). Celui-ci :

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
  | `resolveExpiredScoreReports` | une manche `AWAITING_CONFIRMATION` dont le délai est passé, **et** qui porte un report unique (que la résolution clôt) ou un conflit dont l'escalade est due sans être réservée |
  | `tryAutoResolveByes` | un bye ou un match fantôme **résolvable** (`RESOLVABLE_BYE_SQL` / `RESOLVABLE_GHOST_SQL`, partagés avec la résolution) |
  | `finalizeTournamentIfDone` | élimination dont toutes les rencontres sont jouées |
  | `finalizeUnderfilledTournament` | moins de `MIN_ENTRANTS_FOR_MATCHES` engagés |

Un plateau en cours, sans bye ni report expiré, ne coûte donc plus rien à la
passe.

**Un conflit déjà escaladé n'est plus un entretien dû.** La précondition des
reports disait d'abord « délai passé, pas de vainqueur » : un conflit de score
(deux reports contradictoires) y restait à chaque balayage jusqu'à ce qu'un
arbitre le tranche — 3 tournois sur une base seedée après une passe complète —,
alors que `resolveExpiredScoreReports` ne clôt qu'un report **unique** et que
l'escalade (`score_report_stalled`) est réservée une fois dans
`bg_referee_alerts`. Elle retient désormais un report unique
(`SINGLE_REPORT_SQL`), ou un double report (`BOTH_REPORTED_SQL`) dont le délai
d'escalade (`SCORE_REPORT_TIMEOUT_MINUTES` après l'échéance, même calcul que la
résolution) est écoulé **et** sans ligne `SCORE_REPORT_STALLED`. C'est le
pendant, côté balayage, du réveil de salle de `nextRoomWakeAt`, qui ne relit un
conflit expiré qu'à l'instant de son escalade. Coupe-circuit du bot ouvert, rien
n'est réservé et le tournoi reste retenu : l'escalade doit partir une fois le bot
revenu.

**La précondition des byes est celle de la résolution, mot pour mot.** Elle
disait d'abord « une case est vide sur un match ouvert », ce qui attrape toute
case qui attend le vainqueur d'un match non joué — l'état normal de tout arbre
en cours : sur la base seedée, 17 des 22 éliminations en cours étaient
entretenues à chaque balayage (une transaction `syncTournamentState` complète,
dont un `SELECT … FOR UPDATE` par match en lancement, en concurrence avec les
« Prêt » des joueurs) sans qu'aucune n'ait un bye à trancher.
`tryAutoResolveByes` n'agit que sur une case qu'**aucun match non terminé
n'alimente plus** ; ses deux prédicats sont donc exportés de `byes.ts` et
réemployés tels quels dans l'`EXISTS` — deux copies auraient divergé. Mesuré
sur la base seedée après une passe : 17 tournois retenus pour les byes avant,
0 après, et la clause passe de ~40 ms à ~14 ms.

**Ce que le filtre n'a pas à couvrir**, et pas par oubli : la *reconstruction*
d'un plateau dont l'effectif aurait changé. Les inscriptions sont closes avant
le coup d'envoi et aucune n'est retirée ensuite — seule la suppression du
tournoi les efface. Le réordonnancement du seeding est lui aussi figé au coup
d'envoi (`SEEDING_ORDER.md`) : il ne touche jamais un plateau existant.

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
