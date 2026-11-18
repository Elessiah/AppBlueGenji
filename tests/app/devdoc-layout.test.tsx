import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Mise en page de `/devdoc` (`docs/features/DEVDOC.md`) : l'arborescence y vit,
 * donc une seule fois par visite ; le document ouvert se lit dans l'adresse.
 */
let mockLocale: "fr" | "en" = "fr";
let mockPathname = "/devdoc";
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/server/dev-docs", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/dev-docs")>("@/lib/server/dev-docs");
  return { ...actual, loadDevDocIndex: jest.fn() };
});
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { renderToStaticMarkup } from "react-dom/server";
import DevDocLayout from "@/app/(secured)/devdoc/layout";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { getCurrentUser } from "@/lib/server/auth";
import { buildDevDocIndex, loadDevDocIndex, type DevDocIndex } from "@/lib/server/dev-docs";
import { authUser } from "../helpers/auth-user";

let base: string;
let index: DevDocIndex;

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "devdoc-layout-"));
  const site = path.join(base, "site");
  await fs.mkdir(path.join(site, "docs/features"), { recursive: true });
  await fs.writeFile(path.join(site, "docs/features/INDEX.md"), "# Index des fonctionnalités\n");
  await fs.writeFile(path.join(site, "docs/features/BUSY_BUTTONS.md"), "# Boutons occupés\n");
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
  mockPathname = "/devdoc";
  jest.mocked(loadDevDocIndex).mockReset().mockResolvedValue(index);
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ roles: ["DEV"] }));
});

async function renderLayout(children = "doc"): Promise<string> {
  const tree = await DevDocLayout({ children });
  return renderToStaticMarkup(<AppLocaleProvider locale={mockLocale}>{tree}</AppLocaleProvider>);
}

describe("DevDocLayout — navigation", () => {
  it("DevDocLayout_devRole_rendersHeaderTreeAndChildren", async () => {
    const html = await renderLayout("CONTENU");
    expect(html).toContain("Documentation développeur");
    expect(html).toContain('href="/devdoc/site/features/BUSY_BUTTONS"');
    expect(html).toContain("CONTENU");
  });

  it("DevDocLayout_loadsIndexOncePerRender", async () => {
    await renderLayout();
    expect(loadDevDocIndex).toHaveBeenCalledTimes(1);
  });

  it("DevDocLayout_startsCollapsedWithToggle", async () => {
    const html = await renderLayout();
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Parcourir les documents");
  });

  it("DevDocLayout_documentUrl_marksCurrentDoc", async () => {
    mockPathname = "/devdoc/site/features/BUSY_BUTTONS";
    const html = await renderLayout();
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("DevDocLayout_englishUrl_marksCurrentDoc", async () => {
    mockLocale = "en";
    mockPathname = "/en/devdoc/site/features/BUSY_BUTTONS";
    const html = await renderLayout();
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('href="/en/devdoc/site/features/BUSY_BUTTONS"');
  });

  it("DevDocLayout_rootUrl_marksDefaultDoc", async () => {
    mockPathname = "/devdoc";
    expect((await renderLayout()).match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("DevDocLayout_unknownDocUrl_marksNothing", async () => {
    mockPathname = "/devdoc/site/features/NOPE";
    expect(await renderLayout()).not.toContain('aria-current="page"');
  });

  it("DevDocLayout_traversalUrl_marksNothing", async () => {
    mockPathname = "/devdoc/site/%2e%2e/x";
    expect(await renderLayout()).not.toContain('aria-current="page"');
  });
});
