import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");
jest.mock("@/lib/server/image-upload");
jest.mock("@/lib/server/account-deletion-journal");

import { reconcileDeletedAccounts } from "@/lib/server/users-service";
import { getDatabase } from "@/lib/server/database";
import { recordAccountDeletion } from "@/lib/server/account-deletion-journal";
import { ANONYMOUS_PSEUDOS } from "@/lib/shared/anonymous-pseudos";
import { fakePool } from "../../helpers/sql-double";

/**
 * Le rattrapage des comptes **déjà** supprimés : la règle a changé sous eux
 * (un compte n'est conservé que s'il a joué ; conservé, il porte un pseudo
 * d'emprunt), et un joueur parti ne redemandera pas sa suppression.
 */

type Account = {
  pseudo: string;
  isDeleted?: boolean;
  played?: boolean;
  organized?: boolean;
  owned?: boolean;
  isAdmin?: boolean;
  roles?: string | null;
};

type Query = { userId: number | null; sql: string; params: unknown[] };

/**
 * Ce que la lecture de repérage retient : ce que la base rendrait pour
 * `is_deleted = 1 AND (ancien pseudo OU rôle OU aucune trace)`.
 */
function needsWork(account: Account): boolean {
  if (account.isDeleted === false) return false;
  return (
    account.pseudo.startsWith("compte_supprime_")
    || Boolean(account.isAdmin)
    || (account.roles ?? null) !== null
    || !(account.played || account.organized || account.owned)
  );
}

function fakeDb(
  accounts: Record<number, Account>,
  options: { failFor?: number; rollbackFails?: boolean } = {},
) {
  const queries: Query[] = [];
  const connections: {
    commit: jest.Mock<() => Promise<void>>;
    rollback: jest.Mock<() => Promise<void>>;
    release: jest.Mock<() => void>;
  }[] = [];

  const poolExecute = jest.fn(async (sql: string) => {
    const q = sql.replace(/\s+/g, " ").trim();
    queries.push({ userId: null, sql: q, params: [] });
    if (q.startsWith("SELECT u.id FROM bg_users u WHERE u.is_deleted = 1")) {
      return [
        Object.entries(accounts)
          .filter(([, account]) => needsWork(account))
          .map(([id]) => ({ id: Number(id) })),
      ];
    }
    return [[]];
  });

  const getConnection = jest.fn(async () => {
    let current: number | null = null;
    const connection = {
      execute: jest.fn(async (sql: string, params: unknown[] = []) => {
        const q = sql.replace(/\s+/g, " ").trim();
        if (q.includes("FOR UPDATE")) current = Number(params[0]);
        queries.push({ userId: current, sql: q, params });
        if (options.failFor !== undefined && current === options.failFor && q.includes("AS played")) {
          throw new Error("DB_DOWN");
        }
        const account = current === null ? undefined : accounts[current];
        if (q.includes("FOR UPDATE")) {
          if (!account) return [[]];
          return [[{
            pseudo: account.pseudo,
            // Relu **sous le verrou** : un compte peut avoir été traité par un
            // autre processus entre la liste et le verrou.
            is_deleted: account.isDeleted === false ? 0 : 1,
            is_admin: account.isAdmin ? 1 : 0,
            platform_roles_json: account.roles ?? null,
          }]];
        }
        if (q.includes("AS played")) {
          return [[{
            played: account?.played ? 1 : 0,
            organized: account?.organized ? 1 : 0,
            owned: account?.owned ? 1 : 0,
          }]];
        }
        return [[]];
      }),
      beginTransaction: jest.fn(async () => {}),
      commit: jest.fn(async () => {}),
      rollback: jest.fn(async () => {
        if (options.rollbackFails) throw new Error("CONNECTION_LOST");
      }),
      release: jest.fn(() => {}),
    };
    connections.push(connection);
    return connection;
  });

  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: poolExecute, getConnection }));
  return { queries, connections };
}

const writesFor = (queries: Query[], userId: number) =>
  queries.filter((q) => q.userId === userId && !q.sql.startsWith("SELECT"));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("reconcileDeletedAccounts", () => {
  it("efface un compte supprimé qui n'a joué aucun match", async () => {
    const { queries } = fakeDb({ 5122: { pseudo: "compte_supprime_5122" } });

    expect(await reconcileDeletedAccounts()).toEqual({ erased: 1, renamed: 0, failed: 0 });
    const writes = writesFor(queries, 5122).map((q) => q.sql);
    expect(writes.some((sql) => sql.startsWith("DELETE FROM bg_users WHERE id = ?"))).toBe(true);
    expect(writes.some((sql) => sql.startsWith("UPDATE bg_users"))).toBe(false);
  });

  it("renomme sous un pseudo d'emprunt un compte qui a joué et porte encore l'ancien pseudo", async () => {
    const { queries } = fakeDb({ 5123: { pseudo: "compte_supprime_5123", played: true } });

    expect(await reconcileDeletedAccounts()).toEqual({ erased: 0, renamed: 1, failed: 0 });
    const update = writesFor(queries, 5123).find((q) => q.sql.startsWith("UPDATE bg_users SET pseudo = ?"))!;
    expect(ANONYMOUS_PSEUDOS).toContain(update.params[0]);
    expect(update.params[1]).toBe(5123);
    expect(writesFor(queries, 5123).some((q) => q.sql.startsWith("DELETE FROM bg_users"))).toBe(false);
  });

  it("retire les rôles de plateforme qu'une ancienne anonymisation avait laissés", async () => {
    const { queries } = fakeDb({
      9: { pseudo: "AlphaFX", played: true, roles: JSON.stringify(["ARBITRE"]) },
      10: { pseudo: "AlphaFury", played: true, isAdmin: true },
    });

    expect(await reconcileDeletedAccounts()).toEqual({ erased: 0, renamed: 2, failed: 0 });
    for (const id of [9, 10]) {
      const update = writesFor(queries, id).find((q) => q.sql.startsWith("UPDATE bg_users SET pseudo = ?"))!;
      expect(update.sql).toContain("platform_roles_json = NULL");
      expect(update.sql).toContain("is_admin = 0");
    }
  });

  it("ne verrouille rien quand la suppression suit déjà la règle — le cas nominal", async () => {
    // Le repérage écarte le compte d'une seule lecture : aucune connexion,
    // aucun verrou, à chaque démarrage de chaque processus.
    const { queries, connections } = fakeDb({ 11: { pseudo: "AlphaGod", played: true } });

    expect(await reconcileDeletedAccounts()).toEqual({ erased: 0, renamed: 0, failed: 0 });
    expect(writesFor(queries, 11)).toEqual([]);
    expect(connections).toHaveLength(0);
  });

  it("repère d'une seule lecture, avec les questions de la suppression", async () => {
    const { queries } = fakeDb({});

    await reconcileDeletedAccounts();

    const listing = queries.find((q) => q.sql.startsWith("SELECT u.id FROM bg_users u"))!;
    expect(listing.sql).toContain("u.is_deleted = 1");
    // Littéral, pas joker : `_` échappé dans le LIKE.
    expect(listing.sql).toContain(String.raw`u.pseudo LIKE 'compte\_supprime\_%'`);
    expect(listing.sql).toContain("u.platform_roles_json IS NOT NULL");
    expect(listing.sql).toContain("OR NOT (");
    expect(listing.sql).toContain("tm.user_id = u.id");
    expect(listing.sql).toContain("organizer_user_id = u.id");
  });

  it("ne relit pas un compte déjà en règle entre deux passages", async () => {
    // Renommé au premier passage, il n'a plus rien d'un ancien compte.
    const accounts: Record<number, Account> = { 15: { pseudo: "compte_supprime_15", played: true } };
    fakeDb(accounts);
    expect(await reconcileDeletedAccounts()).toEqual({ erased: 0, renamed: 1, failed: 0 });

    accounts[15] = { pseudo: "AlphaOne", played: true };
    const { connections } = fakeDb(accounts);
    expect(await reconcileDeletedAccounts()).toEqual({ erased: 0, renamed: 0, failed: 0 });
    expect(connections).toHaveLength(0);
  });

  it.each([
    ["organisé un tournoi", { organized: true }],
    ["possède une équipe", { owned: true }],
  ])("garde la ligne d'un compte qui a %s", async (_label, trace) => {
    const { queries } = fakeDb({ 12: { pseudo: "compte_supprime_12", ...trace } });

    expect(await reconcileDeletedAccounts()).toEqual({ erased: 0, renamed: 1, failed: 0 });
    expect(writesFor(queries, 12).some((q) => q.sql.startsWith("DELETE FROM bg_users"))).toBe(false);
  });

  it("verrouille la ligne avant de lire ses traces", async () => {
    const { queries } = fakeDb({ 13: { pseudo: "compte_supprime_13" } });

    await reconcileDeletedAccounts();

    const own = queries.filter((q) => q.userId === 13);
    const lock = own.findIndex((q) => q.sql.includes("FOR UPDATE"));
    const trace = own.findIndex((q) => q.sql.includes("AS played"));
    expect(lock).toBe(0);
    expect(trace).toBeGreaterThan(lock);
  });

  it("laisse un compte qu'un autre processus a déjà traité", async () => {
    // Listé comme supprimé, puis relu vivant sous le verrou : rien à faire.
    const { queries, connections } = fakeDb({ 14: { pseudo: "Nova", isDeleted: false } });
    // La liste ne le rend pas (filtrée) : on la force à le proposer.
    jest.mocked(getDatabase).mockResolvedValue(fakePool({
      execute: jest.fn(async () => [[{ id: 14 }]]),
      getConnection: (await getDatabase()).getConnection,
    }));

    expect(await reconcileDeletedAccounts()).toEqual({ erased: 0, renamed: 0, failed: 0 });
    expect(writesFor(queries, 14)).toEqual([]);
    expect(connections[0].rollback).toHaveBeenCalled();
    expect(connections[0].commit).not.toHaveBeenCalled();
  });

  it("n'arrête pas le rattrapage sur un échec, et le reporte", async () => {
    const { queries, connections } = fakeDb(
      { 20: { pseudo: "compte_supprime_20" }, 21: { pseudo: "compte_supprime_21" } },
      { failFor: 20 },
    );

    expect(await reconcileDeletedAccounts()).toEqual({ erased: 1, renamed: 0, failed: 1 });
    expect(connections[0].rollback).toHaveBeenCalled();
    expect(writesFor(queries, 21).some((q) => q.sql.startsWith("DELETE FROM bg_users"))).toBe(true);
    // Chaque connexion est rendue, échec compris : le pool n'en compte que 25.
    for (const connection of connections) expect(connection.release).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("poursuit même quand l'annulation lève sur une connexion perdue", async () => {
    const { queries, connections } = fakeDb(
      { 40: { pseudo: "compte_supprime_40" }, 41: { pseudo: "compte_supprime_41" } },
      { failFor: 40, rollbackFails: true },
    );

    expect(await reconcileDeletedAccounts()).toEqual({ erased: 1, renamed: 0, failed: 1 });
    expect(writesFor(queries, 41).some((q) => q.sql.startsWith("DELETE FROM bg_users"))).toBe(true);
    expect(connections[0].release).toHaveBeenCalled();
  });

  it("n'écrit rien au journal des suppressions : ces comptes y figurent déjà", async () => {
    fakeDb({ 30: { pseudo: "compte_supprime_30" }, 31: { pseudo: "compte_supprime_31", played: true } });

    await reconcileDeletedAccounts();

    expect(recordAccountDeletion).not.toHaveBeenCalled();
  });

  it("ne fait rien sans compte supprimé", async () => {
    const { connections } = fakeDb({});

    expect(await reconcileDeletedAccounts()).toEqual({ erased: 0, renamed: 0, failed: 0 });
    expect(connections).toHaveLength(0);
  });
});
