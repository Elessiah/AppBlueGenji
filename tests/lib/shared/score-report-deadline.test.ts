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
  it("compte les maps décisives que le report affirme avoir jouées", () => {
    expect(plausibleSeriesMinutes(3, 0, FT3)).toBe(3 * MIN_MINUTES_PER_REPORTED_MAP);
    expect(plausibleSeriesMinutes(3, 2, FT3)).toBe(5 * MIN_MINUTES_PER_REPORTED_MAP);
  });

  it("prête au moins une map à un nul blanc : une rencontre a eu lieu", () => {
    expect(plausibleSeriesMinutes(0, 0, null)).toBe(MIN_MINUTES_PER_REPORTED_MAP);
  });

  it("ignore les fractions", () => {
    expect(plausibleSeriesMinutes(2.9, 1.2, FT3)).toBe(3 * MIN_MINUTES_PER_REPORTED_MAP);
  });

  it("borne la série au plafond de maps du format", () => {
    expect(plausibleSeriesMapCap(BO3)).toBe(matchMaxMaps(BO3));
    expect(plausibleSeriesMinutes(9, 9, BO3)).toBe(matchMaxMaps(BO3) * MIN_MINUTES_PER_REPORTED_MAP);
  });

  it("borne un score libre au format par défaut du site : « 99-98 » ne repousse rien de deux jours", () => {
    expect(plausibleSeriesMapCap(null)).toBe(matchMaxMaps(DEFAULT_MATCH_FORMAT));
    expect(plausibleSeriesMinutes(99, 98, null)).toBe(
      matchMaxMaps(DEFAULT_MATCH_FORMAT) * MIN_MINUTES_PER_REPORTED_MAP,
    );
  });
});

describe("scoreReportDeadline", () => {
  it("un 3-0 déclaré dès le lancement ne fait pas foi avant la série plus le délai", () => {
    const deadline = scoreReportDeadline({
      now: LAUNCH + MINUTE,
      launchedAt: LAUNCH,
      myScore: 3,
      opponentScore: 0,
      format: FT3,
    });
    expect(deadline).toBe(
      LAUNCH + (3 * MIN_MINUTES_PER_REPORTED_MAP + SCORE_REPORT_TIMEOUT_MINUTES) * MINUTE,
    );
  });

  it("une série déjà jouée garde le délai ordinaire depuis le report", () => {
    const now = LAUNCH + 90 * MINUTE;
    const deadline = scoreReportDeadline({ now, launchedAt: LAUNCH, myScore: 3, opponentScore: 1, format: FT3 });
    expect(deadline).toBe(now + SCORE_REPORT_TIMEOUT_MINUTES * MINUTE);
  });

  it("sans lancement connu, la série court depuis le report", () => {
    const now = LAUNCH;
    const deadline = scoreReportDeadline({ now, launchedAt: null, myScore: 2, opponentScore: 0, format: BO3 });
    expect(deadline).toBe(
      now + (2 * MIN_MINUTES_PER_REPORTED_MAP + SCORE_REPORT_TIMEOUT_MINUTES) * MINUTE,
    );
  });

  it("n'est jamais antérieure au délai ordinaire", () => {
    for (const offset of [0, 10, 30, 60, 240]) {
      const now = LAUNCH + offset * MINUTE;
      const deadline = scoreReportDeadline({ now, launchedAt: LAUNCH, myScore: 3, opponentScore: 2, format: FT3 });
      expect(deadline).toBeGreaterThanOrEqual(now + SCORE_REPORT_TIMEOUT_MINUTES * MINUTE);
    }
  });
});
