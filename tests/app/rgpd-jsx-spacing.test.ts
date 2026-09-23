import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collapsedBoundaries } from "./_lib/jsx-spacing";

const SOURCE = readFileSync(
  join(__dirname, "..", "..", "app", "rgpd", "page.tsx"),
  "utf8",
);

/**
 * L'espace qui disparaît à une frontière d'élément JSX.
 *
 * Le nettoyage du texte JSX (Babel, `cleanJSXElementLiteralChild`) supprime le
 * saut de ligne en tête d'un nœud de texte, puis l'indentation de la ligne
 * suivante. Il n'insère une espace qu'**à l'intérieur** d'un même nœud réparti
 * sur plusieurs lignes — jamais entre deux enfants. Un `</strong>` qui termine
 * sa ligne est donc collé au mot qui ouvre la suivante : la page publique
 * rendait « s'il a organiséun tournoi ».
 *
 * La panne est **muette** : elle ne lève rien, ne casse aucune mise en page, et
 * ne se voit qu'à la lecture du texte rendu. Aucun test de composant ne
 * l'attrape non plus — la page ne se monte pas hors de Next (`PublicHeader`).
 * D'où un contrôle sur la source, qui est l'endroit où la règle se lit
 * (moteur partagé : `_lib/jsx-spacing.ts`, ici sur **toutes** les balises).
 */

describe("/rgpd — les espaces survivent aux frontières d'éléments", () => {
  it("rend « organisé un tournoi », et non « organiséun tournoi »", () => {
    // Le paragraphe introduit par la suppression de compte : l'espace est
    // portée par un `{" "}` explicite en fin de ligne, seule forme qui survive.
    expect(SOURCE).toContain('s\'il a{" "}');
    expect(SOURCE).toContain("<strong>organisé</strong> un tournoi");
    expect(SOURCE).not.toMatch(/<strong>organisé<\/strong>\s*\n/);
  });

  it("n'a plus aucune frontière écrasée", () => {
    // La dernière — « le temps d'une connexionpar Google », section « cookies »,
    // consignée le 2026-09-23 — est réglée par un `{" "}`. Le balayage de tous
    // les écrans vit dans `jsx-inline-spacing.test.ts` ; celui-ci garde la page
    // publique, où toutes les balises comptent et pas seulement l'emphase.
    expect(collapsedBoundaries(SOURCE)).toEqual([]);
    expect(SOURCE).toContain('le temps d&apos;une connexion</strong>{" "}');
  });
});
