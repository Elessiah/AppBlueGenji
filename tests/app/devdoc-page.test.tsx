import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Garde de `/devdoc` (`docs/features/DEVDOC.md`) : sans session, rien (l'espace
 * sécurisé montre « Connexion requise ») ; connecté sans la permission `dev`,
 * 404 ; administrateur ou rôle `DEV`, le document. L'index est bâti sur un faux
 * dépôt temporaire.
 */
let mockLocale: "fr" | "en" = "fr";
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/server/dev-docs", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/dev-docs")>("@/lib/server/dev-docs");
  return { ...actual, loadDevDocIndex: jest.fn() };
});
jest.mock("next/navigation", () =>
  jest.requireActual<typeof import("../helpers/devdoc-fixture")>("../helpers/devdoc-fixture").devDocNavigationMock(() => "/devdoc"),
);

import { renderToStaticMarkup } from "react-dom/server";
import DevDocLayout, { generateMetadata as generateLayoutMetadata } from "@/app/(secured)/devdoc/layout";
import DevDocPage, { generateMetadata as generatePageMetadata } from "@/app/(secured)/devdoc/[[...path]]/page";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { getCurrentUser } from "@/lib/server/auth";
import { loadDevDocIndex, type DevDocIndex } from "@/lib/server/dev-docs";
import { makeDevDocFixture, type DevDocFixture } from "../helpers/devdoc-fixture";
import { authUser } from "../helpers/auth-user";

let fixture: DevDocFixture;
let index: DevDocIndex;

beforeAll(async () => {
  fixture = await makeDevDocFixture("devdoc-page-", {
    "docs/features/INDEX.md": "# Index des fonctionnalités\n\nVoir [boutons](BUSY_BUTTONS.md).\n",
    "docs/features/BUSY_BUTTONS.md": "# Boutons occupés\n\nTexte.\n",
    "docs/features/LONG.md": "# Long\n\n## Un\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## Deux\n\n### Trois\n\n## Quatre\n",
  });
  index = fixture.index;
});

afterAll(() => fixture.cleanup());

beforeEach(() => {
  mockLocale = "fr";
  jest.mocked(loadDevDocIndex).mockResolvedValue(index);
});

async function renderPage(segments?: string[]): Promise<string> {
  const tree = await DevDocPage({ params: Promise.resolve({ path: segments }) });
  return renderToStaticMarkup(<AppLocaleProvider locale={mockLocale}>{tree}</AppLocaleProvider>);
}

describe("DevDocPage — garde", () => {
  it("DevDocPage_noSession_rendersNothing", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await DevDocPage({ params: Promise.resolve({}) })).toBeNull();
  });

  it("DevDocPage_plainUser_notFound", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser());
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("DevDocPage_otherStaffRole_notFound", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ roles: ["ARBITRE"] }));
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("DevDocPage_devRole_rendersDefaultIndex", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ roles: ["DEV"] }));
    const html = await renderPage();
    expect(html).toContain("Index des fonctionnalités");
    expect(html).toContain('href="/devdoc/site/features/BUSY_BUTTONS"');
  });

  it("DevDocPage_admin_rendersDeepLink", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ isAdmin: true }));
    const html = await renderPage(["site", "features", "BUSY_BUTTONS"]);
    expect(html).toContain("<h2 id=\"boutons-occupés\">Boutons occupés</h2>");
  });

  it("DevDocPage_englishLocale_prefixesInternalLinks", async () => {
    mockLocale = "en";
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ isAdmin: true }));
    const html = await renderPage(["site", "features", "INDEX"]);
    expect(html).toContain('href="/en/devdoc/site/features/BUSY_BUTTONS"');
    expect(html).toContain("This document is written in French.");
  });

  it("DevDocPage_longDoc_rendersOutlineNamedTableAndNewTabLink", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ isAdmin: true }));
    const html = await renderPage(["site", "features", "LONG"]);
    expect(html).toContain("Sur cette page");
    expect(html).toContain('<a href="#trois">Trois</a>');
    // Le sommaire défile dans une `<ScrollArea>`, jamais un `overflow` posé à la main.
    expect(html).toMatch(/<div class="scroll-area[^"]*"[^>]*><ul class="[^"]*outlineList/);
    expect(html).toContain('role="region" tabindex="0" aria-label="Tableau, défilable"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("(nouvel onglet)");
  });

  it("DevDocPage_shortDoc_hasNoOutline", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ isAdmin: true }));
    expect(await renderPage(["site", "features", "BUSY_BUTTONS"])).not.toContain("Sur cette page");
  });

  it("DevDocPage_unknownDoc_notFound", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ isAdmin: true }));
    await expect(renderPage(["site", "features", "NOPE"])).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("DevDocPage_traversalPath_notFound", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ isAdmin: true }));
    await expect(renderPage(["site", "..", "..", ".env"])).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("DevDocLayout — garde", () => {
  it("DevDocLayout_noSession_rendersNothing", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await DevDocLayout({ children: "doc" })).toBeNull();
  });

  it("DevDocLayout_plainUser_notFound", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser());
    await expect(DevDocLayout({ children: "doc" })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("DevDocLayout_devRole_rendersChildren", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ roles: ["DEV"] }));
    expect(renderToStaticMarkup(await DevDocLayout({ children: "doc" }))).toContain("doc");
  });
});

describe("DevDocLayout — titre", () => {
  /** Titre de la page introuvable que ce lecteur reçoit, jamais indexée. */
  const NOT_FOUND_METADATA = {
    title: { absolute: "Page introuvable · BlueGenji Esport" },
    robots: { index: false, follow: false },
  };

  it("generateMetadata_noSession_noTitle", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await generateLayoutMetadata()).toEqual({});
  });

  it("generateMetadata_plainUser_notFoundTitle", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser());
    expect(await generateLayoutMetadata()).toEqual(NOT_FOUND_METADATA);
  });

  it("generateMetadata_unknownDocument_notFoundTitle", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ roles: ["DEV"] }));
    const metadata = await generatePageMetadata({ params: Promise.resolve({ path: ["site", "features", "NOPE"] }) });
    expect(metadata).toEqual(NOT_FOUND_METADATA);
  });

  it("generateMetadata_unknownDocumentInEnglish_englishNotFoundTitle", async () => {
    mockLocale = "en";
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ roles: ["DEV"] }));
    const metadata = await generatePageMetadata({ params: Promise.resolve({ path: ["site", "features", "NOPE"] }) });
    expect(metadata.title).toEqual({ absolute: "Page not found · BlueGenji Esport" });
  });

  it("generateMetadata_knownDocument_documentTitle", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ roles: ["DEV"] }));
    const metadata = await generatePageMetadata({ params: Promise.resolve({ path: ["site", "features", "BUSY_BUTTONS"] }) });
    expect(metadata).toEqual({ title: "Boutons occupés" });
  });

  it("generateMetadata_devRole_setsTitle", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ roles: ["DEV"] }));
    expect(JSON.stringify(await generateLayoutMetadata())).toContain("Documentation développeur");
  });
});
