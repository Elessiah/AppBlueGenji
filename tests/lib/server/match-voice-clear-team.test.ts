import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/transaction");
jest.mock("@/lib/server/tournaments/registration");

import { getDatabase } from "@/lib/server/database";
import { clearVoiceChannel } from "@/lib/server/bot-integration";
import {
  TEAM_CLEARABLE_CHANNEL_SQL,
  clearOwnTeamVoiceChannel,
  resetVoiceSweepForTests,
} from "@/lib/server/tournaments/match-voice";
import { VOICE_CHANNEL_LATE_HOURS, VOICE_CHANNEL_LEAD_MINUTES } from "@/lib/shared/match-voice";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";

// Vidage du salon de sa propre équipe (décision D36, `docs/features/MATCH_VOICE.md`) :
// OWNER, MANAGER ou CAPITAINE de cette équipe, pour son seul salon ; rôle et salon lus ensemble.

/** Base simulée : la lecture du vidage rend `rows` (aucune ligne = pas membre de l'équipe). */
function database(rows: Record<string, unknown>[]) {
  const execute = jest.fn<SqlQuery>(async (sql) => (sql === TEAM_CLEARABLE_CHANNEL_SQL ? [rows, []] : [[], []]));
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return { execute };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetVoiceSweepForTests();
});

describe("clearOwnTeamVoiceChannel", () => {
  it("clearOwnTeamVoiceChannel_ownerOfTeamWithOpenChannel_returnsClearedAndCallsBot", async () => {
    const db = database([{ roles_json: '["OWNER"]', channel_id: "901" }]);
    jest.mocked(clearVoiceChannel).mockResolvedValue({ kind: "ok", value: true });

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("cleared");
    expect(clearVoiceChannel).toHaveBeenCalledWith("901");
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute.mock.calls[0][1]).toEqual([9, 77, 4]);
  });

  it("clearOwnTeamVoiceChannel_captainOfTeam_returnsCleared", async () => {
    database([{ roles_json: '["CAPITAINE","DPS"]', channel_id: "901" }]);
    jest.mocked(clearVoiceChannel).mockResolvedValue({ kind: "ok", value: true });

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("cleared");
  });

  it("clearOwnTeamVoiceChannel_managerOfTeam_returnsCleared", async () => {
    database([{ roles_json: '["MANAGER"]', channel_id: "901" }]);
    jest.mocked(clearVoiceChannel).mockResolvedValue({ kind: "ok", value: true });

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("cleared");
  });

  it("clearOwnTeamVoiceChannel_notMemberOfTeam_returnsNotLeader", async () => {
    // Non-membre, équipe adverse ou entrée solo : aucune ligne d'appartenance.
    database([]);

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("notLeader");
    expect(clearVoiceChannel).not.toHaveBeenCalled();
  });

  it("clearOwnTeamVoiceChannel_memberWithoutLeadRole_returnsNotLeaderEvenWithOpenChannel", async () => {
    database([{ roles_json: '["TANK","COACH"]', channel_id: "901" }]);

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("notLeader");
    expect(clearVoiceChannel).not.toHaveBeenCalled();
  });

  it("clearOwnTeamVoiceChannel_memberWithoutRoles_returnsNotLeader", async () => {
    database([{ roles_json: null, channel_id: "901" }]);

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("notLeader");
  });

  it("clearOwnTeamVoiceChannel_leaderWithoutOpenChannel_returnsNotOpen", async () => {
    database([{ roles_json: '["OWNER"]', channel_id: null }]);

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("notOpen");
    expect(clearVoiceChannel).not.toHaveBeenCalled();
  });

  it("clearOwnTeamVoiceChannel_botSaysGone_returnsNotOpen", async () => {
    database([{ roles_json: '["OWNER"]', channel_id: "901" }]);
    jest.mocked(clearVoiceChannel).mockResolvedValue({ kind: "gone", code: "VOICE_CHANNEL_NOT_TRACKED" });

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("notOpen");
  });

  it("clearOwnTeamVoiceChannel_botRefuses_returnsUnavailableWithCodeOnlyLog", async () => {
    database([{ roles_json: '["OWNER"]', channel_id: "901" }]);
    jest.mocked(clearVoiceChannel).mockResolvedValue({ kind: "unavailable", code: "VOICE_DISCORD_UNAVAILABLE" });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("unavailable");
    expect(warn).toHaveBeenCalledWith("[match-voice] match 9 : vidage du salon vocal refusé (VOICE_DISCORD_UNAVAILABLE)");
    warn.mockRestore();
  });

  it("teamClearableChannelSql_membershipOfThatTeamOnly_neverSoloEntry", () => {
    expect(TEAM_CLEARABLE_CHANNEL_SQL).toContain("tm.user_id = ? AND tm.team_id = ? AND tm.left_at IS NULL");
    expect(TEAM_CLEARABLE_CHANNEL_SQL).toContain("tt.solo_user_id IS NULL");
    expect(TEAM_CLEARABLE_CHANNEL_SQL).toContain("v.team_id = tm.team_id");
  });

  it("teamClearableChannelSql_sameWindowAsReferees", () => {
    expect(TEAM_CLEARABLE_CHANNEL_SQL).toContain("t.state = 'RUNNING' AND t.team_voice_channels = 1 AND t.start_visibility_at <= NOW()");
    expect(TEAM_CLEARABLE_CHANNEL_SQL).toContain(`m.start_at <= NOW() + INTERVAL ${VOICE_CHANNEL_LEAD_MINUTES} MINUTE`);
    expect(TEAM_CLEARABLE_CHANNEL_SQL).toContain(`m.start_at >= NOW() - INTERVAL ${VOICE_CHANNEL_LATE_HOURS} HOUR`);
    expect(TEAM_CLEARABLE_CHANNEL_SQL).toContain("v.team_id IN (m.team1_id, m.team2_id)");
  });
});
