import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ResultSetHeader } from "mysql2/promise";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/auth", () => ({ playerViewSessionKey: jest.fn() }));
jest.mock("@/lib/server/session-streams", () => ({ reconnectSessionStreams: jest.fn() }));
jest.mock("@/lib/server/staff-audit", () => ({ auditStaffAction: jest.fn() }));

import { getDatabase } from "@/lib/server/database";
import { playerViewSessionKey } from "@/lib/server/auth";
import { reconnectSessionStreams } from "@/lib/server/session-streams";
import { auditStaffAction } from "@/lib/server/staff-audit";
import {
  clearAccountImpersonation,
  impersonationAuditLine,
  PLAYER_VIEW_NO_SESSION,
  PLAYER_VIEW_NOT_ADMIN,
  PLAYER_VIEW_OFF_AUDIT,
  PLAYER_VIEW_ON_AUDIT,
  setPlayerView,
} from "@/lib/server/player-view";
import { type SqlQuery, fakeConnection, fakePool } from "../../helpers/sql-double";
import { authUser } from "../../helpers/auth-user";

const admin = authUser({ id: 7, pseudo: "Chef", isAdmin: true });
const HASH = "a".repeat(64);
const DEADLINE = new Date("2026-11-18T22:00:00.000Z");

function header(affectedRows: number): ResultSetHeader {
  return { affectedRows } as ResultSetHeader;
}

/** Ligne relue après l'écriture ; `null` : aucune ligne de session. */
type ReadBack = {
  player_view_until: Date | null;
  impersonated_roles_json?: string | null;
  active: number | null;
} | null;

let execute: jest.Mock<SqlQuery>;

/** Relecture de l'administration après une entrée (`SELECT is_admin FROM bg_users`). */
const isAdminRead = (sql: unknown) => String(sql).includes("FROM bg_users");

/**
 * Double SQL : les écritures rendent `written` lignes touchées, la relecture
 * rend `readBack`, l'administration relue vaut `isAdmin`.
 */
function database(written: number, readBack: ReadBack, isAdmin = 1) {
  execute = jest.fn<SqlQuery>().mockImplementation(async (sql) => {
    if (isAdminRead(sql)) return [[{ is_admin: isAdmin }], []];
    return String(sql).trimStart().startsWith("SELECT")
      ? [readBack === null ? [] : [readBack], []]
      : [header(written), []];
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

const sqlCalls = () => execute.mock.calls.map(([sql]) => String(sql));

beforeEach(() => {
  jest.clearAllMocks();
  database(1, { player_view_until: DEADLINE, active: 1 });
  jest.mocked(playerViewSessionKey).mockResolvedValue({ tokenHash: HASH, devBypass: false });
});

describe("setPlayerView — session à cookie", () => {
  it("setPlayerView_activate_setsDeadlineOnThisSessionOnlyWhenNotActive", async () => {
    await setPlayerView(admin, true);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("SET player_view_until = DATE_ADD(NOW(), INTERVAL ? HOUR), impersonated_roles_json = ?");
    expect(sql).toContain("WHERE token_hash = ? AND user_id = ? AND expires_at > NOW()");
    expect(sql).toContain("(player_view_until IS NULL OR player_view_until <= NOW())");
    expect(params).toEqual([12, "[]", HASH, 7]);
  });

  it("setPlayerView_activateWithRoles_storesNormalisedRolesWithoutAdmin", async () => {
    await setPlayerView(admin, true, ["DEV", "ADMIN", "CASTER"]);

    expect(execute.mock.calls[0][1]).toEqual([12, '["CASTER","DEV"]', HASH, 7]);
  });

  it("setPlayerView_activateWithRoles_returnsRolesReadFromDb", async () => {
    database(1, { player_view_until: DEADLINE, impersonated_roles_json: '["ARBITRE"]', active: 1 });

    const result = await setPlayerView(admin, true, ["ARBITRE"]);

    expect(result).toEqual({ until: "2026-11-18T22:00:00.000Z", roles: ["ARBITRE"], changed: true });
  });

  it("setPlayerView_activate_returnsDeadlineReadFromDb", async () => {
    const result = await setPlayerView(admin, true);

    expect(result.until).toBe("2026-11-18T22:00:00.000Z");
  });

  it("setPlayerView_alreadyActive_keepsStoredDeadlineWithoutAuditOrReconnect", async () => {
    database(0, { player_view_until: DEADLINE, active: 1 });

    const result = await setPlayerView(admin, true);

    expect(result.until).toBe("2026-11-18T22:00:00.000Z");
    expect(auditStaffAction).not.toHaveBeenCalled();
    expect(reconnectSessionStreams).not.toHaveBeenCalled();
  });

  it("setPlayerView_deactivate_clearsOnlyALiveDeadline", async () => {
    database(1, { player_view_until: null, active: null });

    const result = await setPlayerView(admin, false);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("SET player_view_until = NULL, impersonated_roles_json = NULL");
    expect(sql).toContain("AND player_view_until > NOW()");
    expect(params).toEqual([HASH, 7]);
    expect(result).toEqual({ until: null, roles: [], changed: true });
  });

  it("setPlayerView_deactivateWhenInactive_writesNoAudit", async () => {
    database(0, { player_view_until: null, active: null });

    await setPlayerView(admin, false);

    expect(auditStaffAction).not.toHaveBeenCalled();
    expect(reconnectSessionStreams).not.toHaveBeenCalled();
  });

  it("setPlayerView_deactivateWhenInactive_reportsNothingChanged", async () => {
    database(0, { player_view_until: null, active: null });

    const result = await setPlayerView(admin, false);

    expect(result).toEqual({ until: null, roles: [], changed: false });
  });

  it("setPlayerView_sessionVanished_throwsNoSession", async () => {
    database(0, null);

    await expect(setPlayerView(admin, true)).rejects.toThrow(PLAYER_VIEW_NO_SESSION);
    expect(reconnectSessionStreams).not.toHaveBeenCalled();
    expect(auditStaffAction).not.toHaveBeenCalled();
  });

  it("setPlayerView_noSessionKey_throwsNoSessionWithoutWriting", async () => {
    jest.mocked(playerViewSessionKey).mockResolvedValue(null);

    await expect(setPlayerView(admin, true)).rejects.toThrow(PLAYER_VIEW_NO_SESSION);
    expect(execute).not.toHaveBeenCalled();
  });

  it("setPlayerView_activate_reconnectsThisSessionStreams", async () => {
    await setPlayerView(admin, true);

    expect(reconnectSessionStreams).toHaveBeenCalledWith(7, HASH);
  });

  it("setPlayerView_activate_auditsInPm2WithTheAuthor", async () => {
    await setPlayerView(admin, true);

    expect(auditStaffAction).toHaveBeenCalledWith(`${PLAYER_VIEW_ON_AUDIT} : joueur (aucun rôle)`, {
      id: 7,
      pseudo: "Chef",
    });
  });

  it("setPlayerView_activateWithRoles_auditsTheChosenRoles", async () => {
    await setPlayerView(admin, true, ["RECRUTEUR", "CASTER"]);

    expect(auditStaffAction).toHaveBeenCalledWith(`${PLAYER_VIEW_ON_AUDIT} : CASTER, RECRUTEUR`, { id: 7, pseudo: "Chef" });
  });

  it("setPlayerView_deactivate_auditsTheReturn", async () => {
    database(1, { player_view_until: null, active: null });

    await setPlayerView(admin, false);

    expect(auditStaffAction).toHaveBeenCalledWith(PLAYER_VIEW_OFF_AUDIT, { id: 7, pseudo: "Chef" });
  });
});

describe("setPlayerView — administration retirée pendant l'entrée", () => {
  it("setPlayerView_entryAfterDemotion_undoesWriteAndThrowsNotAdmin", async () => {
    database(1, { player_view_until: DEADLINE, active: 1 }, 0);

    await expect(setPlayerView(admin, true, ["CASTER"])).rejects.toThrow(PLAYER_VIEW_NOT_ADMIN);

    const undo = sqlCalls().at(-1);
    expect(undo).toContain("UPDATE bg_user_sessions SET player_view_until = NULL, impersonated_roles_json = NULL");
    expect(undo).toContain("player_view_until > NOW()");
    expect(execute.mock.calls.at(-1)?.[1]).toEqual([HASH, 7]);
  });

  it("setPlayerView_entryAfterDemotion_auditsTheEntryThenItsUndo", async () => {
    database(1, { player_view_until: DEADLINE, active: 1 }, 0);

    await expect(setPlayerView(admin, true, ["CASTER"])).rejects.toThrow(PLAYER_VIEW_NOT_ADMIN);

    expect(jest.mocked(auditStaffAction).mock.calls.map(([line]) => line)).toEqual([
      impersonationAuditLine(["CASTER"]),
      PLAYER_VIEW_OFF_AUDIT,
    ]);
    expect(reconnectSessionStreams).toHaveBeenCalledTimes(2);
  });

  it("setPlayerView_entryStillAdmin_keepsWrite", async () => {
    const result = await setPlayerView(admin, true, ["CASTER"]);

    expect(result.changed).toBe(true);
    expect(sqlCalls().filter((sql) => sql.includes("SET player_view_until = NULL"))).toEqual([]);
  });

  it("setPlayerView_entryWithoutWrite_neverReadsAdmin", async () => {
    database(0, { player_view_until: DEADLINE, active: 1 }, 0);

    await setPlayerView(admin, true);

    expect(sqlCalls().some(isAdminRead)).toBe(false);
  });

  it("setPlayerView_exit_neverReadsAdmin", async () => {
    database(1, { player_view_until: null, active: 0 }, 0);

    await setPlayerView(admin, false);

    expect(sqlCalls().some(isAdminRead)).toBe(false);
  });

  it("setPlayerView_devBypassEntryAfterDemotion_deletesRowAndThrows", async () => {
    jest.mocked(playerViewSessionKey).mockResolvedValue({ tokenHash: "dev-auth-bypass:7", devBypass: true });
    database(1, { player_view_until: DEADLINE, active: 1 }, 0);

    await expect(setPlayerView(admin, true)).rejects.toThrow(PLAYER_VIEW_NOT_ADMIN);

    const undo = sqlCalls().at(-1);
    expect(undo).toContain("DELETE FROM bg_user_sessions");
    expect(undo).toContain("player_view_until > NOW()");
  });
});

describe("clearAccountImpersonation", () => {
  it("clearAccountImpersonation_activeOnly_returnsAffectedCount", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([header(2), []]);

    const cleared = await clearAccountImpersonation(fakeConnection({ execute }), 7);

    expect(cleared).toBe(2);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("WHERE user_id = ? AND player_view_until > NOW()");
    expect(params).toEqual([7]);
  });

  it("clearAccountImpersonation_withoutRolesColumn_clearsDeadlineOnly", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockRejectedValueOnce(Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" }))
      .mockResolvedValueOnce([header(1), []]);

    const cleared = await clearAccountImpersonation(fakeConnection({ execute }), 7);

    expect(cleared).toBe(1);
    expect(String(execute.mock.calls[1][0])).not.toContain("impersonated_roles_json");
  });
});

describe("setPlayerView — relecture en échec", () => {
  it("setPlayerView_readBackFails_stillReconnectsAndAudits", async () => {
    execute = jest.fn<SqlQuery>().mockImplementation(async (sql) => {
      if (String(sql).trimStart().startsWith("SELECT")) throw new Error("pool lost");
      return [header(1), []];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await expect(setPlayerView(admin, true)).rejects.toThrow("pool lost");
    expect(reconnectSessionStreams).toHaveBeenCalledWith(7, HASH);
    expect(auditStaffAction).toHaveBeenCalledWith(impersonationAuditLine([]), { id: 7, pseudo: "Chef" });
  });
});

describe("setPlayerView — colonne des rôles absente (ALTER non joué)", () => {
  const unknownColumn = () => Object.assign(new Error("Unknown column 'impersonated_roles_json'"), { code: "ER_BAD_FIELD_ERROR" });

  /** Toute requête qui nomme la colonne échoue, comme sur une base où l'ALTER n'a pas pris. */
  function databaseWithoutRolesColumn(written: number, readBack: ReadBack) {
    execute = jest.fn<SqlQuery>().mockImplementation(async (sql) => {
      const text = String(sql);
      if (isAdminRead(text)) return [[{ is_admin: 1 }], []];
      if (text.replace("NULL AS impersonated_roles_json", "").includes("impersonated_roles_json")) throw unknownColumn();
      return text.trimStart().startsWith("SELECT") ? [readBack === null ? [] : [readBack], []] : [header(written), []];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  }

  it("setPlayerView_deactivateWithoutRolesColumn_clearsDeadlineOnly", async () => {
    databaseWithoutRolesColumn(1, { player_view_until: null, active: null });

    const result = await setPlayerView(admin, false);

    expect(result).toEqual({ until: null, roles: [], changed: true });
    const exitWrites = sqlCalls().filter((sql) => sql.includes("SET player_view_until = NULL"));
    expect(exitWrites).toHaveLength(2);
    expect(exitWrites[1]).not.toContain("impersonated_roles_json");
    expect(auditStaffAction).toHaveBeenCalledWith(PLAYER_VIEW_OFF_AUDIT, { id: 7, pseudo: "Chef" });
  });

  it("setPlayerView_readBackWithoutRolesColumn_readsPlayerView", async () => {
    execute = jest.fn<SqlQuery>().mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.trimStart().startsWith("SELECT") && !text.includes("NULL AS impersonated_roles_json")) throw unknownColumn();
      return text.trimStart().startsWith("SELECT")
        ? [[{ player_view_until: DEADLINE, impersonated_roles_json: null, active: 1 }], []]
        : [header(0), []];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    const result = await setPlayerView(admin, true);

    expect(result).toEqual({ until: "2026-11-18T22:00:00.000Z", roles: [], changed: false });
  });

  it("setPlayerView_activateWithoutRolesColumn_fails", async () => {
    databaseWithoutRolesColumn(1, { player_view_until: DEADLINE, active: 1 });

    await expect(setPlayerView(admin, true, ["CASTER"])).rejects.toThrow("Unknown column");
    expect(auditStaffAction).not.toHaveBeenCalled();
  });

  it("setPlayerView_deactivateOtherError_rethrows", async () => {
    execute = jest.fn<SqlQuery>().mockRejectedValue(new Error("pool lost"));
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await expect(setPlayerView(admin, false)).rejects.toThrow("pool lost");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("setPlayerView — contournement de développement", () => {
  beforeEach(() => {
    jest.mocked(playerViewSessionKey).mockResolvedValue({ tokenHash: "dev-auth-bypass:7", devBypass: true });
  });

  it("setPlayerView_devBypassActivate_removesStaleRowThenInsertsWithoutExtending", async () => {
    await setPlayerView(admin, true);

    const [stale, insert] = sqlCalls();
    expect(stale).toContain("DELETE FROM bg_user_sessions");
    expect(stale).toContain("(player_view_until IS NULL OR player_view_until <= NOW())");
    expect(insert).toContain("INSERT INTO bg_user_sessions");
    expect(insert).toContain("impersonated_roles_json");
    expect(execute.mock.calls[1][1]).toEqual(["dev-auth-bypass:7", 7, 12, 12, "[]"]);
  });

  it("setPlayerView_devBypassActivateWithRoles_insertsTheRoles", async () => {
    await setPlayerView(admin, true, ["PROD"]);

    expect(execute.mock.calls[1][1]).toEqual(["dev-auth-bypass:7", 7, 12, 12, '["PROD"]']);
  });

  it("setPlayerView_devBypassAlreadyActive_writesNoAudit", async () => {
    database(0, { player_view_until: DEADLINE, active: 1 });

    const result = await setPlayerView(admin, true);

    expect(result.until).toBe("2026-11-18T22:00:00.000Z");
    expect(auditStaffAction).not.toHaveBeenCalled();
  });

  it("setPlayerView_devBypassDeactivate_deletesOnlyTheLiveRow", async () => {
    database(1, null);

    const result = await setPlayerView(admin, false);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("DELETE FROM bg_user_sessions WHERE token_hash = ? AND user_id = ? AND player_view_until > NOW()");
    expect(params).toEqual(["dev-auth-bypass:7", 7]);
    expect(result.until).toBeNull();
  });

  it("setPlayerView_devBypassDuplicateInsert_reportsNoChange", async () => {
    execute = jest.fn<SqlQuery>().mockImplementation(async (sql) => {
      const text = String(sql).trimStart();
      if (text.startsWith("INSERT")) throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
      return text.startsWith("SELECT") ? [[{ player_view_until: DEADLINE, active: 1 }], []] : [header(0), []];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    const result = await setPlayerView(admin, true);

    expect(result.until).toBe("2026-11-18T22:00:00.000Z");
    expect(auditStaffAction).not.toHaveBeenCalled();
    expect(reconnectSessionStreams).not.toHaveBeenCalled();
  });

  it("setPlayerView_devBypassOtherInsertError_rethrows", async () => {
    execute = jest.fn<SqlQuery>().mockImplementation(async (sql) => {
      if (String(sql).trimStart().startsWith("INSERT")) {
        throw Object.assign(new Error("Field doesn't have a default value"), { code: "ER_NO_DEFAULT_FOR_FIELD" });
      }
      return [header(0), []];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));

    await expect(setPlayerView(admin, true)).rejects.toThrow("Field doesn't have a default value");
    expect(auditStaffAction).not.toHaveBeenCalled();
  });

  it("setPlayerView_devBypass_reconnectsEveryStreamOfTheAccount", async () => {
    await setPlayerView(admin, true);

    expect(reconnectSessionStreams).toHaveBeenCalledWith(7, null);
  });
});

describe("impersonationAuditLine", () => {
  it("impersonationAuditLine_roles_namesThem", () => {
    expect(impersonationAuditLine(["ARBITRE", "DEV"])).toBe(`${PLAYER_VIEW_ON_AUDIT} : ARBITRE, DEV`);
  });

  it("impersonationAuditLine_noRole_saysPlayer", () => {
    expect(impersonationAuditLine([])).toBe(`${PLAYER_VIEW_ON_AUDIT} : joueur (aucun rôle)`);
  });
});
