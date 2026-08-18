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

- Une équipe dont le capital atteint **0 est éliminée sur-le-champ**.
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

## Abandon

Pris en charge comme en Survie et en Ronde suisse : le capital tombe à 0,
l'équipe sort, le classement est rejoué et la manche suivante réappariée.

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
