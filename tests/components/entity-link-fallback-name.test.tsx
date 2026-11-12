import { describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { PlayerLink, TeamLink } from "@/components/entity-link";
import { AppLocaleProvider } from "@/components/i18n/locale-context";

/**
 * Un nom fait seulement d'invisibles rendait un lien sans texte, donc sans nom
 * accessible : le lien affiche « Équipe #id » / « Joueur #id ».
 */
const INVISIBLE = "​⁠";

describe("TeamLink / PlayerLink — nom invisible", () => {
  it("TeamLink_invisibleName_rendersTeamNumber", () => {
    expect(renderToStaticMarkup(<TeamLink teamId={12}>{INVISIBLE}</TeamLink>)).toBe(
      '<a class="entity-link" href="/equipes/12">Équipe #12</a>',
    );
  });

  it("PlayerLink_invisibleNameOnEnglishPage_rendersEnglishFallback", () => {
    const html = renderToStaticMarkup(
      <AppLocaleProvider locale="en">
        <PlayerLink userId={7}>{INVISIBLE}</PlayerLink>
      </AppLocaleProvider>,
    );

    expect(html).toContain(">Player #7</a>");
  });

  it("TeamLink_visibleName_rendersItUnchanged", () => {
    expect(renderToStaticMarkup(<TeamLink teamId={12}>Les Glaciers</TeamLink>)).toBe(
      '<a class="entity-link" href="/equipes/12">Les Glaciers</a>',
    );
  });
});
