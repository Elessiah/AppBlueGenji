import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { RulesToc } from "@/components/rules/RulesToc";
import { outlineAnchorIds, rulesPageOutline } from "@/lib/shared/rules-page-outline";
import { ruleModeBySlug } from "@/lib/shared/tournament-rules";
import frRules from "@/messages/fr/rules.json";

/**
 * Le sommaire est un composant client, mais son premier rendu (serveur, ou
 * navigateur sans JavaScript) doit déjà être une liste de liens d'ancre qui
 * fonctionne : c'est ce rendu-là qui est vérifié ici.
 */
describe("RulesToc", () => {
  const mode = ruleModeBySlug("bluegenji-survie")!;
  const outline = rulesPageOutline(mode, { hasTournamentSettings: true, labels: frRules.toc });
  const html = renderToStaticMarkup(
    <RulesToc entries={outline} label={frRules.toc.label} heading={frRules.toc.heading} />,
  );

  it("est un repère de navigation nommé", () => {
    expect(html).toContain('<nav class="toc" aria-label="Sommaire des règles">');
  });

  it("rend un lien d'ancre par entrée, sous-entrées comprises", () => {
    for (const id of outlineAnchorIds(outline)) {
      expect(html).toContain(`href="#${id}"`);
    }
  });

  it("n'annonce aucune section en cours avant toute mesure", () => {
    expect(html).not.toContain("aria-current");
  });

  it("rend les libellés des règles du mode", () => {
    for (const section of mode.sections) {
      expect(html).toContain(
        section.title.replace(/&/g, "&amp;").replace(/'/g, "&#x27;"),
      );
    }
  });
});
