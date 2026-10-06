import { describe, expect, it } from "@jest/globals";
import { innermostBlocks, stripComments } from "./_lib/style-sweep";
import { readSource } from "../helpers/read-source";

/**
 * Podium de `/equipes` : le numéro de rang (« 01 », « 02 », « 03 ») en police
 * d'affichage dépasse 44 px. Une largeur fixe le faisait déborder sur le nom,
 * et le premier rang, peint par `background-clip: text`, perdait son « 1 »
 * (le dégradé ne couvre que la boîte). La largeur est un plancher, jamais fixe.
 */

const SHEETS: Array<[file: string, selector: string]> = [
  ["app/(secured)/equipes/cards/HighlightStrip.module.css", ".rank"],
  ["app/(secured)/_shared/annuaire.module.css", ".highlightRank"],
];

function ruleBody(file: string, selector: string): string {
  const blocks = innermostBlocks(stripComments(readSource(file)));
  const found = blocks.find(([sel]) => sel.trim() === selector);
  if (!found) throw new Error(`${selector} introuvable dans ${file}`);
  return found[1];
}

describe("numéro de rang du podium", () => {
  it.each(SHEETS)("%s %s : largeur plancher, sans retour à la ligne", (file, selector) => {
    const body = ruleBody(file, selector);
    expect(body).toMatch(/(?:^|[;\s])min-width:\s*44px/);
    expect(body).not.toMatch(/(?:^|[;\s])width:/);
    expect(body).toMatch(/white-space:\s*nowrap/);
  });

  it("aucune règle du podium ne refixe la largeur du rang", () => {
    for (const [file, selector] of SHEETS) {
      const blocks = innermostBlocks(stripComments(readSource(file)));
      const overrides = blocks.filter(
        ([sel, body]) => sel.includes(selector) && /(?:^|[;\s])(?:max-)?width:/.test(body),
      );
      expect(overrides).toEqual([]);
    }
  });
});
