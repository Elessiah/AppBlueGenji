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

function header(affectedRows: number): ResultSetHeader {
  return { affectedRows } as ResultSetHeader;
}

let execute: jest.Mock<SqlQuery>;

beforeEach(() => {
  jest.clearAllMocks();
  execute = jest.fn<SqlQuery>().mockResolvedValue([header(1), []]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  jest.mocked(playerViewSessionKey).mockResolvedValue({ tokenHash: HASH, devBypass: false });
});

describe("setPlayerView — session à cookie", () => {
  it("setPlayerView_activate_setsDeadlineOnThisSessionOnly", async () => {
    const result = await setPlayerView(admin, true);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("SET player_view_until = DATE_ADD(NOW(), INTERVAL ? HOUR)");
    expect(sql).toContain("WHERE token_hash = ? AND user_id = ? AND expires_at > NOW()");
    expect(params).toEqual([12, HASH, 7]);
    expect(result.until).toEqual(expect.any(String));
  });

  it("setPlayerView_deactivate_clearsDeadline", async () => {
    const result = await setPlayerView(admin, false);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("SET player_view_until = NULL");
    expect(params).toEqual([HASH, 7]);
    expect(result.until).toBeNull();
  });

  it("setPlayerView_noLiveSessionRow_throwsNoSession", async () => {
    execute.mockResolvedValue([header(0), []]);

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
    await setPlayerView(admin, false);

    expect(auditStaffAction).toHaveBeenCalledWith(PLAYER_VIEW_OFF_AUDIT, { id: 7, pseudo: "Chef" });
  });
});

describe("setPlayerView — contournement de développement", () => {
  beforeEach(() => {
    jest.mocked(playerViewSessionKey).mockResolvedValue({ tokenHash: "dev-auth-bypass:7", devBypass: true });
  });

  it("setPlayerView_devBypassActivate_upsertsDedicatedRow", async () => {
    await setPlayerView(admin, true);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("INSERT INTO bg_user_sessions");
    expect(sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(params).toEqual(["dev-auth-bypass:7", 7, 12, 12]);
  });

  it("setPlayerView_devBypassDeactivate_deletesDedicatedRow", async () => {
    await setPlayerView(admin, false);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("DELETE FROM bg_user_sessions WHERE token_hash = ? AND user_id = ?");
    expect(params).toEqual(["dev-auth-bypass:7", 7]);
  });

  it("setPlayerView_devBypass_reconnectsTheCookielessStreams", async () => {
    await setPlayerView(admin, true);

    expect(reconnectSessionStreams).toHaveBeenCalledWith(7, "");
  });
});
