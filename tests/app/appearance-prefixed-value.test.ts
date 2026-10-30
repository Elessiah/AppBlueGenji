import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ROOT, stripComments, walk } from "./_lib/style-sweep";

/**
 * `auto` est une valeur de `appearance`, jamais de ses alias préfixés.
 *
 * `-webkit-appearance` précède la propriété standard : il n'accepte que `none`
 * et les noms de contrôles natifs hérités (`button`, `textfield`, `menulist`…),
 * et c'est `appearance` qui a introduit `auto`. Posée sur l'alias, la valeur ne
 * rend donc rien là où le navigateur n'a que l'alias — une déclaration morte,
 * que SonarCloud ouvre en bug de fiabilité BLOCKER (css:S9424, « CSS property
 * values should be valid »). Elle l'est restée cinq semaines sur `main`, dans
 * la règle des contrastes forcés des cases à cocher.
 *
 * L'alias n'y servait d'ailleurs à rien : Chromium et Firefox traitent les deux
 * noms comme une seule propriété, et Safari, le seul à n'avoir longtemps connu
 * que le préfixe, ne lit pas `forced-colors` — et connaît le nom standard
 * depuis 15.4. La règle tenue ici est donc : **le préfixe garde les valeurs du
 * préfixe**, `auto` passe par le nom standard.
 */

type Offender = { file: string; declaration: string };

/** Les déclarations `-*-appearance: auto` d'une feuille, commentaires exclus. */
function prefixedAutoOffenders(file: string, css: string): Offender[] {
  const found: Offender[] = [];
  // Le tiret qui précède est exclu : `--theme-appearance` est une variable, pas
  // un alias — et personne ne lui impose ses valeurs.
  for (const match of stripComments(css).matchAll(/(?<![-\w])(-[a-z]+-appearance)\s*:\s*([^;}]+)/gi)) {
    const value = match[2].replace(/!\s*important/i, "").trim().toLowerCase();
    if (value === "auto") found.push({ file, declaration: `${match[1].trim()}: ${value}` });
  }
  return found;
}

describe("balayage — `auto` sur un alias préfixé d'`appearance`", () => {
  it.each<[string, string, number]>([
    ["l'alias WebKit", '.a { -webkit-appearance: auto; }', 1],
    ["l'alias Mozilla", '.a { -moz-appearance: auto; }', 1],
    ["la casse et les espaces n'y changent rien", ".a {-WEBKIT-APPEARANCE:AUTO}", 1],
    ["un `!important` ne le couvre pas", ".a { -webkit-appearance: auto !important; }", 1],
    ["la propriété standard, elle, prend `auto`", ".a { appearance: auto; }", 0],
    ["l'alias avec une valeur qui est la sienne", ".a { -webkit-appearance: none; }", 0],
    ["l'alias avec un contrôle natif nommé", ".a { -moz-appearance: textfield; }", 0],
    ["une variable dont le nom finit par le même mot", ".a { --theme-appearance: auto; }", 0],
    ["un commentaire qui cite le motif", "/* -webkit-appearance: auto; */ .a { color: red; }", 0],
  ])("%s", (_label, css, count) => {
    expect(prefixedAutoOffenders("x.css", css)).toHaveLength(count);
  });

  it("aucune feuille de app/ ni de components/ ne pose `auto` sur un alias", () => {
    const files = [...walk(join(ROOT, "app"), ".css"), ...walk(join(ROOT, "components"), ".css")];
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.flatMap((path) =>
      prefixedAutoOffenders(relative(ROOT, path).split(sep).join("/"), readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
