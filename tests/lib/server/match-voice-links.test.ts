import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/transaction");
jest.mock("@/lib/server/tournaments/match-launch");
jest.mock("@/lib/server/tournaments/registration");

import { getDatabase } from "@/lib/server/database";
import { loadViewerVoiceLinks } from "@/lib/server/tournaments/match-voice";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";

/**
 * Lecture des liens du salon de **l'équipe du lecteur** (`loadViewerVoiceLinks`,
 * `docs/features/MATCH_VOICE.md` § Lien du salon) : jamais celui de l'adversaire.
 */

const GUILD = "676735851119640577";
const bothOpen = { team1State: "OPEN" as const, team2State: "OPEN" as const };

function database(execute: jest.Mock<SqlQuery>) {
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("loadViewerVoiceLinks", () => {
  it("loadViewerVoiceLinks_viewerTeam_readsOnlyItsOwnChannels", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ match_id: 42, channel_id: "1300000000000000001", guild_id: GUILD }], []]);
    database(execute);

    const links = await loadViewerVoiceLinks(
      [
        { id: 42, team1Id: 10, team2Id: 20, voice: bothOpen },
        { id: 43, team1Id: 20, team2Id: 30, voice: bothOpen },
      ],
      10,
    );

    expect(links).toEqual([{ matchId: 42, url: `https://discord.com/channels/${GUILD}/1300000000000000001` }]);
    const [sql, params] = execute.mock.calls[0];
    // Filtré sur l'équipe du lecteur, et seulement les matchs où elle joue.
    expect(sql).toContain("WHERE team_id = ?");
    expect(params).toEqual([10, 42]);
  });

  it("loadViewerVoiceLinks_invalidStoredIds_skipsRow", async () => {
    database(jest.fn<SqlQuery>().mockResolvedValue([[{ match_id: 42, channel_id: "abc", guild_id: GUILD }], []]));

    await expect(loadViewerVoiceLinks([{ id: 42, team1Id: 10, team2Id: 20, voice: bothOpen }], 10)).resolves.toEqual([]);
  });

  it("loadViewerVoiceLinks_noOwnChannelOpen_noRead", async () => {
    const execute = jest.fn<SqlQuery>();
    database(execute);
    const waiting = { team1State: "WAITING" as const, team2State: "OPEN" as const };

    await expect(loadViewerVoiceLinks([{ id: 42, team1Id: 10, team2Id: 20, voice: waiting }], 10)).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("loadViewerVoiceLinks_noTeam_noRead", async () => {
    const execute = jest.fn<SqlQuery>();
    database(execute);

    await expect(loadViewerVoiceLinks([{ id: 42, team1Id: 10, team2Id: 20, voice: bothOpen }], null)).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("loadViewerVoiceLinks_missingTable_empty", async () => {
    database(jest.fn<SqlQuery>().mockRejectedValue(Object.assign(new Error("absent"), { code: "ER_NO_SUCH_TABLE" })));

    await expect(loadViewerVoiceLinks([{ id: 42, team1Id: 10, team2Id: 20, voice: bothOpen }], 10)).resolves.toEqual([]);
  });
});
