import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
jest.mock("next/navigation", () => ({
  usePathname: () => "/devdoc",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { renderToStaticMarkup } from "react-dom/server";
import DevDocLayout, { generateMetadata as generateLayoutMetadata } from "@/app/(secured)/devdoc/layout";
import DevDocPage from "@/app/(secured)/devdoc/[[...path]]/page";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { getCurrentUser } from "@/lib/server/auth";
import { buildDevDocIndex, loadDevDocIndex, type DevDocIndex } from "@/lib/server/dev-docs";
import { authUser } from "../helpers/auth-user";

let base: string;
let index: DevDocIndex;

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "devdoc-page-"));
  const site = path.join(base, "site");
  await fs.mkdir(path.join(site, "docs/features"), { recursive: true });
  await fs.writeFile(path.join(site, "docs/features/INDEX.md"), "# Index des fonctionnalités\n\nVoir [boutons](BUSY_BUTTONS.md).\n");
  await fs.writeFile(path.join(site, "docs/features/BUSY_BUTTONS.md"), "# Boutons occupés\n\nTexte.\n");
  index = await buildDevDocIndex({
    site: { root: site, dirs: ["docs"], files: [] },
    bot: { root: path.join(base, "absent"), dirs: ["doc"], files: [] },
  });
});

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

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
    expect(html).toContain('aria-current="page"');
  });

  it("DevDocPage_englishLocale_prefixesInternalLinks", async () => {
    mockLocale = "en";
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ isAdmin: true }));
    const html = await renderPage(["site", "features", "INDEX"]);
    expect(html).toContain('href="/en/devdoc/site/features/BUSY_BUTTONS"');
    expect(html).toContain("This document is written in French.");
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
  it("generateMetadata_plainUser_noTitle", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser());
    expect(await generateLayoutMetadata()).toEqual({});
  });

  it("generateMetadata_devRole_setsTitle", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ roles: ["DEV"] }));
    expect(JSON.stringify(await generateLayoutMetadata())).toContain("Documentation développeur");
  });
});
