import { describe, it, expect } from "@jest/globals";
import { tournamentsPageMetrics } from "@/app/(secured)/tournois/_lib/metrics";

describe("tournamentsPageMetrics", () => {
  const counts = { running: 3, registration: 5, upcoming: 2, hidden: 4 };

  it("returns three metrics for a non-staff viewer, without a fabricated case", () => {
    const result = tournamentsPageMetrics(counts, false);
    expect(result).toHaveLength(3);
    expect(result.map((m) => m.label)).toEqual([
      "Tournois en cours",
      "Inscriptions ouvertes",
      "Programmés à venir",
    ]);
    expect(result.some((m) => m.label.includes("Prizepool"))).toBe(false);
  });

  it("adds the hidden-tournaments count only for staff", () => {
    const result = tournamentsPageMetrics(counts, true);
    expect(result).toHaveLength(4);
    expect(result[3]).toEqual({ value: 4, label: "Invisibles · staff" });
  });

  it("only highlights the running-tournaments metric", () => {
    const result = tournamentsPageMetrics(counts, true);
    expect(result[0].highlighted).toBe(true);
    expect(result.slice(1).every((m) => !m.highlighted)).toBe(true);
  });

  it("counts running tournaments without claiming a stream count", () => {
    const [running] = tournamentsPageMetrics(counts, false);
    expect(running.value).toBe(3);
    expect(running.label.toLowerCase()).not.toContain("twitch");
    expect(running.label.toLowerCase()).not.toContain("diffus");
  });
});
