import { jest } from "@jest/globals";
import type { Pool, PoolConnection } from "mysql2/promise";

/**
 * Signature d'une requête SQL simulée (`execute`, `query`).
 *
 * Ce qu'une requête rend n'a pas de type à opposer : les lignes sont décrites
 * par le SQL, pas par TypeScript — d'où `unknown`. Un `jest.fn()` nu a pour
 * paramètre de `mockResolvedValue` `never`, qui imposait un `as never` à chaque
 * valeur et taisait du même coup les doubles dont le type, lui, est connu.
 * `jest.fn<SqlQuery>()` admet toute ligne, et rien de plus n'est affirmé.
 */
export type SqlQuery = (sql: string, params?: unknown) => Promise<unknown>;

/** Le double lui-même, pour les signatures des fabriques de test. */
export type SqlMock = jest.Mock<SqlQuery>;

/**
 * Double partiel d'un pool ou d'une connexion : le code testé n'en touche que
 * les membres fournis. La conversion est écrite ici une fois, plutôt qu'en
 * `as never` au pied de chaque `getDatabase` simulé.
 */
export function fakePool(members: object): Pool {
  return members as Pool;
}

/** Même chose pour une connexion de transaction. */
export function fakeConnection(members: object): PoolConnection {
  return members as PoolConnection;
}

/**
 * Connexion de transaction simulée, chaque membre typé : un `jest.fn()` nu
 * refuse toute valeur (`never`) et imposait un `as never` jusque sur
 * `commit.mockRejectedValueOnce(new Error(…))`.
 */
export function connectionMock() {
  return {
    execute: jest.fn<SqlQuery>(),
    query: jest.fn<SqlQuery>(),
    beginTransaction: jest.fn<() => Promise<void>>(),
    commit: jest.fn<() => Promise<void>>(),
    rollback: jest.fn<() => Promise<void>>(),
    release: jest.fn<() => void>(),
  };
}
