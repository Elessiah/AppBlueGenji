import { describe, expect, it } from "@jest/globals";
import {
  mergeMatchProposals,
  parseMatchProposals,
  proposalsNeedRefresh,
  withProposalMaps,
  playerReportInitialMaps,
  playerReportView,
} from "@/lib/shared/player-score-report";
import type { MatchProposalMaps } from "@/lib/shared/types";
import { bracketMatch } from "../../helpers/bracket-match";

const at = "2026-10-05T20:00:00.000Z";
const map = { mapNumber: 1, replayCode: "AAA111", team1Score: 2, team2Score: 0 };
const match = bracketMatch({
  id: 10,
  team1Id: 1,
  team2Id: 2,
  status: "AWAITING_CONFIRMATION",
  team1Report: { team1Score: 1, team2Score: 0, reportedAt: at, maps: [] },
});

describe("propositions complétées par le contexte du lecteur (MAP_SCORES.md)", () => {
  it("pose le détail sur la proposition du même dépôt : l'adversaire s'ouvre dessus", () => {
    const proposals: MatchProposalMaps[] = [{ matchId: 10, team1: { reportedAt: at, maps: [map] }, team2: null }];
    const enriched = withProposalMaps(match, proposals);
    expect(enriched.team1Report?.maps).toEqual([map]);
    // Pré-remplissage : l'engagé 2 voit les maps de l'engagé 1, codes compris.
    expect(playerReportInitialMaps(playerReportView(enriched, 2))).toEqual([
      { replayCode: "AAA111", team1Score: 2, team2Score: 0 },
    ]);
    expect(proposalsNeedRefresh(match, proposals)).toBe(false);
  });

  it("ne pose pas un détail d'un autre dépôt, et demande une relecture", () => {
    const stale: MatchProposalMaps[] = [
      { matchId: 10, team1: { reportedAt: "2026-10-05T19:00:00.000Z", maps: [map] }, team2: null },
    ];
    expect(withProposalMaps(match, stale).team1Report?.maps).toEqual([]);
    expect(proposalsNeedRefresh(match, stale)).toBe(true);
    // Proposition déposée après la connexion : aucune entrée encore.
    expect(proposalsNeedRefresh(match, [])).toBe(true);
  });

  it("rien à relire sur un match clos, même s'il garde des propositions (forfait déclaré)", () => {
    const closed = { ...match, status: "COMPLETED" as const };
    expect(proposalsNeedRefresh(closed, [])).toBe(false);
  });

  it("rien à relire sur un match sans proposition", () => {
    const quiet = bracketMatch({ id: 10, team1Report: null, team2Report: null });
    expect(proposalsNeedRefresh(quiet, [])).toBe(false);
    expect(withProposalMaps(quiet, [])).toBe(quiet);
  });
});

// ERREUR.txt EF-15 : la relecture d'un seul match (`/matches/[matchId]/proposals`).
describe("parseMatchProposals", () => {
  const side = { reportedAt: at, maps: [map] };

  it("parseMatchProposals_validPayload_returnsProposals", () => {
    expect(parseMatchProposals({ matchId: 10, team1: side, team2: null }, 10)).toEqual({
      matchId: 10,
      team1: side,
      team2: null,
    });
  });

  it("parseMatchProposals_bothSidesNull_returnsEmptyProposals", () => {
    expect(parseMatchProposals({ matchId: 10, team1: null, team2: null }, 10)).toEqual({ matchId: 10, team1: null, team2: null });
  });

  it("parseMatchProposals_otherMatchId_returnsNull", () => {
    expect(parseMatchProposals({ matchId: 11, team1: side, team2: null }, 10)).toBeNull();
  });

  it("parseMatchProposals_nullPayload_returnsNull", () => {
    expect(parseMatchProposals(null, 10)).toBeNull();
  });

  it("parseMatchProposals_missingSide_returnsNull", () => {
    expect(parseMatchProposals({ matchId: 10, team1: side }, 10)).toBeNull();
  });

  it("parseMatchProposals_reportedAtNotString_returnsNull", () => {
    expect(parseMatchProposals({ matchId: 10, team1: { reportedAt: 5, maps: [] }, team2: null }, 10)).toBeNull();
  });

  it("parseMatchProposals_mapsNotArray_returnsNull", () => {
    expect(parseMatchProposals({ matchId: 10, team1: { reportedAt: at, maps: "x" }, team2: null }, 10)).toBeNull();
  });

  it("parseMatchProposals_mapNumberZero_returnsNull", () => {
    const bad = { reportedAt: at, maps: [{ ...map, mapNumber: 0 }] };
    expect(parseMatchProposals({ matchId: 10, team1: bad, team2: null }, 10)).toBeNull();
  });

  it("parseMatchProposals_mapNumberOne_isAccepted", () => {
    expect(parseMatchProposals({ matchId: 10, team1: side, team2: null }, 10)?.team1?.maps[0].mapNumber).toBe(1);
  });

  it("parseMatchProposals_scoreNotNumber_returnsNull", () => {
    const bad = { reportedAt: at, maps: [{ ...map, team2Score: "0" }] };
    expect(parseMatchProposals({ matchId: 10, team1: bad, team2: null }, 10)).toBeNull();
  });

  it("parseMatchProposals_replayCodeNotString_returnsNull", () => {
    const bad = { reportedAt: at, maps: [{ ...map, replayCode: null }] };
    expect(parseMatchProposals({ matchId: 10, team1: bad, team2: null }, 10)).toBeNull();
  });
});

describe("mergeMatchProposals", () => {
  const fresh: MatchProposalMaps = { matchId: 10, team1: { reportedAt: at, maps: [map] }, team2: null };
  const other: MatchProposalMaps = { matchId: 12, team1: null, team2: null };

  it("mergeMatchProposals_nothingFetched_returnsContextAsIs", () => {
    const proposals = [other];
    expect(mergeMatchProposals(match, proposals, null)).toBe(proposals);
  });

  it("mergeMatchProposals_fetchedForAnotherMatch_returnsContextAsIs", () => {
    const proposals = [other];
    expect(mergeMatchProposals(match, proposals, { ...fresh, matchId: 12 })).toBe(proposals);
  });

  it("mergeMatchProposals_fetchedDescribesDisplayedReport_addsEntry", () => {
    const merged = mergeMatchProposals(match, [other], fresh);
    expect(merged).toEqual([other, fresh]);
    expect(proposalsNeedRefresh(match, merged)).toBe(false);
  });

  it("mergeMatchProposals_fetchedReplacesStaleContextSide", () => {
    const stale: MatchProposalMaps = { matchId: 10, team1: { reportedAt: "2026-10-05T19:00:00.000Z", maps: [] }, team2: null };
    expect(mergeMatchProposals(match, [stale], fresh)).toEqual([fresh]);
  });

  it("mergeMatchProposals_lateFetchedOlderThanReport_keepsContext", () => {
    const current: MatchProposalMaps = { matchId: 10, team1: { reportedAt: at, maps: [map] }, team2: null };
    const late: MatchProposalMaps = { matchId: 10, team1: { reportedAt: "2026-10-05T19:00:00.000Z", maps: [] }, team2: null };
    const proposals = [current];
    expect(mergeMatchProposals(match, proposals, late)).toBe(proposals);
  });

  it("mergeMatchProposals_fetchedEqualsContext_returnsContextAsIs", () => {
    const proposals = [fresh];
    expect(mergeMatchProposals(match, proposals, fresh)).toBe(proposals);
  });
});
