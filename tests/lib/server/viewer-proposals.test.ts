import { describe, expect, it, jest } from "@jest/globals";
import { loadViewerProposals } from "@/lib/server/tournaments/match-maps";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";
import { bracketMatch } from "../../helpers/bracket-match";

const reportAt = "2026-10-05T20:00:00.000Z";
const pending = (id: number, team1Id: number, team2Id: number) =>
  bracketMatch({
    id,
    team1Id,
    team2Id,
    status: "AWAITING_CONFIRMATION",
    team1Report: { team1Score: 1, team2Score: 0, reportedAt: reportAt, maps: [] },
  });

function conn() {
  const execute = jest.fn<SqlQuery>().mockResolvedValue([
    [
      { match_id: 10, source: "TEAM1", map_number: 1, replay_code: "SECRET", team1_score: 2, team2_score: 0 },
      { match_id: 11, source: "TEAM1", map_number: 1, replay_code: "OTHER1", team1_score: 2, team2_score: 0 },
    ],
    [],
  ]);
  return { execute, connection: fakeConnection({ execute }) };
}

describe("propositions map par map — qui les lit (MAP_SCORES.md)", () => {
  const matches = [pending(10, 5, 6), pending(11, 7, 8)];

  it("l'engagé qui mène son match lit les propositions de son match, pas celles des autres", async () => {
    const { connection, execute } = conn();
    const proposals = await loadViewerProposals(connection, matches, { all: false, teamIds: [6] });
    expect(proposals.map((p) => p.matchId)).toEqual([10]);
    expect(proposals[0].team1).toEqual({
      reportedAt: reportAt,
      maps: [{ mapNumber: 1, replayCode: "SECRET", team1Score: 2, team2Score: 0 }],
    });
    expect(execute.mock.calls[0][1]).toEqual([10, "TEAM1", "TEAM2"]);
  });

  it("un spectateur, ou un membre sans qualité pour reporter, ne lit rien — et rien n'est lu en base", async () => {
    const { connection, execute } = conn();
    expect(await loadViewerProposals(connection, matches, { all: false, teamIds: [] })).toEqual([]);
    expect(await loadViewerProposals(connection, matches, { all: false, teamIds: [99] })).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("l'arbitrage lit toutes les propositions en attente", async () => {
    const { connection } = conn();
    const proposals = await loadViewerProposals(connection, matches, { all: true, teamIds: [] });
    expect(proposals.map((p) => p.matchId)).toEqual([10, 11]);
  });

  it("ignore un match tranché, et tait un détail qui n'explique pas son score", async () => {
    const { connection } = conn();
    const played = { ...pending(10, 5, 6), status: "COMPLETED" as const };
    expect(await loadViewerProposals(connection, [played], { all: true, teamIds: [] })).toEqual([]);

    const mismatch = {
      ...pending(10, 5, 6),
      team1Report: { team1Score: 0, team2Score: 1, reportedAt: reportAt, maps: [] },
    };
    const [entry] = await loadViewerProposals(connection, [mismatch], { all: true, teamIds: [] });
    expect(entry.team1?.maps).toEqual([]);
  });
});
