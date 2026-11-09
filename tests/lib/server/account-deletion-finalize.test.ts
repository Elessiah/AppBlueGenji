import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");
jest.mock("@/lib/server/image-upload");
jest.mock("@/lib/server/account-deletion-journal");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/blocked-images");
jest.mock("@/lib/server/session-streams");
jest.mock("@/lib/server/logo-quarantine", () => ({
  avatarFileLocations: jest.fn((url: string) => ({ quarantined: `/quarantine/${url.split("/").pop()}` })),
}));

import { getDatabase } from "@/lib/server/database";
import { blockImageHashes, hashImageFiles } from "@/lib/server/blocked-images";
import { recordAccountDeletion } from "@/lib/server/account-deletion-journal";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { closeUserStreams } from "@/lib/server/session-streams";
import { finalizeAccountDeletion } from "@/lib/server/users/account-deletion";
import { finalizeDueAccountDeletions } from "@/lib/server/users/deleted-accounts";
import { fakePool } from "../../helpers/sql-double";

/*
 * Suppression définitive au jour 30 (E4) ; l'avatar en quarantaine part avec
 * l'effacement sans être bloqué (D6 : seule la suppression par la modération
 * bloque une empreinte). La fenêtre se relit sous le verrou du compte : une
 * reconnexion qui vient de réactiver, ou une demande encore récente, ne tombe
 * pas.
 */

const DAY = 24 * 3600 * 1000;
const DUE = new Date(Date.now() - 31 * DAY);
const RECENT = new Date(Date.now() - 3 * DAY);

type Locked = { is_deleted: 0 | 1; deletion_requested_at: Date | null } | null;

function fakeDb(options: {
  locked: Locked;
  played?: number;
  quarantined?: string[];
  due?: number[];
  failLock?: boolean;
  rollbackFails?: boolean;
  failErase?: boolean;
  refereed?: { matchId: number; tournamentId: number }[];
}) {
  const queries: string[] = [];
  const execute = jest.fn(async (sql: string, _params?: unknown[]) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    queries.push(q);
    if (options.failLock && q.includes("FROM bg_users WHERE id = ? FOR UPDATE")) throw new Error("DB_DOWN");
    if (options.failErase && q.startsWith("DELETE FROM bg_users")) throw new Error("ERASE_FAILED");
    if (q.startsWith("SELECT id AS match_id FROM bg_matches WHERE referee_user_id = ?")) {
      return [(options.refereed ?? []).map((match) => ({ match_id: match.matchId }))];
    }
    if (q.startsWith("SELECT id, tournament_id, status FROM bg_matches WHERE id IN")) {
      return [(options.refereed ?? []).map((match) => ({ id: match.matchId, tournament_id: match.tournamentId, status: "READY" }))];
    }
    if (q.startsWith("SELECT id FROM bg_users WHERE is_deleted = 1 AND deletion_requested_at IS NOT NULL")) {
      return [(options.due ?? []).map((id) => ({ id }))];
    }
    if (q.includes("SELECT avatar_url, discord_id, created_at, is_deleted, deletion_requested_at FROM bg_users")) {
      return [options.locked ? [{ avatar_url: null, discord_id: null, created_at: "2026-01-02 03:04:05", ...options.locked }] : []];
    }
    if (q.includes("AS played")) return [[{ played: options.played ?? 0, organized: 0, owned: 0 }]];
    if (q.startsWith("SELECT logo_url FROM bg_logo_quarantines")) {
      return [(options.quarantined ?? []).map((logo_url) => ({ logo_url }))];
    }
    return [[]];
  });
  const connection = {
    execute,
    beginTransaction: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {
      if (options.rollbackFails) throw new Error("CONNECTION_LOST");
    }),
    release: jest.fn(() => {}),
  };
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, getConnection: jest.fn(async () => connection) }));
  return { queries, connection, execute };
}

const wrote = (queries: string[], prefix: string) => queries.some((q) => q.startsWith(prefix));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("finalizeAccountDeletion", () => {
  it("finalizeAccountDeletion_withinWindow_nullNothingWritten", async () => {
    const { queries, connection } = fakeDb({ locked: { is_deleted: 1, deletion_requested_at: RECENT } });

    expect(await finalizeAccountDeletion(7)).toBeNull();
    expect(wrote(queries, "DELETE FROM bg_users")).toBe(false);
    expect(connection.rollback).toHaveBeenCalled();
    expect(recordAccountDeletion).not.toHaveBeenCalled();
  });

  it("finalizeAccountDeletion_reactivatedMeanwhile_null", async () => {
    const { queries } = fakeDb({ locked: { is_deleted: 0, deletion_requested_at: null } });

    expect(await finalizeAccountDeletion(7)).toBeNull();
    expect(wrote(queries, "DELETE FROM bg_users")).toBe(false);
  });

  it("finalizeAccountDeletion_accountGone_nullNoThrow", async () => {
    fakeDb({ locked: null });

    expect(await finalizeAccountDeletion(7)).toBeNull();
  });

  it("finalizeAccountDeletion_dueWithoutTrace_erasesAndJournals", async () => {
    const { queries, connection } = fakeDb({ locked: { is_deleted: 1, deletion_requested_at: DUE } });

    expect((await finalizeAccountDeletion(7))?.mode).toBe("ERASE");
    expect(wrote(queries, "DELETE FROM bg_users")).toBe(true);
    expect(connection.commit).toHaveBeenCalled();
    expect(recordAccountDeletion).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }));
  });

  it("finalizeAccountDeletion_duePlayedAccount_anonymizesAndClearsPendingDate", async () => {
    const { queries } = fakeDb({ locked: { is_deleted: 1, deletion_requested_at: DUE }, played: 1 });

    expect((await finalizeAccountDeletion(7))?.mode).toBe("ANONYMIZE");
    expect(queries).toContain("UPDATE bg_users SET deletion_requested_at = NULL WHERE id = ? AND is_deleted = 1");
    expect(wrote(queries, "DELETE FROM bg_users")).toBe(false);
  });

  it("finalizeAccountDeletion_eraseWithHiddenAvatar_readsItUnderLockWithoutBlockingItsHash", async () => {
    const { queries } = fakeDb({
      locked: { is_deleted: 1, deletion_requested_at: DUE },
      quarantined: ["/api/uploads/avatars/7-abc.webp"],
    });

    expect((await finalizeAccountDeletion(7))?.mode).toBe("ERASE");

    // D6 : un avatar seulement masqué se conteste encore, l'effacement ne le bloque pas.
    expect(hashImageFiles).not.toHaveBeenCalled();
    expect(blockImageHashes).not.toHaveBeenCalled();
    // Relevé sous le verrou du compte, avant la ligne effacée.
    const lock = queries.findIndex((q) => q.includes("FROM bg_users WHERE id = ? FOR UPDATE"));
    const quarantine = queries.findIndex((q) => q.startsWith("SELECT logo_url FROM bg_logo_quarantines"));
    const erase = queries.findIndex((q) => q.startsWith("DELETE FROM bg_users"));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(quarantine).toBeGreaterThan(lock);
    expect(erase).toBeGreaterThan(quarantine);
  });

  // Revue perf #546 cycle 2 : l'annulation qui lève ne masque pas l'erreur d'origine.
  it("finalizeAccountDeletion_rollbackThrows_originalErrorRethrown", async () => {
    fakeDb({ locked: { is_deleted: 1, deletion_requested_at: DUE }, failErase: true, rollbackFails: true });

    await expect(finalizeAccountDeletion(7)).rejects.toThrow("ERASE_FAILED");
  });

  // Revue sécurité EF-21 #526 : un écouteur qui lève après le commit n'empêche
  // ni le journal ni la réponse.
  it("finalizeAccountDeletion_publishThrows_stillJournalsAndResolves", async () => {
    fakeDb({ locked: { is_deleted: 1, deletion_requested_at: DUE }, refereed: [{ matchId: 5, tournamentId: 3 }] });
    jest.mocked(publishMatchUpdatedEvent).mockImplementation(() => {
      throw new Error("LISTENER");
    });
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    expect((await finalizeAccountDeletion(7))?.mode).toBe("ERASE");
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(3, { landingLive: true });
    expect(recordAccountDeletion).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }));
    error.mockRestore();
  });

  // Revue de correction #571 : la fermeture des flux qui lève après le commit ne saute pas le journal.
  it("finalizeAccountDeletion_closeStreamsThrows_stillJournalsAndResolves", async () => {
    fakeDb({ locked: { is_deleted: 1, deletion_requested_at: DUE } });
    jest.mocked(closeUserStreams).mockImplementation(() => {
      throw new Error("STREAM");
    });
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    expect((await finalizeAccountDeletion(7))?.mode).toBe("ERASE");
    expect(recordAccountDeletion).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }));
    error.mockRestore();
  });

  // Revue de correction #571 : le rejeu ne finalise que le compte du journal.
  it("finalizeAccountDeletion_otherCreatedAtUnderLock_nothingDone", async () => {
    const { connection } = fakeDb({ locked: { is_deleted: 1, deletion_requested_at: DUE } });

    expect(await finalizeAccountDeletion(7, { accountCreatedAt: "2025-05-05 05:05:05" })).toBeNull();
    expect(connection.rollback).toHaveBeenCalled();
    expect(recordAccountDeletion).not.toHaveBeenCalled();
  });

  it("finalizeAccountDeletion_sameCreatedAtUnderLock_finalized", async () => {
    fakeDb({ locked: { is_deleted: 1, deletion_requested_at: DUE } });

    expect((await finalizeAccountDeletion(7, { accountCreatedAt: "2026-01-02 03:04:05" }))?.mode).toBe("ERASE");
  });

  it("finalizeAccountDeletion_anonymize_neitherReadsNorBlocksQuarantinedAvatar", async () => {
    const { queries } = fakeDb({
      locked: { is_deleted: 1, deletion_requested_at: DUE },
      played: 1,
      quarantined: ["/api/uploads/avatars/7-abc.webp"],
    });

    await finalizeAccountDeletion(7);

    expect(blockImageHashes).not.toHaveBeenCalled();
    expect(queries.some((q) => q.startsWith("SELECT logo_url FROM bg_logo_quarantines"))).toBe(false);
  });
});

describe("finalizeDueAccountDeletions", () => {
  it("finalizeDueAccountDeletions_dueAccount_finalizesIt", async () => {
    fakeDb({ locked: { is_deleted: 1, deletion_requested_at: DUE }, due: [7] });

    expect(await finalizeDueAccountDeletions()).toEqual({ finalized: 1, failed: 0 });
  });

  it("finalizeDueAccountDeletions_secondPassAlreadyDone_countsNothing", async () => {
    // Idempotence : le compte effacé au premier passage n'est plus rendu par le relevé.
    fakeDb({ locked: null, due: [] });

    expect(await finalizeDueAccountDeletions()).toEqual({ finalized: 0, failed: 0 });
  });

  it("finalizeDueAccountDeletions_reactivatedBetweenScanAndLock_notCounted", async () => {
    fakeDb({ locked: { is_deleted: 0, deletion_requested_at: null }, due: [7] });

    expect(await finalizeDueAccountDeletions()).toEqual({ finalized: 0, failed: 0 });
  });

  it("finalizeDueAccountDeletions_failedAccount_sidelinedFromNextPassQuery", async () => {
    const { execute } = fakeDb({ locked: { is_deleted: 1, deletion_requested_at: DUE }, due: [4242], failLock: true });
    jest.spyOn(console, "error").mockImplementation(() => {});

    expect(await finalizeDueAccountDeletions()).toEqual({ finalized: 0, failed: 1 });
    await finalizeDueAccountDeletions();

    const dueCalls = execute.mock.calls.filter(([sql]) => String(sql).includes("deletion_requested_at IS NOT NULL"));
    expect(String(dueCalls[0][0])).not.toContain("NOT IN");
    expect(String(dueCalls[1][0])).toContain("id NOT IN (?)");
    expect(dueCalls[1][1]).toEqual([4242]);
  });
});
