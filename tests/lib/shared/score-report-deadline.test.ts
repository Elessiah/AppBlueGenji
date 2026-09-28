import { describe, expect, it } from "@jest/globals";
import { SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";
import { DEFAULT_MATCH_FORMAT, matchMaxMaps, type MatchFormat } from "@/lib/shared/match-format";
import {
  MIN_MINUTES_PER_REPORTED_MAP,
  plausibleSeriesMapCap,
  plausibleSeriesMinutes,
  scoreReportDeadline,
} from "@/lib/shared/score-report-deadline";

/**
 * Échéance d'un report **unilatéral** : il ne fait foi qu'après une fin de série
 * plausible, comptée depuis le lancement. Sans elle, un « 3-0 pour nous »
 * déclaré à la seconde du lancement l'emportait dix minutes plus tard, pendant
 * que l'adversaire jouait encore sa série.
 */

const MINUTE = 60_000;
const LAUNCH = Date.UTC(2026, 8, 29, 20, 0, 0);
const FT3: MatchFormat = { type: "FT", value: 3 };
const BO3: MatchFormat = { type: "BO", value: 3 };

describe("plausibleSeriesMinutes", () => {
  it("prête à la série le plafond de maps de son format", () => {
    expect(plausibleSeriesMapCap(FT3)).toBe(matchMaxMaps(FT3));
    expect(plausibleSeriesMinutes(FT3)).toBe(matchMaxMaps(FT3) * MIN_MINUTES_PER_REPORTED_MAP);
    expect(plausibleSeriesMinutes(BO3)).toBe(matchMaxMaps(BO3) * MIN_MINUTES_PER_REPORTED_MAP);
  });

  it("suit un plafond abaissé (égalités permises)", () => {
    const capped: MatchFormat = { type: "FT", value: 3, maxMaps: 4, drawsAllowed: true };
    expect(plausibleSeriesMinutes(capped)).toBe(4 * MIN_MINUTES_PER_REPORTED_MAP);
  });

  it("borne un score libre au format par défaut du site", () => {
    expect(plausibleSeriesMapCap(null)).toBe(matchMaxMaps(DEFAULT_MATCH_FORMAT));
    expect(plausibleSeriesMinutes(null)).toBe(
      matchMaxMaps(DEFAULT_MATCH_FORMAT) * MIN_MINUTES_PER_REPORTED_MAP,
    );
  });
});

describe("scoreReportDeadline", () => {
  it("un report posé dès le lancement ne fait pas foi avant la série plus le délai", () => {
    const deadline = scoreReportDeadline({ now: LAUNCH + MINUTE, launchedAt: LAUNCH, format: FT3 });
    expect(deadline).toBe(
      LAUNCH + (plausibleSeriesMinutes(FT3) + SCORE_REPORT_TIMEOUT_MINUTES) * MINUTE,
    );
  });

  it("une série déjà jouée garde le délai ordinaire depuis le report", () => {
    const now = LAUNCH + 240 * MINUTE;
    const deadline = scoreReportDeadline({ now, launchedAt: LAUNCH, format: FT3 });
    expect(deadline).toBe(now + SCORE_REPORT_TIMEOUT_MINUTES * MINUTE);
  });

  it("sans lancement connu, la série court depuis le report", () => {
    const now = LAUNCH;
    const deadline = scoreReportDeadline({ now, launchedAt: null, format: BO3 });
    expect(deadline).toBe(now + (plausibleSeriesMinutes(BO3) + SCORE_REPORT_TIMEOUT_MINUTES) * MINUTE);
  });

  it("n'est jamais antérieure au délai ordinaire", () => {
    for (const offset of [0, 10, 30, 60, 240]) {
      const now = LAUNCH + offset * MINUTE;
      const deadline = scoreReportDeadline({ now, launchedAt: LAUNCH, format: FT3 });
      expect(deadline).toBeGreaterThanOrEqual(now + SCORE_REPORT_TIMEOUT_MINUTES * MINUTE);
    }
  });
});
