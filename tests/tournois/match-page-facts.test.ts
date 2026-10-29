import { describe, expect, it } from "@jest/globals";
import { matchPageHeaderScore, matchPageMapFacts } from "@/app/(secured)/tournois/[id]/_lib/match-page-facts";
import { EMPTY_MAP_RULES, type TournamentMapRules } from "@/lib/shared/round-maps";
import { bracketMatch } from "../helpers/bracket-match";

// Faits de la page d'un match (`docs/features/MATCH_PAGE.md`) : score de
// l'en-tête rangé hôte à gauche, maps des faits clés.

// Caractères invisibles construits par leur point de code : jamais écrits tels quels dans la source.
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);

const HOST_RIGHT_SLOTS = [{ slot: 1 }, { slot: 2 }] as const;
const HOST_LEFT_SLOTS = [{ slot: 2 }, { slot: 1 }] as const;

const rules = (slots: string[][], overrides: Partial<TournamentMapRules> = {}): TournamentMapRules => ({
  ...EMPTY_MAP_RULES,
  rounds: [{ phaseId: 0, bracket: "UPPER", roundNumber: 2, slots }],
  ...overrides,
});

const roundTwo = (overrides: Parameters<typeof bracketMatch>[0] = {}) =>
  bracketMatch({ roundNumber: 2, bracket: "UPPER", team1Id: 10, team2Id: 20, ...overrides });

describe("matchPageHeaderScore", () => {
  it("matchPageHeaderScore_noScoreYet_returnsNull", () => {
    const actual = matchPageHeaderScore(roundTwo(), HOST_RIGHT_SLOTS, false);

    expect(actual).toBeNull();
  });

  it("matchPageHeaderScore_hostIsTeam2_ordersScoresHostFirst", () => {
    const actual = matchPageHeaderScore(roundTwo({ team1Score: 1, team2Score: 3 }), HOST_LEFT_SLOTS, false);

    expect(actual).toEqual({ left: "3", right: "1" });
  });

  it("matchPageHeaderScore_forfeit_showsFFOnForfeitingSide", () => {
    const actual = matchPageHeaderScore(
      roundTwo({ status: "COMPLETED", forfeitTeamId: 10, winnerTeamId: 20 }),
      HOST_RIGHT_SLOTS,
      false,
    );

    expect(actual?.left).toBe("FF");
  });
});

describe("matchPageMapFacts", () => {
  it("matchPageMapFacts_noRoundSettings_returnsEmpty", () => {
    const actual = matchPageMapFacts(EMPTY_MAP_RULES, roundTwo());

    expect(actual).toEqual([]);
  });

  it("matchPageMapFacts_fixedAndPickedSlots_mapKnownWithoutCandidates", () => {
    const actual = matchPageMapFacts(
      rules([["Ilios"], ["Busan", "Nepal"]], { nextPick: "LOSER" }),
      roundTwo({ mapPicks: { "2": "Nepal" } }),
    );

    expect(actual).toEqual([
      { number: 1, map: "Ilios", imposed: true, candidates: [], loserPick: false },
      { number: 2, map: "Nepal", imposed: false, candidates: [], loserPick: false },
    ]);
  });

  it("matchPageMapFacts_unchosenPoolAfterMap1_loserRule_flagsLoserPick", () => {
    const actual = matchPageMapFacts(rules([["Ilios"], ["Busan", "Nepal"]], { nextPick: "LOSER" }), roundTwo());

    expect(actual[1]).toEqual({ number: 2, map: null, imposed: false, candidates: ["Busan", "Nepal"], loserPick: true });
  });

  it("matchPageMapFacts_unchosenPoolOnMap1_noLoserPick", () => {
    const actual = matchPageMapFacts(rules([["Ilios", "Nepal"]], { nextPick: "LOSER" }), roundTwo());

    expect(actual[0]).toEqual({ number: 1, map: null, imposed: false, candidates: ["Ilios", "Nepal"], loserPick: false });
  });

  it("matchPageMapFacts_pickWithInvisibleCharacters_showsVisibleTextOnly", () => {
    const actual = matchPageMapFacts(rules([["Ilios", "Nepal"]]), roundTwo({ firstMap: `${RIGHT_TO_LEFT_OVERRIDE}Nepal${ZERO_WIDTH_SPACE} ` }));

    expect(actual[0].map).toBe("Nepal");
  });

  it("matchPageMapFacts_pickOfInvisibleCharactersOnly_staysToChoose", () => {
    const actual = matchPageMapFacts(rules([["Ilios", "Nepal"]]), roundTwo({ firstMap: ZERO_WIDTH_SPACE }));

    expect(actual[0]).toEqual({ number: 1, map: null, imposed: false, candidates: ["Ilios", "Nepal"], loserPick: false });
  });

  it("matchPageMapFacts_nextPickNotLoser_noLoserPick", () => {
    const actual = matchPageMapFacts(rules([["Ilios"], ["Busan", "Nepal"]], { nextPick: "FREE" }), roundTwo());

    expect(actual[1].loserPick).toBe(false);
  });
});
