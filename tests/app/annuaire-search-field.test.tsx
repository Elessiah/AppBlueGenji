import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { AnnuaireSearchField } from "@/app/(secured)/_shared/AnnuaireSearchField";
import { blockFor, stripComments } from "./_lib/style-sweep";
import { readSource } from "../helpers/read-source";

/**
 * Recherche des annuaires `/equipes` et `/joueurs` : la pastille annonçait
 * « ⌘K » en dur sans qu'aucune touche soit écoutée, et le champ n'avait que
 * son placeholder pour nom.
 */
describe("AnnuaireSearchField", () => {
  const html = renderToStaticMarkup(
    <AnnuaireSearchField
      label="Rechercher une équipe"
      placeholder="Rechercher…"
      value=""
      onChange={() => {}}
    />,
  );

  it("nomme le champ indépendamment du placeholder", () => {
    expect(html).toContain('aria-label="Rechercher une équipe"');
  });

  it("déclare le raccourci et rend le libellé sûr au rendu serveur", () => {
    expect(html).toContain('aria-keyshortcuts="Control+K Meta+K"');
    expect(html).toContain("Ctrl+K");
    expect(html).not.toContain("⌘K");
  });

  it("tait la pastille au lecteur d'écran", () => {
    expect(html).toMatch(/<span class="[^"]*" aria-hidden="true">Ctrl\+K<\/span>/);
  });

  it("est nommé par les deux annuaires", () => {
    expect(readSource("app/(secured)/equipes/page.tsx")).toContain('label="Rechercher une équipe"');
    expect(readSource("app/(secured)/joueurs/page.tsx")).toContain('label="Rechercher un joueur"');
  });
});

describe.each<[string, string]>([
  ["annuaires", "app/(secured)/_shared/annuaire.module.css"],
  ["tournois", "app/(secured)/tournois/tournois.module.css"],
])("recherche des %s", (_name, file) => {
  const css = stripComments(readSource(file));

  it("écrit en 16 px au moins, sans quoi iOS zoome au focus", () => {
    const rule = blockFor(
      /\.search input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)\s*\{/,
      css,
    );
    expect(rule).toMatch(/font-size:\s*16px\s*;/);
  });

  it("masque la pastille du raccourci sur écran tactile", () => {
    const at = css.indexOf("@media (hover: none)");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(blockFor(/\.searchKbd\s*\{/, css.slice(at))).toMatch(/display:\s*none\s*;/);
  });
});
