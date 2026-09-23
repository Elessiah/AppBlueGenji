import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Un champ en **lecture seule** ne doit pas garder l'affordance de la saisie.
 *
 * Le champ verrouillé reste focusable — c'est la différence avec un champ
 * désactivé, et elle est voulue : un parcours au clavier doit pouvoir lire la
 * valeur. Il ne doit pour autant rien promettre. Deux règles s'en chargent, et
 * la seconde ne suffit pas sans la première : `.field input:focus` pose le halo
 * vert à **specificité égale** et plus haut dans le fichier, si bien qu'un clic
 * de souris rendait une bordure neutre *avec* le halo de la saisie.
 *
 * Contrôle au niveau de la source, faute de pouvoir monter la cascade en test.
 */
const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function ruleBody(selector: string): string {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

describe("champ en lecture seule", () => {
  it("éteint le halo de la saisie, pas seulement au clavier", () => {
    expect(ruleBody(".field input[readonly],")).toContain("box-shadow: none");
  });

  it("repose un anneau **visible** au parcours clavier", () => {
    const focus = ruleBody(".field input[readonly]:focus-visible,");
    expect(focus).toMatch(/box-shadow:\s*0 0 0 3px/);
    expect(focus).not.toContain("box-shadow: none");
  });

  it("garde la règle `:focus-visible` **après** la règle nue — la cascade en dépend", () => {
    expect(css.indexOf(".field input[readonly]:focus-visible")).toBeGreaterThan(
      css.indexOf(".field input[readonly],"),
    );
  });

  it("n'emprunte pas le vert du champ modifiable", () => {
    expect(ruleBody(".field input[readonly]:focus-visible,")).not.toContain("accent-green");
  });
});
