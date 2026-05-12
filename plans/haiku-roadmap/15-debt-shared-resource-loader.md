# 15 — Hook partagé `useResourceLoader` pour les pages détail

## Objectif

Les pages `app/(secured)/joueurs/[id]/page.tsx` et `app/(secured)/equipes/[id]/page.tsx` recopient le même pattern : fetch initial, gestion d'erreur, redirection si la ressource n'existe pas. Factoriser dans un hook réutilisable.

## Fichiers concernés

- Nouveau : `lib/shared/hooks/useResourceLoader.ts`
- Refactor : `app/(secured)/joueurs/[id]/page.tsx`
- Refactor : `app/(secured)/equipes/[id]/page.tsx`
- Nouveau : `tests/hooks/useResourceLoader.test.ts`

## Hors périmètre

- Pas de modification des routes API.
- Pas de cache global (SWR / React Query). Hook minimaliste.

## Implémentation

### 1) Hook

```ts
"use client";

import { useEffect, useState, useCallback } from "react";

export type ResourceState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "not-found"; data: null; error: null }
  | { status: "error"; data: null; error: string };

export function useResourceLoader<T>(
  url: string,
  options?: { onNotFoundRedirect?: () => void },
) {
  const [state, setState] = useState<ResourceState<T>>({ status: "loading", data: null, error: null });

  const fetcher = useCallback(async () => {
    setState({ status: "loading", data: null, error: null });
    try {
      const res = await fetch(url);
      if (res.status === 404) {
        setState({ status: "not-found", data: null, error: null });
        options?.onNotFoundRedirect?.();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setState({ status: "error", data: null, error: body.error ?? `HTTP_${res.status}` });
        return;
      }
      const data = (await res.json()) as T;
      setState({ status: "ready", data, error: null });
    } catch (e) {
      setState({ status: "error", data: null, error: (e as Error).message });
    }
  }, [url, options]);

  useEffect(() => {
    fetcher();
  }, [fetcher]);

  return { ...state, refresh: fetcher };
}
```

Note : `lib/shared/*` doit être **sans dépendance serveur**. Le hook utilise `fetch` standard, donc OK.

### 2) Refactor des pages

```tsx
// joueurs/[id]/page.tsx
const { status, data, error, refresh } = useResourceLoader<PlayerDetail>(`/api/players/${id}`, {
  onNotFoundRedirect: () => router.replace("/joueurs"),
});
if (status === "loading") return <Loading />;
if (status === "not-found") return null; // redirige
if (status === "error") return <ErrorBlock message={error} />;
// render data
```

Idem pour `equipes/[id]/page.tsx` (en complément de la tâche 12 qui utilise ce hook via `useTeamDetail`).

### 3) Tests

```ts
test("loads data on mount", async () => { … });
test("returns not-found on 404", async () => { … });
test("returns error on 500", async () => { … });
test("refresh re-fetches", async () => { … });
```

(Utiliser `jest-fetch-mock` ou pattern existant du projet.)

## Acceptation

- [ ] `useResourceLoader` vit dans `lib/shared/hooks/`.
- [ ] Les deux pages détail utilisent le hook ; aucune duplication.
- [ ] Tests unitaires passent.
- [ ] Comportement utilisateur identique (loading, 404, erreur).

## Discipline

- **`lib/shared/*` = zéro import depuis `lib/server/*`.** Vérifie.
- **Pas de Context, pas d'état global** pour cette première version.
- **Pas d'auto-retry** : si l'API renvoie une erreur, on l'affiche et on attend `refresh()` explicite.
- Si tu vois d'autres pages avec le même pattern (`tournois/[id]`, etc.), **note-les dans le résumé** — ne refactore pas spontanément.
