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
  PLAYER_VIEW_NO_SESSION,
  PLAYER_VIEW_OFF_AUDIT,
  PLAYER_VIEW_ON_AUDIT,
  setPlayerView,
} from "@/lib/server/player-view";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";
import { authUser } from "../../helpers/auth-user";

const admin = authUser({ id: 7, pseudo: "Chef", isAdmin: true });
const HASH = "a".repeat(64);
const DEADLINE = new Date("2026-11-18T22:00:00.000Z");

function header(affectedRows: number): ResultSetHeader {
  return { affectedRows } as ResultSetHeader;
}

/** Ligne relue après l'écriture ; `null` : aucune ligne de session. */
type ReadBack = { player_view_until: Date | null; active: number | null } | null;

let execute: jest.Mock<SqlQuery>;

/** Double SQL : les écritures rendent `written` lignes touchées, la relecture rend `readBack`. */
function database(written: number, readBack: ReadBack) {
  execute = jest.fn<SqlQuery>().mockImplementation(async (sql) =>
    String(sql).trimStart().startsWith("SELECT")
      ? [readBack === null ? [] : [readBack], []]
      : [header(written), []],
  );
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
    expect(sql).toContain("SET player_view_until = DATE_ADD(NOW(), INTERVAL ? HOUR)");
    expect(sql).toContain("WHERE token_hash = ? AND user_id = ? AND expires_at > NOW()");
    expect(sql).toContain("(player_view_until IS NULL OR player_view_until <= NOW())");
    expect(params).toEqual([12, HASH, 7]);
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
    expect(sql).toContain("SET player_view_until = NULL");
    expect(sql).toContain("AND player_view_until > NOW()");
    expect(params).toEqual([HASH, 7]);
    expect(result.until).toBeNull();
  });

  it("setPlayerView_deactivateWhenInactive_writesNoAudit", async () => {
    database(0, { player_view_until: null, active: null });

    await setPlayerView(admin, false);

    expect(auditStaffAction).not.toHaveBeenCalled();
    expect(reconnectSessionStreams).not.toHaveBeenCalled();
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

    expect(auditStaffAction).toHaveBeenCalledWith(PLAYER_VIEW_ON_AUDIT, { id: 7, pseudo: "Chef" });
  });

  it("setPlayerView_deactivate_auditsTheReturn", async () => {
    database(1, { player_view_until: null, active: null });

    await setPlayerView(admin, false);

    expect(auditStaffAction).toHaveBeenCalledWith(PLAYER_VIEW_OFF_AUDIT, { id: 7, pseudo: "Chef" });
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
    expect(auditStaffAction).toHaveBeenCalledWith(PLAYER_VIEW_ON_AUDIT, { id: 7, pseudo: "Chef" });
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
    expect(execute.mock.calls[1][1]).toEqual(["dev-auth-bypass:7", 7, 12, 12]);
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
