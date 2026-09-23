import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { collapsedBoundaries, PHRASING_CLOSING_TAG } from "./_lib/jsx-spacing";
import { ROOT, walk } from "./_lib/style-sweep";

/**
 * Une espace perdue entre une emphase et le texte qui la suit.
 *
 *     <strong>le temps d'une connexion</strong>
 *     par Google, Discord ou Blizzard
 *
 * se rend « connexionpar Google » : le compilateur JSX retire le saut de ligne
 * en tête d'un nœud de texte **et** l'indentation qui le suit, et n'insère une
 * espace qu'à l'intérieur d'un même nœud réparti sur plusieurs lignes — jamais
 * à la frontière d'un élément. Le défaut a vécu sur `/rgpd` sans qu'aucun rendu
 * ne le signale : le texte s'affiche, seul un mot en colle un autre.
 *
 * La règle ne porte que sur les balises de **phrasé** (moteur et motifs dans
 * `_lib/jsx-spacing.ts`).
 */
function lostSpaceOffenders(source: string): number[] {
  return collapsedBoundaries(source, PHRASING_CLOSING_TAG);
}

describe("espace entre une emphase et la ligne suivante", () => {
  it("repère le motif exact du défaut de `/rgpd`", () => {
    const source = [
      "<li>",
      "  <strong>le temps d&apos;une connexion</strong>",
      "  par Google, Discord ou Blizzard",
      "</li>",
    ].join("\n");
    expect(lostSpaceOffenders(source)).toEqual([2]);
  });

  it("accepte l'espace explicite et la balise suivie d'une autre balise", () => {
    const source = [
      "<strong>organisé</strong>{\" \"}",
      "un tournoi",
      "<strong>a</strong>",
      "<em>b</em>",
      "<code>x</code>",
      "{value}",
    ].join("\n");
    expect(lostSpaceOffenders(source)).toEqual([]);
  });

  it("n'en laisse aucune dans les écrans du site", () => {
    const files = [...walk(join(ROOT, "app"), ".tsx"), ...walk(join(ROOT, "components"), ".tsx")];
    const offenders = files.flatMap((file) =>
      lostSpaceOffenders(readFileSync(file, "utf8")).map(
        (line) => `${relative(ROOT, file)}:${line}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
