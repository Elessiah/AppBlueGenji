# Mode « BlueGenji Survie » (`BG_SURVIE`)

Format de tournoi en deux temps : une phase qualificative où chaque équipe use
un **capital d'endurance**, puis une phase éliminatoire à huit dont le tableau
est imposé.

Il coexiste avec l'ancien mode `SURVIVAL` (coupes des deux dernières), qui reste
inchangé : ce sont deux formats distincts.

## Phase qualificative — l'endurance

| Réglage | Défaut | Colonne |
| --- | --- | --- |
| Capital de départ | 9 | `bg_tournaments.endurance_start_points` |
| Gain par map gagnée | +1 | `endurance_win_delta` |
| Perte par map perdue | −1 | `endurance_loss_delta` |
| Effectif des play-offs | 8 | `endurance_playoff_size` |

- Le barème se compte **map par map**, dans les deux sens : un 3-0 rapporte
  trois points au vainqueur et en coûte trois au perdant, un 3-2 n'en déplace
  qu'un. Ce n'est pas un point par match gagné.
- Une équipe dont le capital atteint **0 est éliminée sur-le-champ** — vainqueur
  du match compris, si le barème fait peser une map perdue plus lourd qu'une map
  gagnée.
- Le classement est relu avant chaque manche : endurance décroissante, puis —
  à égalité — **l'ordre du classement précédent**.
- Appariement par couples adjacents (1 vs 2, 3 vs 4…), la mieux classée du
  couple à **gauche** (`team1`).
- Effectif impair : la dernière du classement **ne joue pas** et son capital
  reste intact. Contrairement au mode Survie, aucune victoire d'office.
- La phase s'arrête dès que l'effectif actif retombe à `endurance_playoff_size`.
  Aucune limite de manches : c'est l'endurance qui fait le tri.

### Le départage n'est pas le seed

« En cas d'égalité, l'ordre du classement précédent est conservé » n'équivaut
pas à « départage par le classement de départ » : deux équipes qui se croisent
en cours de route gardent leur ordre relatif **du moment**. Le rejeu recalcule
donc l'ordre manche après manche et le reporte en entrée de la suivante
(`previousRank`).

## Phase éliminatoire

Arbre à élimination directe entre les huit qualifiées, avec un tableau **fixe**
et non le seeding classique :

| Match | Affrontement |
| --- | --- |
| 1 | 8ᵉ contre 4ᵉ |
| 2 | 6ᵉ contre 2ᵉ |
| 3 | 1ʳᵉ contre 5ᵉ |
| 4 | 3ᵉ contre 7ᵉ |

L'équipe du haut prend le side gauche. Une **petite finale** départage la 3ᵉ
place en parallèle de la finale.

Les manches de play-offs sont numérotées à partir de `1000`
(`PLAYOFF_ROUND_OFFSET`) pour rester distinguables des manches d'endurance dans
l'historique des matchs, sans table supplémentaire.

Un plateau autre que huit (tournoi sous-rempli, ou `endurance_playoff_size`
réglé autrement) retombe sur un appariement classique haut contre bas — le
tableau du règlement n'est défini que pour huit. Sur un effectif qui n'est pas
une puissance de deux, un tour peut compter un nombre impair de vainqueurs :
le dernier **passe le tour** (bye) au lieu d'être écarté.

## Classement de départ

Il n'est **pas** calculé depuis le classement du site : il vient de l'ordre de
seeding des inscriptions, que l'arbitre fixe à la main avant le lancement
(voir `SEEDING_ORDER.md`). C'est le seul mode où le classement initial est une
décision humaine.

## Architecture

| Élément | Emplacement |
| --- | --- |
| Logique pure | `lib/shared/bg-survie.ts` |
| Orchestration | `lib/server/tournaments/bg-survie.ts` |
| Classement | table `bg_endurance_standings` |
| Vue | `app/(secured)/tournois/[id]/_components/EnduranceView.tsx` |
| Verrouillage | `lib/shared/match-lock.ts` (format traité comme la Survie) |
| Règles publiques | `/regles/bluegenji-survie` |

Comme la Survie et la Ronde suisse, **tout est rejoué** depuis l'historique des
matchs (`replayEndurance`) : endurance, éliminations et classement sont dérivés,
jamais accumulés. Corriger un score défait donc l'élimination qu'il avait
provoquée. Seuls le classement initial et les abandons sont stockés en entrée.

`reconcileEndurance` est idempotent et appelé après chaque saisie de score
(report joueur, sauvegarde admin, résolution admin) : il persiste le classement,
puis enchaîne la manche suivante ou bascule en play-offs.

Si une correction de score change le classement alors que la manche courante est
posée mais **pas encore entamée**, ses appariements sont périmés : ils sont
détruits et reformés depuis le classement rejoué — comme le font déjà la Survie
et la Ronde suisse. Au-delà, `match-lock` interdit la correction : toute manche
ultérieure portant une saisie verrouille les précédentes, play-offs compris.

## Forfait : un score plein, pas un match blanc

Un forfait — déclaré par l'arbitrage sur un match (`forfeit_team_id`) ou entraîné
par un abandon — vaut le **score maximal du format du tournoi** :

| Format du tournoi | Score compté | Endurance |
| --- | --- | --- |
| FT3 / BO5 | 3-0 | −3 pour l'équipe forfait, +3 pour l'adversaire |
| FT2 / BO3 | 2-0 | −2 / +2 |
| Score libre (aucun format) | 1-0 | −1 / +1 |

C'est `forfeitMapCount(format)` (`lib/shared/bg-survie.ts`) qui pose ce nombre,
depuis `matchWinsRequired` — la seule définition de l'objectif d'un format.

Le rejeu ne peut pas lire les colonnes de score pour un forfait : l'arbitrage
les met à `NULL` (`adminResolveMatch`), il n'y a rien à lire. Le barème est donc
**dérivé du format**, ce qui laisse un forfait déjà enregistré se recalculer tout
seul — comme le reste du mode.

Un forfait compte comme une victoire au bilan V/D de son bénéficiaire : la
rencontre a bien un vainqueur.

## Abandon

Pris en charge comme en Survie et en Ronde suisse : le capital tombe à 0,
l'équipe sort, le classement est rejoué et la manche suivante réappariée.

Le match en cours de l'équipe partie est **clos** au passage, attribué à son
adversaire avec `forfeit_team_id` et le score plein du format — sans quoi la
manche ne pourrait jamais se terminer et la suivante ne serait jamais appariée.

Le score plein peut vider le capital de l'équipe partie **dans la même manche**
que son abandon. Le rejeu applique alors les matchs *avant* les abandons, puis
laisse l'abandon écraser l'élimination qu'il vient de provoquer : au classement,
la décision humaine (`FORFEIT`) prime sur la conséquence mécanique
(`ELIMINATED`).

L'abandon se déclare depuis le classement de la vue du mode
(`EnduranceView`) : un représentant de l'engagé pour sa propre équipe,
l'arbitrage (`can(user, "tournaments")`) pour n'importe laquelle — mêmes règles
que la Survie et la Ronde suisse, portées par `_lib/forfeit.ts` et
`POST /api/tournaments/[id]/forfeit`.

### L'abandon s'arrête à la phase qualificative

`forfeitEnduranceTeam` ne sait clore qu'un match de la **manche courante**
(`endurance_current_round`) : l'arbre final vit à partir de
`PLAYOFF_ROUND_OFFSET` (1000), hors de sa portée. Un abandon accepté en
play-offs marquerait l'équipe `FORFEIT` au classement tout en la laissant
engagée dans un match ouvert que rien ne viendrait jamais clore — et le rejeu
daterait son abandon d'une manche qualificative qu'elle avait en réalité jouée
et gagnée, puisque `eliminated_round` vaut alors la dernière manche générée.

Le refus est posé aux deux bouts : `EnduranceView` masque le bouton dès
`endurance.playoffsStarted`, et `forfeitEnduranceTeam` lève
`ENDURANCE_PLAYOFFS_STARTED` (→ 400) pour qui appellerait la route directement.

Un forfait de play-off se tranche donc **sur le match lui-même**, par
l'arbitrage (`adminResolveMatch` avec `forfeitTeamId`) : c'est le seul chemin
qui fasse avancer l'arbre.

## Tests

- `tests/tournois/bg-survie.test.ts` — logique pure : barème, endurance,
  élimination immédiate, idempotence du rejeu, correction de score qui annule
  une élimination, départage par le classement précédent, tableau des play-offs.
- `tests/tournois/bg-survie-service.test.ts` — orchestration : seeding initial,
  génération des manches, tableau imposé, réconciliation, abandon.

## Interactions avec le reste du moteur

- **Verrouillage des scores** — `dependentMatches` range `BG_SURVIE` avec la
  Survie et la Ronde suisse : sans lien de bracket, toute manche ultérieure
  dépend des précédentes.
- **Finalisation générique** — `finalizeTournamentIfDone` ignore ce format, qui
  écrit lui-même son podium ; sinon un instant où tous les matchs sont terminés
  (entre deux manches) clôturerait le tournoi avec un classement d'élimination.
- **Réordonnancement du seeding** — `reorderSeeding` réamorce explicitement le
  mode (classement resemé, première manche régénérée) : les seeds vivent dans
  `bg_endurance_standings`, ils ne se recalculent pas tout seuls.
