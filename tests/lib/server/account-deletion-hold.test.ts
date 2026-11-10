import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/solo-entries-service", () => ({ syncSoloEntryIdentityOn: jest.fn() }));

import { syncSoloEntryIdentityOn } from "@/lib/server/solo-entries-service";
import {
  holdAccountIdentity,
  isPseudoHeldByOther,
  loadTakenAnonymousPseudos,
  restoreAccountIdentity,
  readModeratableAvatar,
  setHeldAvatar,
} from "@/lib/server/users/account-deletion-hold";
import { ANONYMOUS_PSEUDOS } from "@/lib/shared/anonymous-pseudos";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

/*
 * Masque d'un compte en attente de suppression (décision du 2026-11-04) :
 * anonyme dès la demande, vrai pseudo et avatar mis de côté pour la seule
 * réactivation.
 */

const REQUESTED = new Date("2026-11-06T10:00:00.000Z");
const AVATAR = "/api/uploads/avatars/7.webp";
const duplicate = () => Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });

type Rows = { live?: object | null; user?: object | null; hold?: object | null; taken?: object[]; affectedRows?: number };

/** Connexion de transaction : chaque lecture rend ses lignes, chaque écriture `affectedRows`. */
function transaction(rows: Rows) {
  const connection = connectionMock();
  connection.execute.mockImplementation(async (sql: string) => {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT pseudo, avatar_url FROM bg_users")) return [rows.live ? [rows.live] : [], []];
    if (q.startsWith("SELECT pseudo, avatar_url, is_deleted FROM bg_users")) return [rows.user ? [rows.user] : [], []];
    if (q.startsWith("SELECT pseudo, avatar_url FROM bg_account_deletion_holds")) return [rows.hold ? [rows.hold] : [], []];
    if (q.startsWith("SELECT pseudo FROM bg_users WHERE id <> ?")) return [rows.taken ?? [], []];
    if (q.startsWith("SELECT user_id FROM bg_account_deletion_holds")) return [rows.taken ?? [], []];
    if (q.startsWith("UPDATE bg_users")) return [{ affectedRows: rows.affectedRows ?? 1 }, []];
    return [{ affectedRows: 1 }, []];
  });
  return connection;
}

type Query = { sql: string; params: unknown[] };

const sqlOf = (connection: ReturnType<typeof connectionMock>): Query[] =>
  connection.execute.mock.calls.map(([sql, params]) => ({
    sql: sql.replace(/\s+/g, " ").trim(),
    params: Array.isArray(params) ? params : [],
  }));

const updatesOf = (connection: ReturnType<typeof connectionMock>) =>
  sqlOf(connection).filter((q) => q.sql.startsWith("UPDATE bg_users"));

/** Fait échouer la n-ième requête (1 = la première), les autres suivent le double. */
function failCall(connection: ReturnType<typeof connectionMock>, n: number, error: Error) {
  const base = connection.execute.getMockImplementation()!;
  let calls = 0;
  connection.execute.mockImplementation(async (sql: string, params?: unknown) => {
    calls += 1;
    if (calls === n) throw error;
    return base(sql, params);
  });
}

/**
 * Réactivation dont le vrai pseudo est pris : l'UPDATE qui pose un pseudo de
 * `taken` lève un doublon ; `heldBy` dit quel compte réserve un pseudo (masque).
 */
function takenPseudos(taken: string[], heldBy: Record<string, number> = {}) {
  const connection = connectionMock();
  connection.execute.mockImplementation(async (sql: string, params?: unknown) => {
    const q = sql.replace(/\s+/g, " ").trim();
    const values = Array.isArray(params) ? params : [];
    if (q.startsWith("SELECT pseudo, avatar_url FROM bg_account_deletion_holds")) {
      return [[{ pseudo: "Kerya", avatar_url: AVATAR }], []];
    }
    if (q.startsWith("SELECT user_id FROM bg_account_deletion_holds")) {
      const owner = heldBy[String(values[0])];
      return [owner ? [{ user_id: owner }] : [], []];
    }
    if (q.startsWith("UPDATE bg_users") && q.includes("pseudo = ?") && taken.includes(String(values[0]))) {
      throw duplicate();
    }
    return [{ affectedRows: 1 }, []];
  });
  return connection;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
});

describe("isPseudoHeldByOther", () => {
  it("isPseudoHeldByOther_heldByOtherAccount_true", async () => {
    const connection = transaction({ taken: [{ user_id: 9 }] });

    expect(await isPseudoHeldByOther(fakeConnection(connection), "Kerya", 7)).toBe(true);
  });

  it("isPseudoHeldByOther_heldByItsOwner_false", async () => {
    const connection = transaction({ taken: [{ user_id: 7 }] });

    expect(await isPseudoHeldByOther(fakeConnection(connection), "Kerya", 7)).toBe(false);
  });

  it("isPseudoHeldByOther_notHeld_false", async () => {
    const connection = transaction({ taken: [] });

    expect(await isPseudoHeldByOther(fakeConnection(connection), "Kerya", null)).toBe(false);
  });

  // ERREUR.txt (revue sécurité #546) : table des masques absente → rien n'y
  // est réservé, l'inscription et le renommage ne tombent pas.
  it("isPseudoHeldByOther_missingHoldsTable_false", async () => {
    const connection = connectionMock();
    connection.execute.mockRejectedValue(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" }));

    expect(await isPseudoHeldByOther(fakeConnection(connection), "Kerya", 7)).toBe(false);
  });

  it("isPseudoHeldByOther_otherError_rethrows", async () => {
    const connection = connectionMock();
    connection.execute.mockRejectedValue(Object.assign(new Error("down"), { code: "ECONNRESET" }));

    await expect(isPseudoHeldByOther(fakeConnection(connection), "Kerya", 7)).rejects.toThrow("down");
  });
});

describe("loadTakenAnonymousPseudos", () => {
  it("loadTakenAnonymousPseudos_accountsAndHolds_readsBothExcludingSelf", async () => {
    const connection = transaction({ taken: [{ pseudo: "AlphaFX" }, { pseudo: "AlphaGod" }] });

    const taken = await loadTakenAnonymousPseudos(fakeConnection(connection), 7);

    expect(taken).toEqual(new Set(["AlphaFX", "AlphaGod"]));
    const [read] = sqlOf(connection);
    expect(read.sql).toContain("UNION SELECT pseudo FROM bg_account_deletion_holds WHERE user_id <> ?");
    expect(read.params).toEqual([7, ...ANONYMOUS_PSEUDOS, 7, ...ANONYMOUS_PSEUDOS]);
  });
});

describe("holdAccountIdentity", () => {
  it("holdAccountIdentity_living_parksRealPseudoAndAvatar", async () => {
    const connection = transaction({ live: { pseudo: "Kerya", avatar_url: AVATAR } });

    expect(await holdAccountIdentity(fakeConnection(connection), 7, REQUESTED)).toBe(true);

    const park = sqlOf(connection).find((q) => q.sql.startsWith("INSERT INTO bg_account_deletion_holds"));
    expect(park?.params).toEqual([7, "Kerya", AVATAR]);
  });

  it("holdAccountIdentity_living_setsBorrowedPseudoInTheFlagWrite", async () => {
    const connection = transaction({ live: { pseudo: "Kerya", avatar_url: AVATAR } });

    await holdAccountIdentity(fakeConnection(connection), 7, REQUESTED);

    const [mark] = updatesOf(connection);
    expect(mark.sql).toContain("SET pseudo = ?, avatar_url = NULL, is_deleted = 1, deletion_requested_at = ?");
    expect(mark.sql).toContain("WHERE id = ? AND is_deleted = 0");
    expect(ANONYMOUS_PSEUDOS).toContain(mark.params[0]);
    expect(mark.params.slice(1)).toEqual([REQUESTED, 7]);
    expect(syncSoloEntryIdentityOn).toHaveBeenCalledWith(expect.anything(), 7);
  });

  it("holdAccountIdentity_noPreviousHold_insertsWithoutDelete", async () => {
    const connection = transaction({ live: { pseudo: "Kerya", avatar_url: AVATAR } });

    await holdAccountIdentity(fakeConnection(connection), 7, REQUESTED);

    expect(sqlOf(connection).some((q) => q.sql.startsWith("DELETE FROM bg_account_deletion_holds"))).toBe(false);
  });

  it("holdAccountIdentity_living_dropsPreviousHoldThenPlainInsert", async () => {
    const connection = transaction({ live: { pseudo: "Kerya", avatar_url: AVATAR }, hold: { pseudo: "Old", avatar_url: null } });

    await holdAccountIdentity(fakeConnection(connection), 7, REQUESTED);

    const writes = sqlOf(connection).filter((q) => q.sql.includes("bg_account_deletion_holds") && !q.sql.startsWith("SELECT"));
    expect(writes[0]).toEqual({ sql: "DELETE FROM bg_account_deletion_holds WHERE user_id = ?", params: [7] });
    expect(writes[1].sql).toBe("INSERT INTO bg_account_deletion_holds (user_id, pseudo, avatar_url) VALUES (?, ?, ?)");
  });

  // Course documentée de la réactivation : un compte vivant porte un pseudo
  // qu'un compte en attente a déjà mis de côté. Sa demande n'échoue pas.
  it("holdAccountIdentity_pseudoHeldByOtherAccount_holdsPseudoSuffixedOG", async () => {
    const connection = transaction({ live: { pseudo: "Nova", avatar_url: AVATAR } });
    // Lecture du compte, ancien masque retiré, puis l'insertion refusée.
    failCall(connection, 3, duplicate());

    expect(await holdAccountIdentity(fakeConnection(connection), 7, REQUESTED)).toBe(true);

    const inserts = sqlOf(connection).filter((q) => q.sql.startsWith("INSERT INTO bg_account_deletion_holds"));
    expect(inserts.map((q) => q.params)).toEqual([
      [7, "Nova", AVATAR],
      [7, "NovaOG", AVATAR],
    ]);
    expect(updatesOf(connection)).toHaveLength(1);
  });

  it("holdAccountIdentity_ogCandidateCarriedByLiveAccount_skipsToOG2", async () => {
    const connection = transaction({ live: { pseudo: "Nova", avatar_url: AVATAR } });
    const base = connection.execute.getMockImplementation()!;
    connection.execute.mockImplementation(async (sql: string, params?: unknown) => {
      const values = Array.isArray(params) ? params : [];
      if (sql.startsWith("INSERT INTO bg_account_deletion_holds") && values[1] === "Nova") throw duplicate();
      if (sql.startsWith("SELECT 1 FROM bg_users WHERE pseudo = ?")) return [values[0] === "NovaOG" ? [{ 1: 1 }] : [], []];
      return base(sql, params);
    });

    expect(await holdAccountIdentity(fakeConnection(connection), 7, REQUESTED)).toBe(true);

    const inserts = sqlOf(connection).filter((q) => q.sql.startsWith("INSERT INTO bg_account_deletion_holds"));
    expect(inserts.map((q) => q.params[1])).toEqual(["Nova", "NovaOG2"]);
  });

  it("holdAccountIdentity_everySuffixedPseudoHeld_throwsDuplicateAndMarksNothing", async () => {
    const connection = transaction({ live: { pseudo: "Nova", avatar_url: AVATAR } });
    const base = connection.execute.getMockImplementation()!;
    connection.execute.mockImplementation(async (sql: string, params?: unknown) => {
      if (sql.startsWith("INSERT INTO bg_account_deletion_holds")) throw duplicate();
      return base(sql, params);
    });

    await expect(holdAccountIdentity(fakeConnection(connection), 7, REQUESTED)).rejects.toMatchObject({
      code: "ER_DUP_ENTRY",
    });
    // Le vrai pseudo, puis « NovaOG » à « NovaOG10 ».
    expect(sqlOf(connection).filter((q) => q.sql.startsWith("INSERT INTO bg_account_deletion_holds"))).toHaveLength(11);
    expect(updatesOf(connection)).toEqual([]);
  });

  it("holdAccountIdentity_otherInsertError_propagatesWithoutRetry", async () => {
    const connection = transaction({ live: { pseudo: "Nova", avatar_url: AVATAR } });
    failCall(connection, 3, new Error("DB_DOWN"));

    await expect(holdAccountIdentity(fakeConnection(connection), 7, REQUESTED)).rejects.toThrow("DB_DOWN");
    expect(sqlOf(connection).filter((q) => q.sql.startsWith("INSERT INTO bg_account_deletion_holds"))).toHaveLength(1);
  });

  it("holdAccountIdentity_alreadyDeleted_falseAndNothingWritten", async () => {
    const connection = transaction({ live: null });

    expect(await holdAccountIdentity(fakeConnection(connection), 7, REQUESTED)).toBe(false);
    expect(sqlOf(connection).filter((q) => !q.sql.startsWith("SELECT"))).toEqual([]);
    expect(syncSoloEntryIdentityOn).not.toHaveBeenCalled();
  });

  it("holdAccountIdentity_borrowedPseudoTaken_retriesWithAnotherPseudo", async () => {
    const connection = transaction({ live: { pseudo: "Kerya", avatar_url: null } });
    // Lecture du compte, ancien masque retiré, masque, pseudos pris, puis le
    // premier UPDATE refusé.
    failCall(connection, 5, duplicate());

    expect(await holdAccountIdentity(fakeConnection(connection), 7, REQUESTED)).toBe(true);

    const updates = updatesOf(connection);
    expect(updates).toHaveLength(2);
    expect(updates[1].params[0]).not.toBe(updates[0].params[0]);
  });

  it("holdAccountIdentity_duplicateFiveTimes_throws", async () => {
    const connection = transaction({ live: { pseudo: "Kerya", avatar_url: null } });
    const base = connection.execute.getMockImplementation()!;
    connection.execute.mockImplementation(async (sql: string, params?: unknown) => {
      if (sql.trim().startsWith("UPDATE bg_users")) throw duplicate();
      return base(sql, params);
    });

    await expect(holdAccountIdentity(fakeConnection(connection), 7, REQUESTED)).rejects.toMatchObject({
      code: "ER_DUP_ENTRY",
    });
    expect(updatesOf(connection)).toHaveLength(5);
  });

  it("holdAccountIdentity_accountChangedUnderneath_false", async () => {
    const connection = transaction({ live: { pseudo: "Kerya", avatar_url: null }, affectedRows: 0 });

    expect(await holdAccountIdentity(fakeConnection(connection), 7, REQUESTED)).toBe(false);
    expect(syncSoloEntryIdentityOn).not.toHaveBeenCalled();
  });
});

describe("restoreAccountIdentity", () => {
  it("restoreAccountIdentity_hold_restoresPseudoAndAvatarThenDropsHold", async () => {
    const connection = transaction({ hold: { pseudo: "Kerya", avatar_url: AVATAR } });

    expect(await restoreAccountIdentity(fakeConnection(connection), 7)).toBe("RESTORED");

    const queries = sqlOf(connection);
    expect(queries[0].sql).toContain("FROM bg_account_deletion_holds WHERE user_id = ? LIMIT 1 FOR UPDATE");
    const [revive] = updatesOf(connection);
    expect(revive.sql).toContain("is_deleted = 0, deletion_requested_at = NULL, pseudo = ?, avatar_url = ?");
    expect(revive.sql).toContain("AND is_deleted = 1 AND deletion_requested_at IS NOT NULL");
    expect(revive.params).toEqual(["Kerya", AVATAR, 7]);
    expect(queries.some((q) => q.sql === "DELETE FROM bg_account_deletion_holds WHERE user_id = ?")).toBe(true);
    expect(syncSoloEntryIdentityOn).toHaveBeenCalledWith(expect.anything(), 7);
  });

  // Décision R3 du 2026-11-04 : le vrai pseudo pris revient suivi de « OG ».
  it("restoreAccountIdentity_pseudoTaken_restoresPseudoOG", async () => {
    const connection = takenPseudos(["Kerya"]);

    expect(await restoreAccountIdentity(fakeConnection(connection), 7)).toBe("RENAMED");

    const revive = updatesOf(connection).at(-1);
    expect(revive?.params).toEqual(["KeryaOG", AVATAR, 7]);
  });

  it("restoreAccountIdentity_pseudoOGHeldByOther_triesOG2", async () => {
    const connection = takenPseudos(["Kerya"], { KeryaOG: 9 });

    expect(await restoreAccountIdentity(fakeConnection(connection), 7)).toBe("RENAMED");

    expect(updatesOf(connection).map((q) => q.params[0])).toEqual(["Kerya", "KeryaOG2"]);
  });

  it("restoreAccountIdentity_allCandidatesTaken_keepsBorrowedPseudo", async () => {
    const taken = ["Kerya", "KeryaOG", ...Array.from({ length: 9 }, (_, i) => `KeryaOG${i + 2}`)];
    const connection = takenPseudos(taken);

    expect(await restoreAccountIdentity(fakeConnection(connection), 7)).toBe("RENAMED");

    const revive = updatesOf(connection).at(-1);
    expect(revive?.sql).not.toContain("pseudo = ?");
    expect(revive?.params).toEqual([AVATAR, 7]);
    expect(updatesOf(connection)).toHaveLength(12);
  });

  it("restoreAccountIdentity_otherError_propagates", async () => {
    const connection = transaction({ hold: { pseudo: "Kerya", avatar_url: null } });
    failCall(connection, 2, new Error("DB_DOWN"));

    await expect(restoreAccountIdentity(fakeConnection(connection), 7)).rejects.toThrow("DB_DOWN");
  });

  it("restoreAccountIdentity_noHold_clearsPendingFlagOnly", async () => {
    const connection = transaction({ hold: null });

    expect(await restoreAccountIdentity(fakeConnection(connection), 7)).toBe("RENAMED");

    const [revive] = updatesOf(connection);
    expect(revive.sql).not.toContain("pseudo = ?");
    expect(revive.params).toEqual([7]);
  });

  it("restoreAccountIdentity_notPending_falseAndHoldKept", async () => {
    const connection = transaction({ hold: { pseudo: "Kerya", avatar_url: null }, affectedRows: 0 });

    expect(await restoreAccountIdentity(fakeConnection(connection), 7)).toBeNull();
    expect(sqlOf(connection).some((q) => q.sql.startsWith("DELETE FROM bg_account_deletion_holds"))).toBe(false);
    expect(syncSoloEntryIdentityOn).not.toHaveBeenCalled();
  });
});

// Revue sécurité #571, cycles 3-4 (D6) : la modération atteint l'avatar mis de côté.
describe("readModeratableAvatar", () => {
  it("readModeratableAvatar_liveAccount_returnsRowAvatarWithoutReadingHold", async () => {
    const connection = transaction({ user: { pseudo: "Nova", avatar_url: AVATAR, is_deleted: 0 } });

    const actual = await readModeratableAvatar(fakeConnection(connection), 7, false);

    expect(actual).toEqual({ pseudo: "Nova", avatarUrl: AVATAR, pending: false });
    expect(sqlOf(connection).map((q) => q.sql)).toEqual([
      "SELECT pseudo, avatar_url, is_deleted FROM bg_users WHERE id = ? LIMIT 1",
    ]);
  });

  it("readModeratableAvatar_pendingWithHold_returnsHeldAvatarUnderLocks", async () => {
    const connection = transaction({
      user: { pseudo: "Anonyme-3", avatar_url: null, is_deleted: 1 },
      hold: { pseudo: "Nova", avatar_url: AVATAR },
    });

    const actual = await readModeratableAvatar(fakeConnection(connection), 7, true);

    expect(actual).toEqual({ pseudo: "Anonyme-3", avatarUrl: AVATAR, pending: true });
    expect(sqlOf(connection).map((q) => q.sql)).toEqual([
      "SELECT pseudo, avatar_url, is_deleted FROM bg_users WHERE id = ? FOR UPDATE",
      "SELECT pseudo, avatar_url FROM bg_account_deletion_holds WHERE user_id = ? LIMIT 1 FOR UPDATE",
    ]);
  });

  it("readModeratableAvatar_anonymisedWithoutHold_returnsNull", async () => {
    const connection = transaction({ user: { pseudo: "Anonyme-3", avatar_url: null, is_deleted: 1 }, hold: null });

    expect(await readModeratableAvatar(fakeConnection(connection), 7, true)).toBeNull();
  });

  it("readModeratableAvatar_noRow_returnsNull", async () => {
    const connection = transaction({ user: null });

    expect(await readModeratableAvatar(fakeConnection(connection), 7, false)).toBeNull();
  });
});

describe("setHeldAvatar", () => {
  it("setHeldAvatar_null_clearsHoldAvatar", async () => {
    const connection = transaction({});

    await setHeldAvatar(fakeConnection(connection), 7, null);

    expect(sqlOf(connection)).toEqual([
      { sql: "UPDATE bg_account_deletion_holds SET avatar_url = ? WHERE user_id = ?", params: [null, 7] },
    ]);
  });

  it("setHeldAvatar_url_writesHoldAvatar", async () => {
    const connection = transaction({});

    await setHeldAvatar(fakeConnection(connection), 7, AVATAR);

    expect(sqlOf(connection)[0].params).toEqual([AVATAR, 7]);
  });
});
