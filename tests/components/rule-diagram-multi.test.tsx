import { readFileSync } from "node:fs";
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

describe("messages/fr/rules.json", () => {
  it("frRules_cutMode_neverBareSurvie", () => {
    const source = readFileSync(path.join(process.cwd(), "messages/fr/rules.json"), "utf8");

    // Tout « Survie » qui n'est pas « BlueGenji Survie » est « Survie par coupes ».
    const bare = source.match(/(?<!BlueGenji )\b[Ss](?:urvie|URVIE)\b(?! par coupes| PAR COUPES)/g);

    expect(bare).toBeNull();
  });
});
