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

Le plateau **peut** passer sous huit en une seule manche, et c'est le barème par
map qui le rend ordinaire : un 3-0 retirant trois points d'un coup, plusieurs
équipes proches de zéro sortent ensemble. `selectQualifiedTeamIds` ne retient
donc que les équipes **encore en lice** — `assignRanks` rangeant les sorties
juste après les actives, une tranche des `playoffSize` premières compléterait
sinon l'arbre avec des éliminées à 0 point.

### La bascule attend la fin de la manche

`reconcileEndurance` ne décide **rien au milieu d'une manche**. Le contrôle
d'achèvement (`roundIsComplete`) précède aussi bien la bascule en play-offs que
l'appariement de la manche suivante.

Il le précédait pour la seconde, pas pour la première, et l'ordre importait : un
seul score reporté peut faire tomber l'effectif actif sur
`endurance_playoff_size` alors que les autres rencontres de la manche sont
encore `READY`. L'arbre partait alors sur-le-champ, et ces matchs restaient
ouverts à jamais — `reconcileEndurance` repartant ensuite par la branche
`playoffsStarted`, plus rien ne les regardait.

Le retrait d'une équipe ne bloque pas cette attente : `forfeitEnduranceTeam`
clôt la rencontre en cours de l'équipe partie avant de réconcilier, précisément
pour que la manche puisse se terminer.

Une **manche périmée** — posée mais jamais jouée, dont une correction de score en
amont a réécrit les appariements — est défaite, comme en Survie et en Ronde
suisse. Elle ne fait pas sortir pour autant : elle n'a jamais été jouée, la
décision qui suit est donc celle d'après une manche terminée, prise sur la
manche précédente. La défaire puis sortir laissait le tournoi **sans manche et
sans arbre** dès que la correction achevait la qualification
(`generateEnduranceRound` sortant alors sur `qualificationComplete` sans rien
créer) — et rien ne l'aurait repris, `reconcileEndurance` n'étant atteignable
que depuis un report de score alors qu'il ne restait plus un match à jouer.

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
| Chiffre d'un forfait | `lib/shared/match-format.ts` (`forfeitMapCount`) |
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
par un retrait — vaut le **score maximal du format du tournoi** :

| Format du tournoi | Score compté | Endurance |
| --- | --- | --- |
| FT3 / BO5 | 3-0 | −3 pour l'équipe forfait, +3 pour l'adversaire |
| FT2 / BO3 | 2-0 | −2 / +2 |
| Score libre (aucun format) | 1-0 | −1 / +1 |

C'est `forfeitMapCount(format)` (`lib/shared/match-format.ts`) qui pose ce
nombre, depuis `matchWinsRequired` — la seule définition de l'objectif d'un
format. Il vivait dans `bg-survie.ts` tant que le mode était seul à s'en servir ;
il appartient au **format de match**, pas au mode, maintenant que le score plein
s'écrit en base pour tous les formats.

`adminResolveMatch` **écrit** ce score dans `bg_matches` au lieu de laisser les
colonnes à `NULL`. La différence n'est pas cosmétique : la manche s'affiche
« 3 – FF » au lieu de « - – FF », le bilan de maps des fiches compte les trois
maps, et le rejeu d'endurance lit la même chose que tout le monde. Un forfait
enregistré **avant** cette règle porte encore des colonnes vides : le rejeu
(`enduranceMatchMaps`) et le bilan de maps (`forfeitAwareMapScore`) le
rechiffrent alors depuis le format, si bien qu'aucune reprise de données n'est
nécessaire.

Un forfait compte comme une victoire au bilan V/D de son bénéficiaire, et comme
une défaite pour l'équipe partie : la rencontre a bien un vainqueur. Les fiches
équipe et joueur l'isolent en plus dans leur compteur « forfaits donnés /
reçus », sans le retirer du bilan.

## Les deux forfaits, et pourquoi ils ne se confondent pas

Le règlement en connaît deux, et l'interface doit les distinguer : sinon
l'arbitre qui veut sanctionner une absence sur **une** rencontre sort l'équipe du
tournoi entier.

| | Forfait sur une manche | Forfait sur tout le reste du tournoi |
| --- | --- | --- |
| Geste | dialogue de score → « Déclarer un forfait sur cette manche » | classement → bouton « Forfait » (« Abandonner » pour son propre engagé) |
| Route | `POST /api/admin/matches/[matchId]/resolve` | `POST /api/tournaments/[id]/forfeit` |
| Écrit | `forfeit_team_id` + score plein sur **ce** match | statut `FORFEIT`, capital à 0, match en cours clos |
| Suite | l'équipe reste en lice et joue la manche suivante | l'équipe n'est plus appariée |
| Au classement | capital amputé du score plein | « Forfait (Mn) », et « FF » rouge dans le tableau |

Le premier est ouvert à tous les formats de tournoi ; le second n'a de sens que
là où l'on reste en lice sans être éliminé par une défaite (Survie, Ronde
suisse, BlueGenji Survie — `FORMATS_WITH_FORFEIT`).

## Le tableau manche par manche

`EnduranceView` affiche, sous le classement, le capital de chaque équipe
**manche par manche** — la lecture « feuille de calcul » qui sert de référence à
l'arbitrage. Une ligne par équipe, une colonne par manche jouée.

Trois natures de case, et non une seule valeur numérique tolérant les trous
(`EnduranceRoundCell`) :

| Case | Sens |
| --- | --- |
| un nombre | capital à l'issue de la manche (0 compris : la manche qui vide le capital affiche ce zéro) |
| **FF** en rouge | manche couverte par un forfait de tournoi — de la manche du retrait jusqu'à la fin |
| — | l'équipe était déjà éliminée, elle n'a pas disputé cette manche |

Un capital de 0 ne dit pas si l'équipe a été vidée par ses résultats ou retirée
du tournoi, et une case vide ne dit pas si la manche reste à jouer ou si l'équipe
n'y était plus : c'est pourquoi la case porte sa nature, et pas seulement un
nombre.

L'historique n'est **pas stocké**. `replayEnduranceDetailed` le produit dans le
même parcours que le classement — même boucle, mêmes entrées — si bien qu'une
correction de score le refait comme elle refait tout le reste, sans colonne ni
migration. Le statut de chaque case est lu **au moment où la manche se referme**,
jamais à la fin du rejeu : une équipe éliminée à la manche 5 a bien un capital à
montrer pour les manches 1 à 4.

La dernière colonne est celle de la manche **en cours** : elle vaut le capital
acquis jusque-là et bouge à mesure que les scores tombent. Elle porte donc la
même valeur que la colonne « Endurance » du classement.

Le rouge est celui du danger (`--danger`), jamais `--red-live`, réservé à ce qui
est réellement à l'antenne. La zone défile horizontalement (`ScrollArea`) plutôt
que de se replier sur mobile : un tableau de capitaux empilé en colonne ne se
compare plus.

## Retrait du tournoi (abandon / forfait général)

Pris en charge comme en Survie et en Ronde suisse : le capital tombe à 0,
l'équipe sort, le classement est rejoué et la manche suivante réappariée.

Le match en cours de l'équipe partie est **clos** au passage, attribué à son
adversaire avec `forfeit_team_id` et le score plein du format — sans quoi la
manche ne pourrait jamais se terminer et la suivante ne serait jamais appariée.

Le score plein peut vider le capital de l'équipe partie **dans la même manche**
que son retrait. Le rejeu applique alors les matchs *avant* les abandons, puis
laisse l'abandon écraser l'élimination qu'il vient de provoquer : au classement,
la décision humaine (`FORFEIT`) prime sur la conséquence mécanique
(`ELIMINATED`).

Le retrait se déclare depuis le classement de la vue du mode
(`EnduranceView`) : un représentant de l'engagé pour sa propre équipe — le bouton
dit alors « Abandonner » —, l'arbitrage (`can(user, "tournaments")`) pour
n'importe laquelle — le bouton dit « Forfait ». Mêmes règles que la Survie et la
Ronde suisse, portées par `_lib/forfeit.ts` et
`POST /api/tournaments/[id]/forfeit`.

### Le retrait s'arrête à la phase qualificative

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
  génération des manches, tableau imposé, réconciliation, abandon, historique
  manche par manche exposé par `loadEnduranceMeta`.
- `tests/tournois/bg-survie-forfeit.test.ts` — les deux forfaits : score plein
  écrit sur un forfait ponctuel, cases « FF » du tableau, bilan de maps des
  fiches.
- `tests/tournois/bg-survie-playoff-timing.test.ts` — la bascule en play-offs
  attend la fin de la manche, l'abandon ne la bloque pas, et une manche périmée
  défaite ouvre l'arbre au lieu d'immobiliser le tournoi.

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
