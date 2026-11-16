import { describe, expect, it } from "@jest/globals";
import { chartAriaLabel } from "@/app/frequentation/AudienceChart";

const TEMPLATE = "{series} : total {total}, minimum {min}, maximum {max}, sur {count} points.";

describe("chartAriaLabel", () => {
  it("chartAriaLabel_twoSeries_listsTitleSummariesAndTableHint", () => {
    const label = chartAriaLabel(
      "Évolution",
      [
        { label: "Visiteurs", data: [3, 1, 5], tone: "--st-series-1" },
        { label: "Pages vues", data: [10, 20], tone: "--st-series-2" },
      ],
      TEMPLATE,
      "Détail dans le tableau.",
      (value) => `#${value}`,
    );

    expect(label).toBe(
      "Évolution Visiteurs : total #9, minimum #1, maximum #5, sur 3 points. Pages vues : total #30, minimum #10, maximum #20, sur 2 points. Détail dans le tableau.",
    );
  });

  it("chartAriaLabel_emptyData_usesZeros", () => {
    const label = chartAriaLabel("T", [{ label: "S", data: [], tone: "--st-series-1" }], TEMPLATE, "Voir.", String);

    expect(label).toBe("T S : total 0, minimum 0, maximum 0, sur 0 points. Voir.");
  });
});
