import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtraScopes } from "@/app/rgpd/ExtraScopes";

/**
 * Portées d'une même pastille de base : jointes par « ; », elles se
 * confondaient avec les « ; » qu'elles contiennent déjà (ERREUR.txt, revue #525).
 */
describe("ExtraScopes", () => {
  it("rend une portée seule en ligne, sans liste", () => {
    const html = renderToStaticMarkup(<ExtraScopes scopes={["arbitre ; avant la v7"]} />);
    expect(html).toBe("arbitre ; avant la v7");
  });

  it("rend plusieurs portées en liste, une par élément", () => {
    const html = renderToStaticMarkup(<ExtraScopes scopes={["a ; b", "c — d"]} />);
    expect(html).toMatch(/^<ul class="[^"]*">/);
    expect(html).toContain("<li>a ; b</li><li>c — d</li>");
    expect(html).not.toContain("a ; b ; c");
  });

  it("ne rend rien pour une liste vide", () => {
    expect(renderToStaticMarkup(<ExtraScopes scopes={[]} />)).toBe("");
  });

  it("/rgpd FR et EN passent par ExtraScopes, jamais par un join", () => {
    for (const file of ["app/rgpd/page.tsx", "app/rgpd/RgpdEn.tsx"]) {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("<ExtraScopes scopes={group.scopes} />");
      expect(src).not.toMatch(/group\.scopes\.join\("(; | ; )"\)/);
    }
  });
});
