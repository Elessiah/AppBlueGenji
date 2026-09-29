import { describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { AccountMenu, AccountMenuPanel, requestLogout } from "@/components/account-menu";
import { ToastProvider } from "@/components/ui/toast";
import { readSource } from "../helpers/read-source";

const menu = () =>
  renderToStaticMarkup(
    <ToastProvider>
      <AccountMenu pseudo="Nova" avatarUrl={null} activeTeam={{ teamId: 7, teamName: "Les Ours" }} />
    </ToastProvider>,
  );

const panel = (activeTeam: { teamId: number; teamName: string } | null, leaving = false) =>
  renderToStaticMarkup(
    <AccountMenuPanel
      id="compte"
      activeTeam={activeTeam}
      leaving={leaving}
      onNavigate={() => undefined}
      onLogout={() => undefined}
    />,
  );

describe("AccountMenu — bouton", () => {
  it("fait commencer son nom accessible par le pseudo affiché (WCAG 2.5.3)", () => {
    const html = menu();
    expect(html).toContain('aria-label="Nova, menu du compte"');
    expect(html).toContain(">Nova</span>");
  });

  it("est un bouton de divulgation fermé, sans menu ARIA annoncé", () => {
    const html = menu();
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("aria-haspopup");
    // Fermé, le panneau n'existe pas : rien à désigner.
    expect(html).not.toContain("aria-controls");
    expect(html).not.toContain("Déconnexion");
  });
});

describe("AccountMenuPanel", () => {
  it("mène au profil, à l'équipe et propose la déconnexion", () => {
    const html = panel({ teamId: 7, teamName: "Les Ours" });
    expect(html).toContain('<div id="compte"');
    expect(html).toContain('href="/profil"');
    expect(html).toContain('href="/equipes/7"');
    expect(html).toContain('aria-label="Mon équipe : Les Ours"');
    expect(html).toMatch(/<button type="button"[^>]*>Déconnexion<\/button>/);
  });

  it("n'affiche pas d'entrée d'équipe à qui n'en a pas", () => {
    const html = panel(null);
    expect(html).not.toContain("/equipes/");
    expect(html).toContain("Déconnexion");
  });

  it("désactive la déconnexion pendant la requête", () => {
    expect(panel(null, true)).toMatch(/<button[^>]*disabled=""[^>]*>Déconnexion…<\/button>/);
  });
});

describe("requestLogout", () => {
  const response = (ok: boolean) => ({ ok }) as Response;

  it("appelle la route de déconnexion en POST", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(response(true));
    await expect(requestLogout(fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
  });

  it("rend false sur un refus du serveur", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(response(false));
    await expect(requestLogout(fetchImpl)).resolves.toBe(false);
  });

  it("rend false sur une panne réseau, sans lever", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
    await expect(requestLogout(fetchImpl)).resolves.toBe(false);
  });
});

describe("mise en page de la navigation", () => {
  const arenaCss = readSource("components/arena-nav.module.css");
  const headerCss = readSource("components/cyber/landing/PublicHeader.module.css");

  it("l'en-tête public ne passe plus sur deux lignes sous 1100 px", () => {
    expect(headerCss).not.toMatch(/grid-template-columns:\s*1fr;/);
  });

  it("aucune des deux barres ne reste collante en paysage bas", () => {
    for (const css of [arenaCss, headerCss]) {
      const block = css.slice(css.indexOf("@media (max-height: 500px)"));
      expect(block.slice(0, block.indexOf("}\n}"))).toContain("position: relative");
    }
  });

  it("réduit « Accueil » / « Mon équipe » au pictogramme entre 721 et 1150 px", () => {
    const block = arenaCss.slice(arenaCss.indexOf("@media (max-width: 1150px)"));
    expect(block).toMatch(/\.navHomeLabel\s*\{[^}]*clip: rect\(0, 0, 0, 0\)/);
  });
});
