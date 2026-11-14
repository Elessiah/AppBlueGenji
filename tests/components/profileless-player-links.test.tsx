import { describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerLink } from "@/components/entity-link";
import { ProfilelessPlayersProvider, sameIds } from "@/components/profileless-players";
import { EntrantLink, EntrantProvider } from "@/app/(secured)/tournois/[id]/_lib/entrant-link";

/**
 * D13 : un compte supprimé sans statistiques n'a plus de fiche ; son nom reste
 * un nom, jamais un lien vers une page 404.
 */
function render(node: ReactNode, ids: readonly number[] = [5]): string {
  return renderToStaticMarkup(<ProfilelessPlayersProvider ids={ids}>{node}</ProfilelessPlayersProvider>);
}

describe("PlayerLink — compte sans fiche", () => {
  it("PlayerLink_profilelessUser_rendersPlainName", () => {
    expect(render(<PlayerLink userId={5}>Renard Pâle</PlayerLink>)).toBe(
      '<span class="entity-name">Renard Pâle</span>',
    );
  });

  it("PlayerLink_otherUser_rendersLink", () => {
    expect(render(<PlayerLink userId={6}>Joueur</PlayerLink>)).toBe(
      '<a class="entity-link" href="/joueurs/6">Joueur</a>',
    );
  });

  it("PlayerLink_outsideProvider_rendersLink", () => {
    expect(renderToStaticMarkup(<PlayerLink userId={5}>Joueur</PlayerLink>)).toBe(
      '<a class="entity-link" href="/joueurs/5">Joueur</a>',
    );
  });
});

describe("EntrantLink — entrée solo d'un compte sans fiche", () => {
  it("EntrantLink_soloEntryOfProfilelessUser_rendersPlainName", () => {
    const html = render(
      <EntrantProvider participantType="SOLO" soloUserIds={{ 900: 5 }} logos={{}}>
        <EntrantLink teamId={900}>Renard Pâle</EntrantLink>
      </EntrantProvider>,
    );

    expect(html).toBe('<span class="entity-name">Renard Pâle</span>');
  });

  it("EntrantLink_teamEntrant_rendersTeamLink", () => {
    // Le fournisseur tait le joueur 5, pas l'équipe 5 : un identifiant d'équipe
    // n'est jamais lu comme celui d'un compte.
    const html = render(
      <EntrantProvider participantType="TEAM" soloUserIds={{}} logos={{}}>
        <EntrantLink teamId={5}>Alpha</EntrantLink>
      </EntrantProvider>,
    );

    expect(html).toBe('<a class="entity-link" href="/equipes/5">Alpha</a>');
  });
});

describe("sameIds (revue sécurité EF-62 cycle 1)", () => {
  it("sameIds_equalLists_true", () => {
    expect(sameIds([3, 8], [3, 8])).toBe(true);
  });

  it("sameIds_differentLength_false", () => {
    expect(sameIds([3, 8], [3])).toBe(false);
  });

  it("sameIds_differentValue_false", () => {
    expect(sameIds([3, 8], [3, 9])).toBe(false);
  });
});
