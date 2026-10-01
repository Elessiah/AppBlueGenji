/**
 * Caractérisation du rendu de `TeamSettings` selon le lecteur (propriétaire,
 * manager, staff d'une fantôme) et l'état du logo, rendu côté serveur (les
 * effets ne s'exécutent pas : aucune requête ne part).
 */
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  usePathname: () => "/equipes/1",
}));

import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ui/toast";
import { TeamSettings } from "@/app/(secured)/equipes/[id]/_components/TeamSettings";
import type { TeamDetailResponse } from "@/lib/shared/types";
import { teamDetailResponse } from "../helpers/team-detail";

function render(team: TeamDetailResponse): string {
  return renderToStaticMarkup(
    <ToastProvider>
      <TeamSettings team={team} onChanged={() => undefined} />
    </ToastProvider>,
  );
}

const owner = teamDetailResponse({
  viewerMembership: "OWNER",
  canManage: true,
  team: { name: "Les Glaciers", tag: "GLC", description: "Une équipe." },
});

describe("TeamSettings — propriétaire", () => {
  const html = render(owner);

  it("montre le formulaire d'identité prérempli, sans bouton d'annulation tant que rien n'a changé", () => {
    expect(html).toContain('aria-label="Identité de l&#x27;équipe"');
    expect(html).toContain('value="Les Glaciers"');
    expect(html).toContain('value="GLC"');
    expect(html).toContain("Une équipe.");
    expect(html).not.toContain("Annuler les modifications");
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Enregistrer<\/button>/);
  });

  it("propose d'ajouter un logo, sans le retirer", () => {
    expect(html).toContain("Ajouter un logo");
    expect(html).not.toContain("Retirer le logo");
    expect(html).not.toContain("Envoyer le logo");
  });

  it("ouvre la zone sensible du transfert et de la dissolution", () => {
    expect(html).toContain("Zone sensible");
    expect(html).toContain("Transférer la propriété");
    expect(html).toContain("Dissoudre l&#x27;équipe");
    expect(html).not.toContain("Proposer à un joueur");
  });
});

describe("TeamSettings — manager", () => {
  const html = render(teamDetailResponse({ viewerMembership: "MEMBER", canManage: true }));

  it("ne montre que le logo, avec la phrase qui renvoie au propriétaire", () => {
    expect(html).not.toContain("Identité de l");
    expect(html).toContain("réservés à son propriétaire");
    expect(html).not.toContain("Zone sensible");
    expect(html).toContain("Ajouter un logo");
  });
});

describe("TeamSettings — staff d'une équipe fantôme", () => {
  const html = render(
    teamDetailResponse({ managedAsGhost: true, canManage: true, team: { isGhost: true } }),
  );

  it("propose la reprise et la suppression de la fantôme", () => {
    expect(html).toContain("Identité de l");
    expect(html).toContain("Proposer à un joueur");
    expect(html).toContain("Supprimer l&#x27;équipe fantôme");
    expect(html).not.toContain("Transférer la propriété");
  });
});

describe("TeamSettings — équipe avec un logo", () => {
  const html = render(
    teamDetailResponse({
      viewerMembership: "OWNER",
      canManage: true,
      team: { logoUrl: "/api/uploads/team-logos/glaciers.webp" },
    }),
  );

  it("propose de changer et de retirer le logo", () => {
    expect(html).toContain("Changer le logo");
    expect(html).toContain("Retirer le logo");
  });
});
