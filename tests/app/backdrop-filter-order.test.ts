import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, stripComments, walk } from "./_lib/style-sweep";

/**
 * `-webkit-backdrop-filter` **avant** `backdrop-filter`, jamais l'inverse.
 *
 * Lightning CSS (Turbopack, donc `next dev`) fusionne les deux déclarations
 * d'un même bloc en ne gardant que la **dernière** : écrite après la forme
 * standard, la forme préfixée l'emportait, et Chrome, qui l'ignore, calculait
 * `none` — en-têtes et voiles sans flou en développement. La production
 * (webpack) garde les deux aujourd'hui, mais la perdrait le jour où
 * `next build` passe à Turbopack. La forme préfixée d'abord laisse la
 * standard gagner partout.
 */

type Offender = { file: string; block: string };

/** Les blocs de déclarations (sans accolade imbriquée) où l'ordre est fautif. */
function backdropOrderOffenders(file: string, css: string): Offender[] {
  const found: Offender[] = [];
  for (const match of stripComments(css).matchAll(/\{([^{}]*)\}/g)) {
    const declarations = match[1]
      .split(";")
      .map((d) => d.split(":")[0].trim().toLowerCase())
      .filter(Boolean);
    const standard = declarations.indexOf("backdrop-filter");
    const prefixed = declarations.indexOf("-webkit-backdrop-filter");
    if (standard !== -1 && prefixed !== -1 && prefixed > standard) {
      found.push({ file, block: match[1].trim() });
    }
  }
  return found;
}

describe("balayage — ordre de backdrop-filter", () => {
  it.each<[string, string, number]>([
    ["la forme standard puis la préfixée", ".a { backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }", 1],
    ["séparées par une autre déclaration", ".a {\n  backdrop-filter: blur(4px);\n  color: red;\n  -webkit-backdrop-filter: blur(4px);\n}", 1],
    ["dans une requête média", "@media (max-width: 640px) { .a { backdrop-filter: none; -webkit-backdrop-filter: none; } }", 1],
    ["la forme préfixée d'abord", ".a { -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }", 0],
    ["la forme standard seule", ".a { backdrop-filter: blur(4px); }", 0],
    ["un commentaire qui cite l'ordre fautif", "/* backdrop-filter: x; -webkit-backdrop-filter: x; */ .a { color: red; }", 0],
    ["deux blocs distincts", ".a { backdrop-filter: blur(4px); } .b { -webkit-backdrop-filter: blur(4px); }", 0],
  ])("%s", (_label, css, count) => {
    expect(backdropOrderOffenders("x.css", css)).toHaveLength(count);
  });

  it("aucune feuille de app/ ni de components/ ne pose la forme préfixée en second", () => {
    const files = [...walk(join(ROOT, "app"), ".css"), ...walk(join(ROOT, "components"), ".css")];
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.flatMap((path) =>
      backdropOrderOffenders(relative(ROOT, path).replace(/\\/g, "/"), readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
