# Mode de tournoi « Survie »

Format d'élimination progressive où **toutes les équipes évoluent dans un seul
groupe**. Il n'y a pas d'arbre : à chaque round, les équipes sont appariées par
paires selon leur classement courant, puis les plus faibles sont éliminées par
paliers jusqu'à ce qu'il ne reste qu'une championne.

## Règles

1. **Seeding initial** — au démarrage, le classement de départ est fixé par le
   **classement du site**, au barème unique de `lib/shared/ranking.ts`
   (`victoires × 100 − défaites × 20`, sur les matchs terminés, toutes
   compétitions confondues). Seed 1 = meilleure équipe. Le même module sert au
   leaderboard de la landing : les deux calculs ne peuvent plus diverger.
2. **Appariement** — à chaque round, on classe les équipes actives (meilleure en
   tête) et on les apparie par paires adjacentes : 1 vs 2, 3 vs 4, 5 vs 6, …
3. **Reclassement** — après chaque round, le classement est recalculé selon les
   **victoires** (décroissant), puis les **défaites** (croissant), puis le seed.
4. **Coupe (élimination)** — la cadence se règle en deux temps à la création :
   `survivalRoundsBeforeFirstCut` manches avant la **première** coupe, puis une
   coupe tous les `survivalRoundsPerCut` rounds. À chaque coupe, les **deux
   dernières équipes** du classement sont éliminées. On n'en élimine qu'**une seule** quand l'effectif est impair
   (*coupe d'équilibrage*, voir §5) ou quand il ne resterait sinon plus personne,
   garantissant une championne unique. Répété jusqu'à une seule équipe.
5. **Nombre impair — équilibrage** — un effectif impair imposerait une victoire
   d'office à chaque round, et comme une coupe retire deux équipes la parité ne
   se corrigerait jamais d'elle-même. Deux mécanismes ramènent l'effectif au pair :
   - **Barrage au round 1** — quand les inscriptions sont en nombre impair, le
     round 1 est un *barrage* : seules les **deux dernières du classement**
     s'affrontent et le perdant est éliminé. Les autres équipes ne jouent pas ce
     round-là et **aucune victoire d'office n'est distribuée**. Ce round ne compte
     pas dans la cadence des coupes (elle démarre au round suivant). Si un forfait
     a rétabli la parité pendant le barrage, son perdant n'est **pas** éliminé en
     plus.
   - **Coupe d'équilibrage** — si un forfait recasse la parité en cours de
     tournoi, la coupe planifiée suivante n'élimine qu'**une** équipe au lieu de
     deux : le reliquat redevient pair et les victoires d'office cessent. Entre le
     forfait et cette coupe, l'équipe la plus basse n'ayant pas encore eu de bye
     reçoit une **victoire d'office** afin de ne pas la pénaliser.

   Conséquence : hors forfait, un tournoi Survie ne distribue **aucune** victoire
   d'office, quel que soit le nombre d'inscrits.
6. **Forfait (abandon)** — une équipe peut abandonner et quitter le tournoi à tout
   moment. Son match en cours est résolu en faveur de l'adversaire ; elle est
   ensuite exclue des rounds suivants. L'action se déclenche depuis le bouton
   « Abandonner » de sa ligne dans le classement : proposé aux membres de
   l'équipe concernée (mêmes droits que le report de score) et à l'arbitrage, qui
   peut le déclarer pour n'importe quelle équipe encore en lice.
   L'éligibilité est calculée par `canForfeitTeam()`
   (`app/(secured)/tournois/[id]/_lib/forfeit.ts`), la route API appliquant la
   même règle côté serveur.
7. **Classement final** — la championne obtient le rang 1 ; les autres sont
   classées par round d'élimination décroissant (éliminées tard = mieux classées),
   puis victoires/défaites/seed.

Le report et la validation des scores utilisent **exactement le même mécanisme**
que les autres formats (double report concordant, délai de confirmation, édition
admin, forfait).

## Paramètres (création)

| Champ | Description |
| --- | --- |
| `survivalRoundsBeforeFirstCut` | Nombre de rounds joués avant la première coupe (1–50). Par défaut : la valeur de l'intervalle. |
| `survivalRoundsPerCut` | Nombre de rounds joués entre deux coupes suivantes (1–50). |

## Architecture

- **Logique pure** : [`lib/shared/survival.ts`](../../lib/shared/survival.ts) —
  `compareStanding`, `rankActiveTeams`, `planSurvivalRound` (option
  `allowBarrage`), `needsBarrage`, `shouldEliminateBarrageLoser`,
  `teamsToEliminate`, `isCutRound` / `nextCutRound` (calendrier
  `SurvivalCutSchedule` : première coupe, intervalle, barrage),
  `selectEliminatedTeamIds`, `computeFinalRanks`. Entièrement testée
  ([`tests/survival/logic.test.ts`](../../tests/survival/logic.test.ts)), y compris
  une simulation complète prouvant la convergence vers une unique championne.
- **Orchestration serveur** :
  [`lib/server/tournaments/survival.ts`](../../lib/server/tournaments/survival.ts)
  - `initializeSurvivalTournament` — seed + création des standings.
  - `generateSurvivalRound` — appariement et création des matchs du round.
  - `reconcileSurvival` — **idempotent** : rejoue l'intégralité du tournoi depuis
    l'historique des matchs (`replaySurvival`, pur), écrit l'état obtenu, puis
    clôt le tournoi ou met le round suivant à jour. Appelée après chaque
    changement de score (report, résolution admin, timeout, bye) et à la
    transition en `RUNNING`.
  - `ensureNextRound` — crée le round suivant, et le **réapparie** si une
    correction de score en amont a changé le classement, tant qu'aucun score n'y
    a été saisi.
  - `forfeitSurvivalTeam` — sortie d'une équipe.
  - `loadSurvivalMeta` — métadonnées pour l'affichage.
- **Persistance** :
  - Colonnes `bg_tournaments.survival_rounds_before_first_cut`,
    `survival_rounds_per_cut`, `survival_current_round`, `survival_barrage_rounds`
    (0 ou 1 — décale la cadence des coupes). `survival_rounds_before_first_cut`
    est NULL sur les tournois antérieurs à l'option : la première coupe tombe
    alors au bout d'un intervalle standard (`resolveCutSchedule`), soit le
    comportement historique.
  - Table `bg_survival_standings` (seed, wins, losses, status, eliminated_round,
    rank). **Tout y est dérivé des matchs** à chaque réconciliation — victoires,
    défaites, mais aussi éliminations et rangs — et réécrit en une seule requête.
    Seuls les abandons sont conservés en entrée du rejeu : ce sont des décisions
    humaines, pas des conséquences d'un résultat.

    C'est ce qui rend une correction de score réversible : corriger le résultat
    d'un round de coupe **défait** l'élimination qu'il avait provoquée (avant,
    l'équipe qui venait de gagner restait éliminée et celle qui perdait
    continuait), et le round suivant est réapparié s'il n'est pas entamé.
  - Les matchs réutilisent `bg_matches` (bracket `UPPER`, `round_number` = numéro
    de round, `is_bye` pour les victoires d'office).
- **API** :
  - `POST /api/tournaments` accepte `format: "SURVIVAL"` +
    `survivalRoundsBeforeFirstCut` + `survivalRoundsPerCut`.
  - `POST /api/tournaments/[id]/forfeit` — forfait (membre pour sa propre équipe,
    arbitre/admin pour n'importe quelle équipe via `teamId`).
- **UI** :
  [`app/(secured)/tournois/[id]/_components/SurvivalView.tsx`](../../app/(secured)/tournois/[id]/_components/SurvivalView.tsx)
  — panneau de classement (zone d'élimination surlignée, bouton « Abandonner »
  sur les équipes encore en lice) + rounds en colonnes défilables, dans le même
  esprit que les arbres simple/double élimination. Les cartes de match
  réutilisent `MatchRow` (report des scores identique).

## Cas limites gérés

- 0 ou 1 équipe inscrite → clôture immédiate (championne éventuelle au rang 1).
- Inscriptions impaires (3, 5, 7, … équipes) → barrage au round 1, puis plus
  aucune victoire d'office jusqu'à la championne.
- Parité cassée par un forfait → byes tournants (jamais deux fois la même équipe
  si possible) jusqu'à la coupe d'équilibrage.
- Toutes cadences de coupe (`roundsPerCut` = 1…N) convergent vers une championne.
- Forfaits multiples en cours de tournoi.
