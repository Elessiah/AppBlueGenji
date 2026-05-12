# 13 — Extraire les helpers purs de `app/(secured)/tournois/page.tsx`

## Objectif

Page liste de tournois qui calcule filtres, ticker, compteurs au sein du composant. Sortir ces dérivations en helpers purs testables.

## Fichiers concernés

- `app/(secured)/tournois/page.tsx`
- Nouveau : `app/(secured)/tournois/_lib/buckets.ts`
- Nouveau : `app/(secured)/tournois/_lib/ticker.ts`
- Nouveau : `tests/tournois/buckets.test.ts`
- Nouveau : `tests/tournois/ticker.test.ts`

## Hors périmètre

- Pas de modification de `lib/server/tournaments-service.ts`.
- Pas de changement de design.

## Implémentation

### 1) `_lib/buckets.ts`

```ts
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";

export type GameFilter = "all" | "marvel-rivals" | "overwatch-2";

export function filterByGame(cards: TournamentCard[], game: GameFilter): TournamentCard[] {
  if (game === "all") return cards;
  return cards.filter((c) => c.game === game);
}

export function countByGame(buckets: TournamentBuckets): Record<GameFilter, number> {
  const all = [...buckets.upcoming, ...buckets.registration, ...buckets.running, ...buckets.finished];
  return {
    all: all.length,
    "marvel-rivals": all.filter((c) => c.game === "marvel-rivals").length,
    "overwatch-2": all.filter((c) => c.game === "overwatch-2").length,
  };
}

export function filterBuckets(buckets: TournamentBuckets, game: GameFilter): TournamentBuckets {
  return {
    upcoming: filterByGame(buckets.upcoming, game),
    registration: filterByGame(buckets.registration, game),
    running: filterByGame(buckets.running, game),
    finished: filterByGame(buckets.finished, game),
  };
}
```

### 2) `_lib/ticker.ts`

Si du code calcule actuellement le ticker à partir des buckets dans le composant, l'extraire :

```ts
export function buildTickerItems(buckets: TournamentBuckets): string[] {
  // Reproduire la logique actuelle, sans dépendance JSX.
}
```

### 3) Tests unitaires

```ts
test("filterByGame returns subset for marvel-rivals", () => { … });
test("countByGame totals match buckets length", () => { … });
test("buildTickerItems is empty when buckets are empty", () => { … });
```

### 4) Refactor de `page.tsx`

Remplacer toutes les manipulations dérivées par des appels aux helpers :

```tsx
const counts = countByGame(buckets);
const filtered = filterBuckets(buckets, gameFilter);
const tickerItems = buildTickerItems(filtered);
```

Le composant ne contient plus que du JSX et des handlers d'état UI (sélection de filtre).

## Acceptation

- [ ] Aucun calcul dérivé inline dans `page.tsx`.
- [ ] Helpers purs : 0 dépendance React, 0 dépendance DOM.
- [ ] Tests passent.
- [ ] Comportement utilisateur identique.

## Discipline

- **Pas de classe, pas de state global.** Des fonctions pures.
- **Tests obligatoires** pour les helpers : c'est l'occasion principale de gagner en confiance sur ce code.
- **Pas d'over-engineering** : pas besoin de `useMemo` partout si les listes restent petites — mais ajouter `useMemo` quand le calcul est non trivial.
