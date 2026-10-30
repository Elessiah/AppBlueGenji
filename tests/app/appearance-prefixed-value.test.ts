import { describe, expect, it } from "@jest/globals";
import { stripComments, sweepStylesheets } from "./_lib/style-sweep";

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

/** Ce que le détecteur doit relever. */
const FAUTIFS: Array<{ cas: string; css: string }> = [
  { cas: "l'alias WebKit", css: ".a { -webkit-appearance: auto; }" },
  { cas: "l'alias Mozilla", css: ".a { -moz-appearance: auto; }" },
  { cas: "la casse et les espaces n'y changent rien", css: ".a {-WEBKIT-APPEARANCE:AUTO}" },
  { cas: "un `!important` ne couvre pas la valeur", css: ".a { -webkit-appearance: auto !important; }" },
];

/** Ce qu'il doit laisser passer. */
const CORRECTS: Array<{ cas: string; css: string }> = [
  { cas: "la propriété standard, elle, prend `auto`", css: ".a { appearance: auto; }" },
  { cas: "l'alias avec une valeur qui est la sienne", css: ".a { -webkit-appearance: none; }" },
  { cas: "l'alias avec un contrôle natif nommé", css: ".a { -moz-appearance: textfield; }" },
  { cas: "une variable dont le nom finit par le même mot", css: ".a { --theme-appearance: auto; }" },
  { cas: "un commentaire qui cite le motif", css: "/* -webkit-appearance: auto; */ .a { color: red; }" },
];

describe("balayage — `auto` sur un alias préfixé d'`appearance`", () => {
  it.each(FAUTIFS)("relève $cas", ({ css }) => {
    expect(prefixedAutoOffenders("x.css", css)).toHaveLength(1);
  });

  it.each(CORRECTS)("laisse passer $cas", ({ css }) => {
    expect(prefixedAutoOffenders("x.css", css)).toHaveLength(0);
  });

  it("aucune feuille de app/ ni de components/ ne pose `auto` sur un alias", () => {
    expect(sweepStylesheets(prefixedAutoOffenders)).toEqual([]);
  });
});
