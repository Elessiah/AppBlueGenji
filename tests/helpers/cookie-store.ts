import type { cookies } from "next/headers";

/** Ce que rend `cookies()` de Next. */
export type CookieStore = Awaited<ReturnType<typeof cookies>>;

/**
 * Double partiel du magasin de cookies : le code testé n'en appelle que les
 * méthodes fournies (`get`, `set`…). La conversion est écrite ici une fois,
 * plutôt qu'en `as never` au pied de chaque `cookies` simulé.
 */
export function fakeCookieStore(members: object): CookieStore {
  return members as CookieStore;
}
