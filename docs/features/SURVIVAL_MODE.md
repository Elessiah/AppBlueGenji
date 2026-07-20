# Mode de tournoi « Survie »

Format d'élimination progressive où **toutes les équipes évoluent dans un seul
groupe**. Il n'y a pas d'arbre : à chaque round, les équipes sont appariées par
paires selon leur classement courant, puis les plus faibles sont éliminées par
paliers jusqu'à ce qu'il ne reste qu'une championne.

## Règles

1. **Seeding initial** — au démarrage, le classement de départ est fixé par le
   **classement du site** (points = victoires×3 + défaites×1, toutes compétitions
   confondues). Seed 1 = meilleure équipe.
2. **Appariement** — à chaque round, on classe les équipes actives (meilleure en
   tête) et on les apparie par paires adjacentes : 1 vs 2, 3 vs 4, 5 vs 6, …
3. **Reclassement** — après chaque round, le classement est recalculé selon les
   **victoires** (décroissant), puis les **défaites** (croissant), puis le seed.
4. **Coupe (élimination)** — après chaque bloc de `roundsPerCut` rounds (paramètre
   défini à la création), les **deux dernières équipes** du classement sont
   éliminées. On n'en élimine qu'**une seule** quand il ne resterait sinon plus
   personne, garantissant une championne unique. Répété jusqu'à une seule équipe.
5. **Nombre impair** — si le nombre d'équipes actives est impair (inscriptions ou
   forfaits), l'équipe la plus basse n'ayant pas encore eu de bye reçoit une
   **victoire d'office** afin de ne pas la pénaliser.
6. **Forfait** — une équipe peut déclarer forfait et quitter le tournoi à tout
   moment. Son match en cours est résolu en faveur de l'adversaire ; elle est
   ensuite exclue des rounds suivants.
7. **Classement final** — la championne obtient le rang 1 ; les autres sont
   classées par round d'élimination décroissant (éliminées tard = mieux classées),
   puis victoires/défaites/seed.

Le report et la validation des scores utilisent **exactement le même mécanisme**
que les autres formats (double report concordant, délai de confirmation, édition
admin, forfait).

## Paramètres (création)

| Champ | Description |
| --- | --- |
| `survivalRoundsPerCut` | Nombre de rounds joués entre deux coupes (1–50). |

## Architecture

- **Logique pure** : [`lib/shared/survival.ts`](../../lib/shared/survival.ts) —
  `compareStanding`, `rankActiveTeams`, `planSurvivalRound`, `teamsToEliminate`,
  `isCutRound`, `selectEliminatedTeamIds`, `computeFinalRanks`. Entièrement testée
  ([`tests/survival/logic.test.ts`](../../tests/survival/logic.test.ts)), y compris
  une simulation complète prouvant la convergence vers une unique championne.
- **Orchestration serveur** :
  [`lib/server/tournaments/survival.ts`](../../lib/server/tournaments/survival.ts)
  - `initializeSurvivalTournament` — seed + création des standings.
  - `generateSurvivalRound` — appariement et création des matchs du round.
  - `reconcileSurvival` — **idempotent** : recalcule les stats depuis les matchs,
    applique la coupe due, puis clôt ou génère le round suivant. Appelée après
    chaque changement de score (report, résolution admin, timeout, bye) et à la
    transition en `RUNNING`.
  - `forfeitSurvivalTeam` — sortie d'une équipe.
  - `loadSurvivalMeta` — métadonnées pour l'affichage.
- **Persistance** :
  - Colonnes `bg_tournaments.survival_rounds_per_cut`, `survival_current_round`.
  - Table `bg_survival_standings` (seed, wins, losses, status, eliminated_round,
    rank). Les victoires/défaites y sont **dérivées des matchs** à chaque
    réconciliation (jamais accumulées), ce qui rend l'ensemble idempotent.
  - Les matchs réutilisent `bg_matches` (bracket `UPPER`, `round_number` = numéro
    de round, `is_bye` pour les victoires d'office).
- **API** :
  - `POST /api/tournaments` accepte `format: "SURVIVAL"` + `survivalRoundsPerCut`.
  - `POST /api/tournaments/[id]/forfeit` — forfait (membre pour sa propre équipe,
    arbitre/admin pour n'importe quelle équipe via `teamId`).
- **UI** :
  [`app/(secured)/tournois/[id]/_components/SurvivalView.tsx`](../../app/(secured)/tournois/[id]/_components/SurvivalView.tsx)
  — panneau de classement (zone d'élimination surlignée) + rounds en colonnes
  défilables, dans le même esprit que les arbres simple/double élimination. Les
  cartes de match réutilisent `MatchRow` (report des scores identique).

## Cas limites gérés

- 0 ou 1 équipe inscrite → clôture immédiate (championne éventuelle au rang 1).
- Nombre impair persistant → byes tournants (jamais deux fois la même équipe si
  possible).
- Toutes cadences de coupe (`roundsPerCut` = 1…N) convergent vers une championne.
- Forfaits multiples en cours de tournoi.
