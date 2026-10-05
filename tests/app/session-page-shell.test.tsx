import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactElement, ReactNode } from "react";
import type { AuthUser } from "@/lib/server/auth";

jest.mock("next/navigation", () => ({
  usePathname: () => "/classement",
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/server/teams/roster", () => ({ getUserActiveTeam: jest.fn() }));
jest.mock("@/lib/server/content-reports", () => ({ countOpenReports: jest.fn() }));
// L'en-tête vitrine lit la session et la base : seule sa place compte ici.
jest.mock("@/components/cyber/landing/PublicHeader", () => ({
  PublicHeader: () => <header>en-tête vitrine</header>,
}));
jest.mock("@/components/cyber/landing/PublicFooter", () => ({
  PublicFooter: () => <footer>pied vitrine</footer>,
}));

import { renderToStaticMarkup } from "react-dom/server";
import { getCurrentUser } from "@/lib/server/auth";
import { getUserActiveTeam } from "@/lib/server/teams/roster";
import { countOpenReports } from "@/lib/server/content-reports";
import { SessionPageShell } from "@/components/cyber/landing/SessionPageShell";
import { ArenaShell } from "@/components/arena-shell";
import { ToastProvider } from "@/components/ui/toast";
import { authUser } from "../helpers/auth-user";
import { readSource } from "../helpers/read-source";

/** Rend le gabarit, `ArenaShell` (asynchrone) résolu à la main. */
async function render(): Promise<string> {
  let tree = (await SessionPageShell({ children: <h1>Classement</h1> })) as ReactElement<{
    user: AuthUser;
    children: ReactNode;
  }>;
  if (tree.type === ArenaShell) tree = (await ArenaShell(tree.props)) as typeof tree;
  return renderToStaticMarkup(<ToastProvider>{tree}</ToastProvider>);
}

const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;

describe("SessionPageShell — en-tête selon la session", () => {
  beforeEach(() => {
    jest.mocked(getUserActiveTeam).mockResolvedValue(null);
    jest.mocked(countOpenReports).mockResolvedValue(3);
  });

  it("déconnecté : en-tête vitrine, aucune barre des connectés", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const html = await render();
    expect(html).toContain(
      '<header>en-tête vitrine</header><main style="position:relative;z-index:1"><h1>Classement</h1></main><footer>pied vitrine</footer>',
    );
    expect(html).not.toContain("Navigation principale");
    expect(getUserActiveTeam).not.toHaveBeenCalled();
  });

  it("session illisible : retombe sur l'en-tête vitrine", async () => {
    jest.mocked(getCurrentUser).mockRejectedValue(new Error("db"));
    expect(await render()).toContain("en-tête vitrine");
  });

  it("connecté : barre des connectés, « Classement » en page courante", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ pseudo: "Nova" }));
    const html = await render();
    expect(html).not.toContain("en-tête vitrine");
    expect(html).toContain('aria-label="Navigation principale"');
    const current = [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
    expect(current).toEqual(["Classement"]);
    // Le contenu garde son `<main>` vitrine : rien ne bouge d'un état à l'autre.
    expect(html).toContain('<main style="position:relative;z-index:1"><h1>Classement</h1></main>');
    // Sans permission de modération, le compteur n'est pas lu.
    expect(countOpenReports).not.toHaveBeenCalled();
  });

  it("connecté : un seul repère de chaque, barre et pied hors de <main>", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser());
    const html = await render();
    expect(count(html, /<main[ >]/g)).toBe(1);
    expect(count(html, /<nav [^>]*aria-label="Navigation principale"/g)).toBe(1);
    expect(count(html, /<footer[ >]/g)).toBe(1);
    const main = html.indexOf("<main");
    const end = html.indexOf("</main>");
    expect(html.indexOf("Navigation principale")).toBeLessThan(main);
    expect(html.lastIndexOf("<footer")).toBeGreaterThan(end);
  });
});

describe("/classement — gabarit suivant la session", () => {
  it("la page passe par SessionPageShell et reste rendue à la demande", () => {
    const src = readSource("app/classement/page.tsx");
    expect(src).toContain("<SessionPageShell>");
    expect(src).not.toContain("<PublicPageShell>");
    expect(src).toMatch(/export const dynamic = "force-dynamic"/);
  });

  it("l'espace connecté partage la même barre", () => {
    expect(readSource("app/(secured)/layout.tsx")).toContain('<ArenaShell user={user} mainClassName="page-shell">');
  });
});
