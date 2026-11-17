import { jest } from "@jest/globals";
import type { Pool, PoolConnection } from "mysql2/promise";
import { fakeConnection } from "./sql-double";

type NamedLockModule = typeof import("@/lib/server/named-lock");

/**
 * Double de `@/lib/server/named-lock` pour un test dont la base est simulée :
 * le verrou est toujours obtenu et la tâche joue sur une connexion vide.
 * S'emploie dans une fabrique `jest.mock` :
 * `jest.mock("@/lib/server/named-lock", () => jest.requireActual<…>("../../helpers/named-lock-passthrough").namedLockPassThrough())`.
 */
export function namedLockPassThrough(): NamedLockModule {
  const actual = jest.requireActual<NamedLockModule>("@/lib/server/named-lock");
  return {
    ...actual,
    withNamedLock: <T>(_pool: Pool, _name: string, _timeoutSeconds: number, run: (connection: PoolConnection) => Promise<T>): Promise<T> =>
      run(fakeConnection({})),
  };
}
