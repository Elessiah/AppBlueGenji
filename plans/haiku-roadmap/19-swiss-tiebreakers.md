# 19 — Round Suisse : tie-breakers et classement final

## Objectif

À la fin d'un tournoi suisse (et idéalement après chaque ronde pour l'affichage live), calculer le classement avec tie-breakers : Buchholz prioritaire, puis Sonneborn-Berger, puis Opponent Match Win %, puis confrontation directe.

## Pré-requis

- Tâche 18 (orchestration suisse).

## Fichiers concernés

- Nouveau : `lib/shared/swiss-tiebreakers.ts` (algos purs)
- Modifier : `lib/server/tournaments/swiss.ts` (appel après chaque maj de standings)
- Nouveau : `tests/swiss/tiebreakers.test.ts`

## Hors périmètre

- Pas d'UI ici (cf. tâche 20).
- Pas de personnalisation par tournoi de l'ordre des tie-breakers — utiliser un ordre par défaut codé en dur, surchargé par `swiss_tiebreakers_json` si présent.

## Implémentation

### 1) Module pur

```ts
export type Standing = {
  teamId: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  opponentIds: number[];
};

export type ExtendedStanding = Standing & {
  buchholz: number;
  sonnebornBerger: number;
  opponentMatchWinPct: number;
  rank: number;
};

export function computeBuchholz(standing: Standing, all: Standing[]): number {
  return standing.opponentIds.reduce((sum, oppId) => {
    const opp = all.find((s) => s.teamId === oppId);
    return sum + (opp?.points ?? 0);
  }, 0);
}

export function computeSonnebornBerger(standing: Standing, all: Standing[], matches: Array<{ a: number; b: number; winner: number | null }>): number {
  // Somme des scores des adversaires battus + 0.5 * somme des scores des adversaires nuls.
}

export function computeOpponentMatchWinPct(standing: Standing, all: Standing[]): number {
  // Moyenne des (wins / matchesPlayed) des adversaires affrontés.
}

export function rankStandings(
  standings: Standing[],
  matches: Array<{ a: number; b: number; winner: number | null }>,
  tiebreakers: SwissTiebreaker[] = ["buchholz", "sonneborn-berger", "opponent-mwp", "head-to-head"],
): ExtendedStanding[] {
  // 1. enrichir chaque standing avec buchholz, sonnebornBerger, opponentMatchWinPct
  // 2. trier par points DESC puis selon tiebreakers DESC
  // 3. tie final : confrontation directe entre les deux équipes ex-aequo (head-to-head)
  // 4. attribuer rank 1..N (gestion des vrais ex-aequo : même rank)
}
```

### 2) Intégration

Dans `lib/server/tournaments/swiss.ts`, après chaque `applySwissMatchResult` :

```ts
const standings = await loadSwissStandings(tournamentId, conn);
const matches = await loadSwissMatches(tournamentId, conn);
const ranked = rankStandings(standings, matches, tournament.swiss_tiebreakers ?? undefined);
await saveSwissStandings(tournamentId, ranked, conn);
```

`saveSwissStandings` met à jour la colonne `rank` et `buchholz` de `bg_swiss_standings`.

### 3) Tests

```ts
test("Buchholz: sums opponents' points correctly", … );
test("rank: same points but higher Buchholz → better rank", …);
test("head-to-head: tie broken by direct match winner", …);
test("two perfectly tied teams keep same rank", …);
```

## Acceptation

- [ ] À la fin d'un tournoi suisse de 8 équipes, le classement final présente des `rank` distincts (sauf vrais ex-aequo).
- [ ] Buchholz correctement calculé (vérifier à la main sur un cas 4 joueurs).
- [ ] `npm test` clean.
- [ ] Aucune dépendance serveur dans `lib/shared/swiss-tiebreakers.ts`.

## Discipline

- **Pur, testable, déterministe.**
- **Pas de mutation** des standings en entrée — toujours retourner une nouvelle structure.
- **Petits cas d'usage en test** : 4 joueurs, 8 joueurs. Pas besoin de 128 joueurs pour valider la logique.
