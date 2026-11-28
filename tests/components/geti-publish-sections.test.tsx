/**
 * Fenêtre « Publier » en deux options, sélecteur de catégorie, aperçu de lien
 * et catégorie par défaut de la page des annonces GETI
 * (`docs/features/GETI_INFO.md` § Page publique). Rendu serveur, portail
 * remplacé par son contenu ; les gestes sont joués par `e2e/geti-info.spec.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});
jest.mock("@/lib/shared/hooks/useDialogBehavior", () => ({ useDialogBehavior: () => ({ current: null }) }));
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: jest.fn() }));

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getiCategoryMetadata } from "@/app/geti-info/metadata";
import { GetiCategoryNav } from "@/components/geti/GetiCategoryNav";
import { GetiPublishDialog } from "@/components/geti/GetiPublishButton";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { requestLocale } from "@/lib/server/request-locale";
import type { GetiCategory } from "@/lib/shared/geti";
import {
  GETI_CATEGORY_ORDER,
  GETI_DEFAULT_CATEGORY,
  GETI_OFFICIAL_INVITE_URL,
  GETI_ROBOTS,
  getiCategoryPath,
} from "@/lib/shared/geti/page";
import { GETI_DEFAULT_LIST_PATH } from "@/lib/shared/geti/path";
import type { Locale } from "@/lib/shared/locales";
import enGeti from "@/messages/en/geti.json";
import frGeti from "@/messages/fr/geti.json";
import { readSource } from "../helpers/read-source";

const globalWithDocument = globalThis as { document?: unknown };
const hadDocument = "document" in globalWithDocument;
beforeAll(() => {
  if (!hadDocument) globalWithDocument.document = { body: {} };
});
afterAll(() => {
  if (!hadDocument) delete globalWithDocument.document;
});

const CHANNEL_URL = "https://discord.com/channels/1/2";
const OUR_INVITE_URL = "https://discord.gg/ours";
const COUNTS: Record<GetiCategory, number> = { lfp: 3, lft: 4, lfsub: 0, lfstaff: 1, lfs: 12, lfcast: 2 };

function renderDialog(locale: Locale = "fr", count: ReactNode = null): string {
  const m = locale === "en" ? enGeti : frGeti;
  return renderToStaticMarkup(
    <AppLocaleProvider locale={locale}>
      <GetiPublishDialog
        text={m.publish}
        categoryTitle={m.categories.lfs.title}
        channelUrl={CHANNEL_URL}
        ourInviteUrl={OUR_INVITE_URL}
        official={m.official}
        count={count}
        onClose={() => undefined}
      />
    </AppLocaleProvider>,
  );
}

function renderNav(
  current: GetiCategory,
  counts: Record<GetiCategory, number> | null,
  locale: Locale = "fr",
): string {
  return renderToStaticMarkup(
    <AppLocaleProvider locale={locale}>
      <GetiCategoryNav text={(locale === "en" ? enGeti : frGeti).tabs} locale={locale} current={current} counts={counts} />
    </AppLocaleProvider>,
  );
}

/** Les deux cadres d'option, dans l'ordre du rendu. */
function optionSections(html: string): string[] {
  return [...html.matchAll(/<section[^>]*aria-labelledby="geti-publish-(?:ours|geti)"[^>]*>[\s\S]*?<\/section>/g)].map(
    (match) => match[0],
  );
}

/** Adresse de chaque lien du sélecteur, dans l'ordre du rendu. */
function navHrefs(html: string): string[] {
  return [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map((match) => match[1]);
}

describe("GetiPublishDialog — deux options dans deux cadres", () => {
  it("publishDialog_open_rendersTwoLabelledOptionSections", () => {
    const html = renderDialog();

    const sections = optionSections(html);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('<h3 id="geti-publish-ours"');
    expect(sections[0]).toContain("Publier sur notre serveur");
    expect(sections[1]).toContain('<h3 id="geti-publish-geti"');
    expect(sections[1]).toContain("Publier via GETI Bot");
  });

  it("publishDialog_oursOption_linksCategoryChannelAndOurInvite", () => {
    const [ours] = optionSections(renderDialog());

    expect(ours).toMatch(
      new RegExp(`<a [^>]*href="${CHANNEL_URL}"[^>]*>Ouvrir le salon « Je cherche un scrim »<span class="sr-only"> \\(nouvel onglet\\)</span></a>`),
    );
    expect(ours).toMatch(new RegExp(`<a [^>]*href="${OUR_INVITE_URL}"[^>]*>Rejoindre le Discord BlueGenji`));
    expect(ours).not.toContain(GETI_OFFICIAL_INVITE_URL);
  });

  it("publishDialog_getiOption_integratesServerNameCountAndJoin", () => {
    const [, geti] = optionSections(renderDialog("fr", <p data-count="">3 512 membres</p>));

    expect(geti).toContain("GETI — Geeking Time");
    expect(geti).toContain('<p data-count="">3 512 membres</p>');
    expect(geti).toMatch(
      new RegExp(
        `<a [^>]*href="${GETI_OFFICIAL_INVITE_URL}"[^>]*aria-label="Rejoindre le serveur Discord GETI — Geeking Time \\(nouvel onglet\\)"[^>]*>Rejoindre</a>`,
      ),
    );
    expect(geti).not.toContain(CHANNEL_URL);
  });

  it("publishDialog_noCount_rendersServerNameOnly", () => {
    const [, geti] = optionSections(renderDialog());

    expect(geti).toContain("GETI — Geeking Time");
    expect(geti).not.toContain("membres");
  });

  it("publishDialog_english_rendersEnglishTitles", () => {
    const html = renderDialog("en");

    const [ours, geti] = optionSections(html);
    expect(ours).toContain("Post on our server");
    expect(ours).toContain("Open the “Looking for a scrim” channel");
    expect(geti).toContain("Post via GETI Bot");
    expect(geti).toContain('aria-label="Join the GETI — Geeking Time Discord server (new tab)"');
    expect(html).not.toContain("Publier");
  });

  it("publishDialog_externalLinks_openInNewTabWithoutOpener", () => {
    const html = renderDialog();

    const links = [...html.matchAll(/<a [^>]*>/g)].map((match) => match[0]);
    expect(links).toHaveLength(3);
    for (const link of links) expect(link).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it("publishDialog_source_keepsModalRules", () => {
    const source = readSource("components/geti/GetiPublishButton.tsx");

    expect(source).toContain("createPortal(");
    expect(source).toContain("document.body");
    expect(source).toContain("useDialogBehavior({ open: true, onClose })");
    expect(source).toContain("useBackdropDismiss(onClose)");
    expect(source).toContain('aria-modal="true"');
    expect(source).not.toContain("<GetiOfficialCard");
    expect(source).not.toContain("lib/server");
  });
});

describe("GetiCategoryNav — sélecteur de catégorie", () => {
  it("categoryNav_default_listsSixLinksDefaultFirst", () => {
    const html = renderNav("lfs", COUNTS);

    expect(navHrefs(html)).toEqual([
      "/geti-info/lfs",
      "/geti-info/lfp",
      "/geti-info/lft",
      "/geti-info/lfsub",
      "/geti-info/lfstaff",
      "/geti-info/lfcast",
    ]);
    expect(html).toContain('<nav class="tabs" aria-label="Je cherche">');
    expect(html).toContain("Je cherche :");
  });

  it("categoryNav_current_marksAriaCurrentOnlyOnIt", () => {
    const html = renderNav("lfstaff", COUNTS);

    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*href="\/geti-info\/lfstaff"|<a [^>]*href="\/geti-info\/lfstaff"[^>]*aria-current="page"/);
  });

  it("categoryNav_severalPosts_rendersNumberAndSpokenPlural", () => {
    const html = renderNav("lfs", COUNTS);

    expect(html).toContain('<span aria-hidden="true">12</span><span class="sr-only">, 12 annonces</span>');
  });

  it("categoryNav_onePost_speaksSingular", () => {
    const html = renderNav("lfs", COUNTS);

    expect(html).toContain('<span aria-hidden="true">1</span><span class="sr-only">, 1 annonce</span>');
  });

  it("categoryNav_nullCounts_rendersNoCount", () => {
    const html = renderNav("lfs", null);

    expect(html).not.toContain("tabCount");
    expect(html).not.toContain("annonce");
    expect(navHrefs(html)).toHaveLength(6);
  });

  it("categoryNav_english_usesEnPathsAndLabels", () => {
    const html = renderNav("lfs", COUNTS, "en");

    expect(navHrefs(html)[0]).toBe("/en/geti-info/lfs");
    expect(html).toContain('<nav class="tabs" aria-label="Looking for">');
    expect(html).toContain("Looking for:");
    expect(html).toContain('<span class="tabName">Scrims</span>');
    expect(html).toContain('<span class="sr-only">, 12 posts</span>');
  });

  it("categoryNav_icons_areHiddenFromAssistiveTech", () => {
    const html = renderNav("lfs", null);

    expect(html.match(/<span class="tabIcon" aria-hidden="true"><svg/g)).toHaveLength(6);
  });
});

describe("catégorie par défaut", () => {
  it("getiDefaultCategory_isScrims_andOrderStartsWithIt", () => {
    expect(GETI_DEFAULT_CATEGORY).toBe("lfs");
    expect(GETI_CATEGORY_ORDER).toEqual(["lfs", "lfp", "lft", "lfsub", "lfstaff", "lfcast"]);
    expect(GETI_DEFAULT_LIST_PATH).toBe("/geti-info/lfs");
    expect(getiCategoryPath(GETI_DEFAULT_CATEGORY)).toBe(GETI_DEFAULT_LIST_PATH);
  });

  it("getiInfoPage_bareAddress_rendersTheDefaultCategory", () => {
    const source = readSource("app/geti-info/page.tsx");

    expect(source).toContain("getiCategoryMetadata(GETI_DEFAULT_CATEGORY)");
    expect(source).toContain("<GetiInfoView category={GETI_DEFAULT_CATEGORY}");
  });
});

describe("getiCategoryMetadata — aperçu d'un lien collé", () => {
  it("getiCategoryMetadata_frenchScrims_describesTheCategory", async () => {
    jest.mocked(requestLocale).mockResolvedValue("fr");

    const metadata = await getiCategoryMetadata("lfs");

    expect(metadata.title).toBe("Annonces GETI — Je cherche un scrim");
    expect(metadata.robots).toEqual(GETI_ROBOTS);
    expect(metadata.alternates?.canonical).toBe("/geti-info/lfs");
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      siteName: "BlueGenji Esport",
      locale: "fr_FR",
      title: "Annonces GETI — Je cherche un scrim · BlueGenji Esport",
      description: frGeti.categories.lfs.lede,
      url: "/geti-info/lfs",
      images: [{ url: "/og/fr/geti-lfs.png", width: 1200, height: 630, alt: "Je cherche un scrim · BlueGenji Esport" }],
    });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", images: ["/og/fr/geti-lfs.png"] });
  });

  it("getiCategoryMetadata_englishCast_usesEnglishTextAndCard", async () => {
    jest.mocked(requestLocale).mockResolvedValue("en");

    const metadata = await getiCategoryMetadata("lfcast");

    expect(metadata.title).toBe("GETI posts — Looking for a cast");
    expect(metadata.alternates?.canonical).toBe("/en/geti-info/lfcast");
    expect(metadata.openGraph).toMatchObject({
      locale: "en_US",
      description: enGeti.categories.lfcast.lede,
      url: "/en/geti-info/lfcast",
      images: [{ url: "/og/en/geti-lfcast.png", width: 1200, height: 630, alt: "Looking for a cast · BlueGenji Esport" }],
    });
  });
});

describe("feuille de style", () => {
  const css = readSource("components/geti/geti.module.css");

  it("alertButton_insideInfoHintRow_keepsItsFlexBox", () => {
    expect(css).toContain(".headActions button.alertOpen {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;");
    expect(css).toContain(".headActions {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;");
  });

  it("options_narrowDialog_stackInOneColumn", () => {
    expect(css).toContain(".options {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(css).toContain("@media (max-width: 700px) {\n  .options {\n    grid-template-columns: minmax(0, 1fr);");
  });

  it("categorySelector_grid_goesSixThenThreeThenTwoColumns", () => {
    expect(css).toContain(".tabList {\n  display: grid;\n  grid-template-columns: repeat(6, minmax(0, 1fr));");
    expect(css).toContain("@media (max-width: 1100px) {\n  .tabList {\n    grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(css).toContain(".tabList {\n    grid-template-columns: repeat(2, minmax(0, 1fr));");
  });

  it("touchTargets_dialogAndSelector_reach44px", () => {
    expect(css).toMatch(/\.tab \{[^}]*min-height: 56px;/);
    expect(css).toMatch(/\.optionAction \{[^}]*min-height: 44px;/);
    expect(css).toMatch(/\.modalClose \{[^}]*width: 44px;\s+height: 44px;/);
    expect(css).toMatch(/\.publishClose \{[^}]*min-height: 44px;/);
  });
});
