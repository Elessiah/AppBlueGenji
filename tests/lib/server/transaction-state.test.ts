import { describe, expect, it, jest } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { clearTransactionStates, createTransactionState } from "@/lib/server/tournaments/transaction-state";
import { fakeConnection } from "../../helpers/sql-double";

/**
 * État « après commit » d'une transaction (`lib/server/tournaments/transaction-state.ts`) :
 * une seule fabrique, un seul cycle de vie (`flushBotLogs` / `discardBotLogs`).
 */

describe("createTransactionState", () => {
  it("ensure_firstCall_createsOnceAndReturnsSameState", () => {
    const create = jest.fn(() => [] as number[]);
    const states = createTransactionState(create);
    const connection = fakeConnection({});

    const first = states.ensure(connection);
    const second = states.ensure(connection);

    expect(second).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("peek_noState_returnsUndefinedWithoutCreating", () => {
    const create = jest.fn(() => [] as number[]);
    const states = createTransactionState(create);

    expect(states.peek(fakeConnection({}))).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it("take_afterEnsure_returnsStateThenEmpty", () => {
    const states = createTransactionState<number[]>(() => []);
    const connection = fakeConnection({});
    states.ensure(connection).push(7);

    expect(states.take(connection)).toEqual([7]);
    expect(states.take(connection)).toBeUndefined();
  });

  it("discard_afterEnsure_dropsState", () => {
    const states = createTransactionState<number[]>(() => []);
    const connection = fakeConnection({});
    states.ensure(connection).push(7);

    states.discard(connection);

    expect(states.peek(connection)).toBeUndefined();
  });

  it("ensure_twoConnections_keepsStatesSeparate", () => {
    const states = createTransactionState<number[]>(() => []);
    const first = fakeConnection({});
    const second = fakeConnection({});

    states.ensure(first).push(1);

    expect(states.ensure(second)).toEqual([]);
    expect(states.peek(first)).toEqual([1]);
  });
});

describe("clearTransactionStates", () => {
  it("clearTransactionStates_twoStates_dropsBothForThatConnectionOnly", () => {
    const first = createTransactionState<number[]>(() => []);
    const second = createTransactionState<Set<number>>(() => new Set());
    const connection = fakeConnection({});
    const other = fakeConnection({});
    first.ensure(connection).push(1);
    second.ensure(connection).add(2);
    first.ensure(other).push(3);

    clearTransactionStates(connection);

    // Une file que personne n'a vidée ne part pas avec la transaction suivante sur ce même objet connexion.
    expect(first.peek(connection)).toBeUndefined();
    expect(second.peek(connection)).toBeUndefined();
    expect(first.peek(other)).toEqual([3]);
  });

  it("clearTransactionStates_queueStillFilled_reportsTheWiringGap", () => {
    const forgotten = createTransactionState<number[]>(() => []);
    const connection = fakeConnection({});
    forgotten.ensure(connection).push(1);
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);

    clearTransactionStates(connection);

    expect(errors).toHaveBeenCalledWith(expect.stringContaining("non branchée"));
    errors.mockRestore();
  });

  it("clearTransactionStates_everyQueueTaken_staysSilent", () => {
    const states = createTransactionState<number[]>(() => []);
    const connection = fakeConnection({});
    states.ensure(connection).push(1);
    states.take(connection);
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);

    clearTransactionStates(connection);

    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

/** Sources TypeScript de `lib/`, chemin relatif en `/`. */
function libSources(): { path: string; source: string }[] {
  const root = join(process.cwd(), "lib");
  const files: { path: string; source: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) {
        files.push({ path: relative(process.cwd(), full).split(sep).join("/"), source: readFileSync(full, "utf8") });
      }
    }
  };
  walk(root);
  return files;
}

describe("un seul cycle de vie pour les files « après commit »", () => {
  const botLogs = readFileSync(join(process.cwd(), "lib/server/tournaments/bot-logs.ts"), "utf8");

  it("transactionStateModules_allFlushedAndDiscardedByBotLogs", () => {
    const users = libSources()
      .filter(({ source }) => /createTransactionState[<(]/.test(source))
      .map(({ path }) => path)
      .sort();

    // Une file de plus : la brancher dans `flushBotLogs` / `discardBotLogs`, puis l'ajouter ici.
    expect(users).toEqual([
      "lib/server/tournaments/auto-validated-notices.ts",
      "lib/server/tournaments/bot-logs.ts",
      "lib/server/tournaments/cast-notices.ts",
      "lib/server/tournaments/departed-notices.ts",
      "lib/server/tournaments/prod-notices.ts",
      "lib/server/tournaments/referee-notices.ts",
      "lib/server/tournaments/transaction-state.ts",
    ]);
    for (const call of [
      "flushAutoValidatedNotices(connection)",
      "discardAutoValidatedNotices(connection)",
      "flushCastChanges(connection)",
      "discardCastChanges(connection)",
      "flushDepartedNotices(connection)",
      "discardDepartedNotices(connection)",
      "flushRefereeChanges(connection)",
      "discardRefereeChanges(connection)",
    ]) {
      expect(botLogs).toContain(call);
    }
  });

  it("sources_noRawPoolConnectionWeakMapOutsideFactory", () => {
    const raw = libSources()
      .filter(({ source }) => /new WeakMap<PoolConnection\b/.test(source))
      .map(({ path }) => path);

    expect(raw).toEqual(["lib/server/tournaments/transaction-state.ts"]);
  });

  it("botLogs_flushAndDiscard_endWithClearTransactionStates", () => {
    const body = (name: string) => botLogs.slice(botLogs.indexOf(`export function ${name}(`)).split(/\n\}\n/)[0];

    expect(body("flushBotLogs")).toContain("clearTransactionStates(connection)");
    expect(body("discardBotLogs")).toContain("clearTransactionStates(connection)");
  });
});
