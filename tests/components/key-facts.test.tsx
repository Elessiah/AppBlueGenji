import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { KeyFacts } from "@/components/cyber/KeyFacts";

// Grille de faits clés partagée par les pages de règles et la page d'un match.

describe("KeyFacts", () => {
  it("KeyFacts_noFacts_rendersNothing", () => {
    const html = renderToStaticMarkup(<KeyFacts facts={[]} />);

    expect(html).toBe("");
  });

  it("KeyFacts_facts_rendersLabelledTermsAndValuesWithDetailAndWide", () => {
    const html = renderToStaticMarkup(
      <KeyFacts
        label="Faits clés du match"
        facts={[
          { id: "host", label: "Hôte", value: "Alpha", detail: "Crée la partie" },
          { id: "maps", label: "Maps", value: "Map 1 : Ilios", wide: true },
        ]}
      />,
    );

    expect(html).toContain('<dl class="facts" aria-label="Faits clés du match">');
    expect(html).toContain('data-fact="host"><dt class="label">Hôte</dt><dd class="value">Alpha<span class="detail">Crée la partie</span></dd>');
    expect(html).toContain('data-fact="maps" data-wide=""><dt class="label">Maps</dt><dd class="value">Map 1 : Ilios</dd>');
  });

  it("KeyFacts_factWithoutDetail_notWide_omitsBoth", () => {
    const html = renderToStaticMarkup(<KeyFacts facts={[{ id: "format", label: "Format", value: "FT3" }]} />);

    expect(html).not.toContain("data-wide");
    expect(html).not.toContain('class="detail"');
  });
});
