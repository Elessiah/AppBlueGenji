import { describe, expect, it } from "@jest/globals";
import { mapScoreReport, reportInstant } from "@/lib/server/tournaments/_internal";

describe("reportInstant (MAP_SCORES.md)", () => {
  it("reportInstant_null_returnsEmptyString", () => {
    expect(reportInstant(null)).toBe("");
    expect(reportInstant(undefined)).toBe("");
  });

  it("reportInstant_date_returnsIso", () => {
    expect(reportInstant(new Date("2026-10-05T20:00:00.000Z"))).toBe("2026-10-05T20:00:00.000Z");
  });

  it("mapScoreReport_sameInstantAsGuards", () => {
    // La modale renvoie l'instant sérialisé ; les gardes le comparent sous la même forme.
    expect(mapScoreReport(3, 1, null, 1)?.reportedAt).toBe(reportInstant(null));
  });
});
