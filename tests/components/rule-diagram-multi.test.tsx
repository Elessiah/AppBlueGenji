import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { RuleDiagramFigure } from "@/components/rules/RuleDiagram";
import frRules from "@/messages/fr/rules.json";

// Schéma multi-phases de /regles : le trophée ne recouvre plus le dernier
// entonnoir (x 420–580), et le mode à coupes porte son nom complet.

function renderMulti(): string {
  return renderToStaticMarkup(
    <RuleDiagramFigure diagram="MULTI" caption="Exemple" text={frRules.diagram} locale="fr" />,
  );
}

describe("RuleDiagramFigure — MULTI", () => {
  it("multiDiagram_trophy_sitsRightOfLastFunnel", () => {
    const html = renderMulti();

    expect(html).toMatch(/<rect x="620" y="55" width="120" height="50"/);
  });

  it("multiDiagram_trophy_staysInsideViewBox", () => {
    const html = renderMulti();

    // Trophée de x 620 à 740 : la boîte de 760 le contient avec sa marge de 20.
    expect(html).toContain('viewBox="0 0 760 300"');
  });

  it("multiDiagram_arrow_leavesFromFunnelEdgeForward", () => {
    const html = renderMulti();

    expect(html).toContain('points="580,80 600,80 600,80 620,80"');
    expect(html).not.toContain('points="545,80');
  });

  it("multiDiagram_frLabel_rendersFullName", () => {
    const html = renderMulti();

    expect(html).toContain(">SURVIE PAR COUPES</text>");
  });
});

/** Toutes les valeurs texte d'un catalogue, clés exclues (`"survival": {…}` est un nom de clé). */
function catalogueStrings(locale: "fr" | "en"): string[] {
  const dir = path.join(process.cwd(), "messages", locale);
  const strings: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") strings.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    walk(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
  }
  return strings;
}

// Glossaire I18N.md : le mode à coupes se nomme « Survie par coupes » /
// « Survival (cuts) », jamais « Survie » seul, à côté de « BlueGenji Survie ».
describe("nom du mode à coupes dans les catalogues", () => {
  it("frCatalogues_cutMode_neverBareSurvie", () => {
    const bare = catalogueStrings("fr").filter((text) =>
      /(?<!BlueGenji )\b[Ss](?:urvie|URVIE)\b(?! par coupes| PAR COUPES)/.test(text),
    );

    expect(bare).toEqual([]);
  });

  it("enCatalogues_cutMode_neverBareSurvival", () => {
    const bare = catalogueStrings("en").filter((text) =>
      /(?<!BlueGenji's )\b[Ss](?:urvival|URVIVAL)\b(?! \(cuts\)| \(CUTS\))/.test(text),
    );

    expect(bare).toEqual([]);
  });
});
