import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/teams/roster");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/transaction");
jest.mock("@/lib/server/tournaments/registration");

import { getDatabase } from "@/lib/server/database";
import { clearVoiceChannel } from "@/lib/server/bot-integration";
import { getUserActiveTeam } from "@/lib/server/teams/roster";
import {
  CLEARABLE_CHANNEL_SQL,
  clearOwnTeamVoiceChannel,
  resetVoiceSweepForTests,
} from "@/lib/server/tournaments/match-voice";
import type { TeamRole } from "@/lib/shared/types";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";

// Vidage du salon de sa propre équipe (décision D36, `docs/features/MATCH_VOICE.md`) :
// OWNER, MANAGER ou CAPITAINE de son équipe active, pour le salon de cette équipe seulement.

/** Base simulée : la seule lecture du vidage rend `rows` ; toute autre requête est notée. */
function database(rows: Record<string, unknown>[]) {
  const others: string[] = [];
  const execute = jest.fn<SqlQuery>(async (sql) => {
    if (sql === CLEARABLE_CHANNEL_SQL) return [rows, []];
    others.push(sql);
    return [[], []];
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return { execute, others };
}

function activeTeam(teamId: number, roles: TeamRole[]) {
  jest.mocked(getUserActiveTeam).mockResolvedValue({ teamId, teamName: "Les Bleus", roles });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetVoiceSweepForTests();
});

describe("clearOwnTeamVoiceChannel", () => {
  it("clearOwnTeamVoiceChannel_ownerOfTeamWithOpenChannel_returnsClearedAndCallsBot", async () => {
    activeTeam(4, ["OWNER"]);
    const db = database([{ channel_id: "901", plays: 1, designated: 0 }]);
    jest.mocked(clearVoiceChannel).mockResolvedValue({ kind: "ok", value: true });

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("cleared");
    expect(clearVoiceChannel).toHaveBeenCalledWith("901");
    expect(getUserActiveTeam).toHaveBeenCalledWith(77);
    expect(db.execute.mock.calls[0][1]).toEqual([77, 77, 77, 9, 4]);
  });

  it("clearOwnTeamVoiceChannel_captainOfTeam_returnsCleared", async () => {
    activeTeam(4, ["CAPITAINE", "DPS"]);
    database([{ channel_id: "901", plays: 1, designated: 0 }]);
    jest.mocked(clearVoiceChannel).mockResolvedValue({ kind: "ok", value: true });

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("cleared");
  });

  it("clearOwnTeamVoiceChannel_managerOfTeam_returnsCleared", async () => {
    activeTeam(4, ["MANAGER"]);
    database([{ channel_id: "901", plays: 1, designated: 0 }]);
    jest.mocked(clearVoiceChannel).mockResolvedValue({ kind: "ok", value: true });

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("cleared");
  });

  it("clearOwnTeamVoiceChannel_noActiveTeam_returnsNotLeaderWithoutReadingChannel", async () => {
    jest.mocked(getUserActiveTeam).mockResolvedValue(null);
    const db = database([{ channel_id: "901" }]);

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("notLeader");
    expect(db.execute).not.toHaveBeenCalled();
    expect(clearVoiceChannel).not.toHaveBeenCalled();
  });

  it("clearOwnTeamVoiceChannel_memberWithoutLeadRole_returnsNotLeader", async () => {
    activeTeam(4, ["TANK", "COACH"]);
    const db = database([{ channel_id: "901" }]);

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("notLeader");
    expect(db.execute).not.toHaveBeenCalled();
    expect(clearVoiceChannel).not.toHaveBeenCalled();
  });

  it("clearOwnTeamVoiceChannel_leaderOfOpposingTeam_returnsNotLeader", async () => {
    activeTeam(5, ["OWNER"]);
    const db = database([{ channel_id: "901" }]);

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("notLeader");
    expect(db.execute).not.toHaveBeenCalled();
    expect(clearVoiceChannel).not.toHaveBeenCalled();
  });

  it("clearOwnTeamVoiceChannel_noOpenChannel_returnsNotOpen", async () => {
    activeTeam(4, ["OWNER"]);
    database([]);

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("notOpen");
    expect(clearVoiceChannel).not.toHaveBeenCalled();
  });

  it("clearOwnTeamVoiceChannel_botSaysGone_returnsNotOpen", async () => {
    activeTeam(4, ["OWNER"]);
    database([{ channel_id: "901", plays: 1, designated: 0 }]);
    jest.mocked(clearVoiceChannel).mockResolvedValue({ kind: "gone", code: "VOICE_CHANNEL_NOT_TRACKED" });

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("notOpen");
  });

  it("clearOwnTeamVoiceChannel_botRefuses_returnsUnavailableWithCodeOnlyLog", async () => {
    activeTeam(4, ["OWNER"]);
    database([{ channel_id: "901", plays: 1, designated: 0 }]);
    jest.mocked(clearVoiceChannel).mockResolvedValue({ kind: "unavailable", code: "VOICE_DISCORD_UNAVAILABLE" });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(clearOwnTeamVoiceChannel(9, 4, 77)).resolves.toBe("unavailable");
    expect(warn).toHaveBeenCalledWith("[match-voice] match 9 : vidage du salon vocal refusé (VOICE_DISCORD_UNAVAILABLE)");
    warn.mockRestore();
  });
});
