import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactNode } from "react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/server/site-copy-service", () => ({ getSiteCopy: jest.fn() }));
jest.mock("@/lib/server/landing-service", () => ({ loadLeaderboardRows: jest.fn() }));
jest.mock("@/lib/server/teams/directory", () => ({ loadCachedTeamForms: jest.fn() }));
// Le gabarit (asynchrone) a ses propres tests : seul le contenu compte ici.
jest.mock("@/components/cyber/landing/SessionPageShell", () => ({
  SessionPageShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

import { renderToStaticMarkup } from "react-dom/server";
import ClassementPage, { metadata } from "@/app/classement/page";
import { ToastProvider } from "@/components/ui/toast";
import { getCurrentUser } from "@/lib/server/auth";
import { getSiteCopy } from "@/lib/server/site-copy-service";
import { loadLeaderboardRows } from "@/lib/server/landing-service";
import { loadCachedTeamForms } from "@/lib/server/teams/directory";
import { defaultSiteCopy } from "@/lib/shared/site-copy";
import { authUser } from "../helpers/auth-user";
import { readSource } from "../helpers/read-source";

/**
 * En-tête éditable de `/classement` (docs/features/EDITABLE_SITE_COPY.md,
 * RANKING_PAGE.md) : titre et sous-titre sortent du registre `site-copy`,
 * modifiables en place par la permission `showcase`.
 */

async function render(): Promise<string> {
  const tree = await ClassementPage({ searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(<ToastProvider>{tree}</ToastProvider>);
}

describe("/classement — en-tête éditable", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(loadLeaderboardRows).mockResolvedValue([]);
    jest.mocked(loadCachedTeamForms).mockResolvedValue(new Map());
    jest.mocked(getSiteCopy).mockResolvedValue(defaultSiteCopy());
    jest.mocked(getCurrentUser).mockResolvedValue(null);
  });

  it("rend les textes d'origine, la dernière ligne du titre en dégradé", async () => {
    const markup = await render();
    expect(markup).toMatch(/<h1 id="classement-title"[^>]*>/);
    expect(markup).toContain("Grimpe jusqu&#x27;au<br/>");
    expect(markup).toContain('<span class="text-gradient">sommet.</span>');
    expect(markup).toContain("Chaque match compte.");
  });

  it("rend les textes édités à la place des défauts", async () => {
    jest.mocked(getSiteCopy).mockResolvedValue({
      ...defaultSiteCopy(),
      "ranking.hero.title": "Vise\nle haut.",
      "ranking.hero.lede": "Sous-titre <b>édité</b>",
    });
    const markup = await render();
    expect(markup).toContain('<span class="text-gradient">le haut.</span>');
    expect(markup).not.toContain("Grimpe jusqu");
    // Texte brut, échappé : aucune balise saisie n'est interprétée.
    expect(markup).toContain("Sous-titre &lt;b&gt;édité&lt;/b&gt;");
  });

  it("n'offre aucun crayon à un visiteur ni à un membre sans `showcase`", async () => {
    expect(await render()).not.toContain("Modifier :");
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 2, roles: [] }));
    expect(await render()).not.toContain("Modifier :");
  });

  it("offre les deux crayons à un Community Manager, sans toucher au titre de niveau 1", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 3, roles: ["COMMUNITY_MANAGER"] }));
    const markup = await render();
    expect(markup).toContain('aria-label="Modifier : En-tête — titre"');
    expect(markup).toContain('aria-label="Modifier : En-tête — sous-titre"');
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toContain('aria-labelledby="classement-title"');
  });

  it("garde le titre de page figé, indépendant du texte éditable", () => {
    expect(String(metadata.title)).toContain("Classement des équipes");
  });
});

describe("EditableCopy — retour du focus et calques de l'en-tête", () => {
  const source = readSource("components/cyber/landing/EditableCopy.tsx");
  const css = readSource("components/cyber/landing/EditableCopy.module.css");

  it("ferme l'éditeur par un seul chemin qui rend le focus au crayon", () => {
    // Enregistrer, rétablir et annuler passent tous par `closeEditor`.
    expect(source.match(/closeEditor\(\);/g)).toHaveLength(3);
    expect(source.match(/setEditing\(false\)/g)).toHaveLength(1);
    expect(source).toMatch(/returnFocus\.current = true;\s*setEditing\(false\);/);
    expect(source).toMatch(/if \(el && returnFocus\.current\) \{\s*returnFocus\.current = false;\s*el\.focus\(\);/);
  });

  it("place crayon et éditeur au-dessus des calques décoratifs (trame, aurore)", () => {
    expect(css).toMatch(/\.pencil \{\s*position: relative;/);
    expect(css).toMatch(/\.editor \{\s*position: relative;/);
  });
});
