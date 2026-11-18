import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

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
jest.mock("next/navigation", () =>
  jest.requireActual<typeof import("../helpers/devdoc-fixture")>("../helpers/devdoc-fixture").devDocNavigationMock(() => mockPathname),
);

import { renderToStaticMarkup } from "react-dom/server";
import DevDocLayout from "@/app/(secured)/devdoc/layout";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { getCurrentUser } from "@/lib/server/auth";
import { loadDevDocIndex, type DevDocIndex } from "@/lib/server/dev-docs";
import { makeDevDocFixture, type DevDocFixture } from "../helpers/devdoc-fixture";
import { authUser } from "../helpers/auth-user";

let fixture: DevDocFixture;
let index: DevDocIndex;

beforeAll(async () => {
  fixture = await makeDevDocFixture("devdoc-layout-", {
    "docs/features/INDEX.md": "# Index des fonctionnalités\n",
    "docs/features/BUSY_BUTTONS.md": "# Boutons occupés\n",
  });
  index = fixture.index;
});

afterAll(() => fixture.cleanup());

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
