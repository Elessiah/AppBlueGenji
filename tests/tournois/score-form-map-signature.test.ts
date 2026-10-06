import { describe, expect, it } from "@jest/globals";
import {
  initialAdminMaps,
  pendingProposalSignature,
  storedResultSignature,
} from "@/app/(secured)/tournois/[id]/_lib/score-form";
import { bracketMatch } from "../helpers/bracket-match";

const map = (replayCode: string, team1Score: number, team2Score: number, mapNumber = 1) => ({
  mapNumber,
  replayCode,
  team1Score,
  team2Score,
});

describe("dialogue d'arbitrage — détail map par map (MAP_SCORES.md)", () => {
  it("un code corrigé à score égal change l'empreinte du résultat et des propositions", () => {
    const before = bracketMatch({ team1Score: 1, team2Score: 0, maps: [map("AAA111", 2, 0)] });
    const after = bracketMatch({ team1Score: 1, team2Score: 0, maps: [map("AAA112", 2, 0)] });
    expect(storedResultSignature(before)).not.toBe(storedResultSignature(after));

    const report = (code: string) => ({ team1Score: 1, team2Score: 0, reportedAt: "", maps: [map(code, 2, 0)] });
    expect(pendingProposalSignature(bracketMatch({ team1Report: report("AAA111") }))).not.toBe(
      pendingProposalSignature(bracketMatch({ team1Report: report("AAA112") })),
    );
  });

  it("garde l'empreinte d'avant sur un match sans maps", () => {
    const match = bracketMatch({ id: 5, team1Score: 2, team2Score: 1, status: "COMPLETED", winnerTeamId: 1 });
    expect(storedResultSignature(match)).toBe("5|2|1|∅|∅|1|COMPLETED");
  });

  it("s'ouvre sur le détail retenu, sinon sur celui de la proposition unique", () => {
    expect(initialAdminMaps(bracketMatch({ team1Score: 1, team2Score: 0, maps: [map("AAA111", 2, 0)] }))).toEqual([
      { replayCode: "AAA111", team1Score: 2, team2Score: 0 },
    ]);
    const proposed = bracketMatch({
      team1Id: 1,
      team2Id: 2,
      status: "AWAITING_CONFIRMATION",
      team2Report: { team1Score: 0, team2Score: 1, reportedAt: "", maps: [map("BBB222", 0, 3)] },
    });
    expect(initialAdminMaps(proposed)).toEqual([{ replayCode: "BBB222", team1Score: 0, team2Score: 3 }]);
    expect(initialAdminMaps(null)).toEqual([]);
  });
});
