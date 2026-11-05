import { describe, expect, it } from "@jest/globals";
import { refereeHostedFirstBanTeamId } from "@/lib/shared/match-referee";
import { EMPTY_MAP_RULES, applyMapRules } from "@/lib/shared/round-maps";
import { bracketMatch } from "../../helpers/bracket-match";

/**
 * Premier ban d'un match dont l'arbitre désigné crée la partie
 * (`docs/features/MATCH_REFEREE.md`) : la non-tête de série bannit la
 * première, quelle que soit la règle du tournoi.
 */
describe("refereeHostedFirstBanTeamId", () => {
  it("refereeHostedFirstBanTeamId_team2BetterSeed_team1BansFirst", () => {
    expect(refereeHostedFirstBanTeamId(10, 20, { team1: 4, team2: 1 })).toBe(10);
  });

  it("refereeHostedFirstBanTeamId_team1BetterSeed_team2BansFirst", () => {
    expect(refereeHostedFirstBanTeamId(10, 20, { team1: 1, team2: 4 })).toBe(20);
  });

  it("refereeHostedFirstBanTeamId_noSeeds_team2BansFirst", () => {
    expect(refereeHostedFirstBanTeamId(10, 20)).toBe(20);
  });

  it("refereeHostedFirstBanTeamId_missingOpponent_null", () => {
    expect(refereeHostedFirstBanTeamId(10, null, { team1: 4, team2: null })).toBeNull();
  });
});

describe("applyMapRules — match arbitré", () => {
  it("applyMapRules_refereeAssigned_keepsFirstBanDespiteHostRule", () => {
    const match = bracketMatch({ team1Id: 10, team2Id: 20, hostTeamId: 10, firstBanTeamId: 20, refereeAssigned: true });

    const [out] = applyMapRules([match], { ...EMPTY_MAP_RULES, firstBan: "HOST" });

    expect(out.firstBanTeamId).toBe(20);
  });

  it("applyMapRules_selfManaged_followsHostRule", () => {
    const match = bracketMatch({ team1Id: 10, team2Id: 20, hostTeamId: 10, firstBanTeamId: 20, refereeAssigned: false });

    const [out] = applyMapRules([match], { ...EMPTY_MAP_RULES, firstBan: "HOST" });

    expect(out.firstBanTeamId).toBe(10);
  });
});
