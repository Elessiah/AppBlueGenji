import { describe, expect, it } from "@jest/globals";
import { messagesFor } from "@/lib/server/i18n-messages";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";
import { stageMatchLabel, stageRoundLabel } from "@/lib/shared/bracket-stage-text";
import { shareRoundPageText, shareRoundText } from "@/lib/shared/share-round";
import { fallbackRoundLabel, matchPositionText } from "@/lib/shared/tournament-page-text";
import {
  MATCH_SUBTITLE_GAP,
  MATCH_SUBTITLE_MAX_WIDTH,
  MATCH_TITLE_MIN_WIDTH,
} from "@/components/og/match-share-card";
import { SHARE_CARD_PADDING, SHARE_CARD_SIZE } from "@/components/og/share-card";

/**
 * Libellés de stade communs à l'arbre de la fiche et au nom du tour d'un match
 * (`docs/features/SHARE_EMBEDS.md`), et repli sans résumé public.
 */

const FR = shareRoundPageText("fr", messagesFor("fr"));
const EN = shareRoundPageText("en", messagesFor("en"));

describe("stageRoundLabel", () => {
  it("stageRoundLabel_early_returnsRoundRankPlusOne", () => {
    expect(stageRoundLabel(FR, "early", 1)).toBe("Manche 2");
    expect(stageRoundLabel(EN, "early", 1)).toBe("Round 2");
  });

  it("stageRoundLabel_namedStage_returnsStageWord", () => {
    expect(stageRoundLabel(FR, "quarters", 5)).toBe("Quarts de finale");
    expect(stageRoundLabel(FR, "thirdPlace", 0)).toBe("Petite finale");
    expect(stageRoundLabel(EN, "thirdPlace", 0)).toBe("Third-place match");
  });
});

describe("stageMatchLabel", () => {
  it("stageMatchLabel_numberedStage_includesMatchNumber", () => {
    expect(stageMatchLabel(FR, "semis", 2)).toBe("Demi-finale 2");
    expect(stageMatchLabel(EN, "semis", 2)).toBe("Semifinal 2");
    expect(stageMatchLabel(FR, "lowerFinal", 1)).toBe("Finale perdants 1");
  });
});

describe("fallbackRoundLabel / matchPositionText", () => {
  it("fallbackRoundLabel_qualificationRound_returnsMancheN", () => {
    expect(fallbackRoundLabel(FR, 3)).toBe("Manche 3");
  });

  it("fallbackRoundLabel_offsetMinusOne_returnsMancheN", () => {
    expect(fallbackRoundLabel(FR, PLAYOFF_ROUND_OFFSET - 1)).toBe(`Manche ${PLAYOFF_ROUND_OFFSET - 1}`);
  });

  it("fallbackRoundLabel_playoffOffset_returnsFinalPhase", () => {
    expect(fallbackRoundLabel(FR, PLAYOFF_ROUND_OFFSET)).toBe("Phase finale");
    expect(fallbackRoundLabel(EN, PLAYOFF_ROUND_OFFSET)).toBe("Final phase");
  });

  it("matchPositionText_playoffRound_neverShowsRawNumber", () => {
    const text = matchPositionText(FR, { bracket: "UPPER", roundNumber: PLAYOFF_ROUND_OFFSET + 1, matchNumber: 1 });
    expect(text).toBe("Phase finale · Match 1");
  });

  it("matchPositionText_lowerBracket_keepsPrefix", () => {
    expect(matchPositionText(FR, { bracket: "LOWER", roundNumber: 2, matchNumber: 1 })).toBe(
      "Tableau perdants · Manche 2 · Match 1",
    );
  });
});

describe("shareRoundText — repli", () => {
  it("shareRoundText_nullPlayoffRound_returnsFinalPhase", () => {
    expect(shareRoundText(FR, null, { roundNumber: PLAYOFF_ROUND_OFFSET, matchNumber: 1 })).toBe("Phase finale · Match 1");
  });
});

describe("MatchShareCard — largeur du sous-titre", () => {
  it("matchShareCard_subtitleMaxWidth_leavesTitleMinimum", () => {
    const inner = SHARE_CARD_SIZE.width - SHARE_CARD_PADDING.left - SHARE_CARD_PADDING.right;
    expect(inner - MATCH_SUBTITLE_MAX_WIDTH - MATCH_SUBTITLE_GAP).toBeGreaterThanOrEqual(MATCH_TITLE_MIN_WIDTH);
  });
});
