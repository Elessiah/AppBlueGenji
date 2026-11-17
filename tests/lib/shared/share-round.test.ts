import { describe, expect, it } from "@jest/globals";
import { messagesFor } from "@/lib/server/i18n-messages";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";
import { buildShareRounds, shareRoundPageText, shareRoundText, type ShareRound } from "@/lib/shared/share-round";
import type { BracketMatch, BracketType, TournamentCard, TournamentPhase } from "@/lib/shared/types";
import { bracketMatch } from "../../helpers/bracket-match";
import { tournamentCard } from "../../helpers/tournament-card";

/**
 * Nom de la manche d'un match partagé (`docs/features/SHARE_EMBEDS.md`) : celui
 * de la fiche du tournoi, par format et par tableau.
 */

const FR = shareRoundPageText("fr", messagesFor("fr"));
const EN = shareRoundPageText("en", messagesFor("en"));

let nextId = 1;
function match(bracket: BracketType, roundNumber: number, matchNumber = 1, phaseId = 0): BracketMatch {
  nextId += 1;
  return bracketMatch({ id: nextId, bracket, roundNumber, matchNumber, phaseId });
}

function roundsOf(
  card: Pick<TournamentCard, "format"> & Partial<Pick<TournamentCard, "state">>,
  matches: BracketMatch[],
  phases: TournamentPhase[] | null = null,
) {
  const rounds = buildShareRounds({ card: tournamentCard({ format: card.format, state: card.state ?? "RUNNING" }), phases, matches });
  return (m: BracketMatch): ShareRound | null => rounds.get(m.id) ?? null;
}

function textOf(m: BracketMatch, round: ShareRound | null, locale: "fr" | "en" = "fr"): string {
  return shareRoundText(locale === "fr" ? FR : EN, round, m);
}

describe("buildShareRounds / shareRoundText — simple élimination", () => {
  const r1 = [match("UPPER", 1, 1), match("UPPER", 1, 2), match("UPPER", 1, 3), match("UPPER", 1, 4)];
  const r2 = [match("UPPER", 2, 1), match("UPPER", 2, 2)];
  const r3 = match("UPPER", 3, 1);
  const all = [...r1, ...r2, r3];
  const roundOf = roundsOf({ format: "SINGLE" }, all);

  it("buildShareRounds_singleLastRound_isFinal", () => {
    expect(textOf(r3, roundOf(r3))).toBe("Finale");
    expect(textOf(r3, roundOf(r3), "en")).toBe("Final");
  });

  it("buildShareRounds_singleSemis_namedWithMatchNumber", () => {
    expect(textOf(r2[1], roundOf(r2[1]))).toBe("Demi-finale 2");
    expect(textOf(r2[0], roundOf(r2[0]), "en")).toBe("Semifinal 1");
  });

  it("buildShareRounds_singleQuarters_namedWithMatchNumber", () => {
    expect(textOf(r1[2], roundOf(r1[2]))).toBe("Quart de finale 3");
    expect(textOf(r1[0], roundOf(r1[0]), "en")).toBe("Quarterfinal 1");
  });

  it("buildShareRounds_roundOf16_named", () => {
    const sixteen = [match("UPPER", 1, 5), match("UPPER", 2, 1), match("UPPER", 3, 1), match("UPPER", 4, 1)];
    const of = roundsOf({ format: "SINGLE" }, sixteen);
    expect(textOf(sixteen[0], of(sixteen[0]))).toBe("8ème de finale 5");
  });

  it("buildShareRounds_earlyRound_keepsRoundAndMatchNumber", () => {
    const rounds = [match("UPPER", 1, 7), match("UPPER", 2, 1), match("UPPER", 3, 1), match("UPPER", 4, 1), match("UPPER", 5, 1)];
    const of = roundsOf({ format: "SINGLE" }, rounds);
    expect(textOf(rounds[0], of(rounds[0]))).toBe("Manche 1 · Match 7");
    expect(textOf(rounds[0], of(rounds[0]), "en")).toBe("Round 1 · Match 7");
  });

  it("buildShareRounds_thirdPlace_named", () => {
    const third = match("THIRD_PLACE", 3, 1);
    const of = roundsOf({ format: "SINGLE" }, [...all, third]);
    expect(textOf(third, of(third))).toBe("Petite finale");
    expect(textOf(r3, of(r3))).toBe("Finale");
  });
});

describe("buildShareRounds / shareRoundText — rang du tour", () => {
  it("buildShareRounds_lowerEarlyRound_numberedByRankInItsBracket", () => {
    const lower = [3, 4, 5, 6, 7, 8].map((round) => match("LOWER", round, 1));
    const of = roundsOf({ format: "DOUBLE" }, lower);
    expect(textOf(lower[1], of(lower[1]))).toBe("Tableau perdants · Manche 2 · Match 1");
    expect(textOf(lower[1], of(lower[1]), "en")).toBe("Lower bracket · Round 2 · Match 1");
  });
});

describe("buildShareRounds / shareRoundText — double élimination", () => {
  const upper = [match("UPPER", 1, 1), match("UPPER", 1, 2), match("UPPER", 2, 1)];
  const lower = [match("LOWER", 1, 1), match("LOWER", 2, 1), match("LOWER", 3, 1)];
  const grand = match("GRAND", 1, 1);
  const of = roundsOf({ format: "DOUBLE" }, [...upper, ...lower, grand]);

  it("buildShareRounds_doubleUpperFinal_isFinal", () => {
    expect(textOf(upper[2], of(upper[2]))).toBe("Finale");
  });

  it("buildShareRounds_doubleLowerFinal_isLowerFinalWithoutPrefix", () => {
    expect(textOf(lower[2], of(lower[2]))).toBe("Finale perdants");
    expect(textOf(lower[2], of(lower[2]), "en")).toBe("Lower bracket final");
  });

  it("buildShareRounds_doubleLowerSemis_prefixedByLowerBracket", () => {
    expect(textOf(lower[1], of(lower[1]))).toBe("Tableau perdants · Demi-finale 1");
    expect(textOf(lower[0], of(lower[0]), "en")).toBe("Lower bracket · Quarterfinal 1");
  });

  it("buildShareRounds_doubleGrandFinal_isGrandFinal", () => {
    expect(textOf(grand, of(grand))).toBe("Grande Finale");
    expect(textOf(grand, of(grand), "en")).toBe("Grand final");
  });
});

describe("buildShareRounds / shareRoundText — modes à classement", () => {
  it("buildShareRounds_swiss_rondeNumberAndMatch", () => {
    const m = match("UPPER", 3, 2);
    const round = roundsOf({ format: "SWISS" }, [m])(m);
    expect(textOf(m, round)).toBe("Ronde 3 · Match 2");
    expect(textOf(m, round, "en")).toBe("Round 3 · Match 2");
  });

  it("buildShareRounds_survival_mancheNumberAndMatch", () => {
    const m = match("UPPER", 4, 1);
    const round = roundsOf({ format: "SURVIVAL" }, [m])(m);
    expect(textOf(m, round)).toBe("Manche 4 · Match 1");
  });

  it("buildShareRounds_multiPhases_eachPhaseUsesItsOwnFormat", () => {
    const swissMatch = match("UPPER", 2, 1, 11);
    const singleFinal = match("UPPER", 1, 1, 12);
    const phases = [
      { id: 11, format: "SWISS" },
      { id: 12, format: "SINGLE" },
    ] as TournamentPhase[];
    const of = roundsOf({ format: "MULTI" }, [swissMatch, singleFinal], phases);
    expect(textOf(swissMatch, of(swissMatch))).toBe("Ronde 2 · Match 1");
    expect(textOf(singleFinal, of(singleFinal))).toBe("Finale");
  });

  it("buildShareRounds_multiPhases_bracketsOfDifferentPhasesCountedApart", () => {
    const a = [match("UPPER", 1, 1, 21), match("UPPER", 2, 1, 21)];
    const b = [match("UPPER", 1, 1, 22)];
    const phases = [
      { id: 21, format: "SINGLE" },
      { id: 22, format: "SINGLE" },
    ] as TournamentPhase[];
    const of = roundsOf({ format: "MULTI" }, [...a, ...b], phases);
    expect(textOf(a[0], of(a[0]))).toBe("Demi-finale 1");
    expect(textOf(b[0], of(b[0]))).toBe("Finale");
  });

  it("buildShareRounds_bgSurvieQualification_mancheNumber", () => {
    const m = match("UPPER", 5, 3);
    const round = roundsOf({ format: "BG_SURVIE" }, [m])(m);
    expect(textOf(m, round)).toBe("Manche 5 · Match 3");
  });

  it("buildShareRounds_bgSurviePlayoffs_namedFromPlannedRounds", () => {
    const quarters = [1, 2, 3, 4].map((n) => match("UPPER", PLAYOFF_ROUND_OFFSET, n));
    const third = match("THIRD_PLACE", PLAYOFF_ROUND_OFFSET + 2, 1);
    const of = roundsOf({ format: "BG_SURVIE" }, [...quarters, third]);
    expect(textOf(quarters[1], of(quarters[1]))).toBe("Quart de finale 2");
    expect(textOf(third, of(third))).toBe("Petite finale");
  });

  it("buildShareRounds_bgSurviePlayoffFinal_isGrandFinalLikeThePage", () => {
    // La fiche sous-titre la finale de l'arbre final « Grande Finale » (`grandFinalLabel`).
    const final = match("UPPER", PLAYOFF_ROUND_OFFSET + 2, 1);
    const earlier = [match("UPPER", PLAYOFF_ROUND_OFFSET, 1), match("UPPER", PLAYOFF_ROUND_OFFSET + 1, 1)];
    const of = roundsOf({ format: "BG_SURVIE" }, [...earlier, final]);
    expect(textOf(final, of(final))).toBe("Grande Finale");
    expect(textOf(final, of(final), "en")).toBe("Grand final");
  });

  it("buildShareRounds_bgSurvieFiveRoundTree_earlyRoundNumberedByRank", () => {
    // 32 qualifiées : seize rencontres au premier tour, un tour avant les huitièmes.
    const first = Array.from({ length: 16 }, (_, index) => match("UPPER", PLAYOFF_ROUND_OFFSET, index + 1));
    const of = roundsOf({ format: "BG_SURVIE" }, first);
    expect(textOf(first[2], of(first[2]))).toBe("Manche 1 · Match 3");
    expect(textOf(first[2], of(first[2]), "en")).toBe("Round 1 · Match 3");
  });

  it("buildShareRounds_bgSurvieRunningDoubleForfeitPair_countsRoundsLikeThePage", () => {
    // Les quarts 1 et 2 clos sur un double forfait : le tour suivant n'a qu'une
    // rencontre, qui est la finale — les quarts restants sont des demi-finales.
    const vacated = { status: "COMPLETED" as const, doubleForfeit: true };
    const quarters = [
      bracketMatch({ id: 501, roundNumber: PLAYOFF_ROUND_OFFSET, matchNumber: 1, ...vacated }),
      bracketMatch({ id: 502, roundNumber: PLAYOFF_ROUND_OFFSET, matchNumber: 2, ...vacated }),
      bracketMatch({ id: 503, roundNumber: PLAYOFF_ROUND_OFFSET, matchNumber: 3 }),
      bracketMatch({ id: 504, roundNumber: PLAYOFF_ROUND_OFFSET, matchNumber: 4 }),
    ];
    const of = roundsOf({ format: "BG_SURVIE", state: "RUNNING" }, quarters);
    expect(textOf(quarters[2], of(quarters[2]))).toBe("Demi-finale 3");
  });

  it("buildShareRounds_bgSurvieFinished_ignoresUnplayedRounds", () => {
    const quarters = [1, 2, 3, 4].map((n) => match("UPPER", PLAYOFF_ROUND_OFFSET, n));
    const of = roundsOf({ format: "BG_SURVIE", state: "FINISHED" }, quarters);
    expect(textOf(quarters[0], of(quarters[0]))).toBe("Quart de finale 1");
  });
});

describe("shareRoundText — mots de manche", () => {
  // La page d'un match n'a pas les textes des vues : les mots de `bracket.*`
  // doivent rester ceux que la vue suisse / survie affiche.
  const fr = messagesFor("fr");
  const en = messagesFor("en");

  it("bracketSwissRoundN_equalsSwissViewNoun_french", () => {
    expect(fr.tournament.bracket.swissRoundN).toBe(`${fr.tournamentViews.swiss.roundNoun} {number}`);
  });

  it("bracketSwissRoundN_equalsSwissViewNoun_english", () => {
    expect(en.tournament.bracket.swissRoundN).toBe(`${en.tournamentViews.swiss.roundNoun} {number}`);
  });

  it("bracketRoundN_equalsSurvivalViewNoun_french", () => {
    expect(fr.tournament.bracket.roundN).toBe(`${fr.tournamentViews.survival.roundNoun} {number}`);
  });

  it("bracketRoundN_equalsSurvivalViewNoun_english", () => {
    expect(en.tournament.bracket.roundN).toBe(`${en.tournamentViews.survival.roundNoun} {number}`);
  });
});

describe("shareRoundText — repli", () => {
  it("shareRoundText_unknownRound_fallsBackToRoundAndMatch", () => {
    const m = match("UPPER", 2, 3);
    expect(textOf(m, null)).toBe("Manche 2 · Match 3");
    expect(textOf(m, null, "en")).toBe("Round 2 · Match 3");
  });

  it("buildShareRounds_noMatches_isEmpty", () => {
    expect(buildShareRounds({ card: tournamentCard({ format: "SINGLE" }), phases: null, matches: [] }).size).toBe(0);
  });
});