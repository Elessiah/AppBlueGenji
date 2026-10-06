import { describe, expect, it } from "@jest/globals";
import { proposalsNeedRefresh, withProposalMaps, playerReportInitialMaps, playerReportView } from "@/lib/shared/player-score-report";
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

  it("rien à relire sur un match sans proposition", () => {
    const quiet = bracketMatch({ id: 10, team1Report: null, team2Report: null });
    expect(proposalsNeedRefresh(quiet, [])).toBe(false);
    expect(withProposalMaps(quiet, [])).toBe(quiet);
  });
});
