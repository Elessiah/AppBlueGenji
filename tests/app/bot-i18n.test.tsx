import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Lot 5a : `/bot` et `/bot/docs` en français et en anglais (`docs/features/I18N.md`
 * § Bot). La langue vient de `x-bg-locale` (`requestLocale()`), simulée ici ;
 * l'en-tête et le pied de page communs ont leurs propres tests.
 */
let mockLocale: "fr" | "en" = "en";
const BOT_DIR_PROMISE = mkdtemp(path.join(tmpdir(), "bg-bot-docs-"));
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn(async () => null) }));
jest.mock("@/lib/server/bot-showcase-cache", () => ({
  cachedBotStatus: jest.fn(),
  cachedBotKpis: jest.fn(),
  cachedBotServers: jest.fn(),
  cachedBotActivity: jest.fn(),
}));
jest.mock("@/components/cyber/landing/PublicHeader", () => ({ PublicHeader: () => null }));
jest.mock("@/components/cyber/landing/PublicFooter", () => ({ PublicFooter: () => null }));
jest.mock("next/navigation", () => ({
  usePathname: () => "/bot",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import BotPage, { generateMetadata } from "@/app/bot/page";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { BotStatusStrip } from "@/components/bot/BotStatusStrip";
import { BotTextProvider } from "@/components/i18n/bot-text";
import { getCurrentUser } from "@/lib/server/auth";
import {
  cachedBotActivity,
  cachedBotKpis,
  cachedBotServers,
  cachedBotStatus,
} from "@/lib/server/bot-showcase-cache";
import { messagesFor } from "@/lib/server/i18n-messages";
import { botClientMessages, botText } from "@/lib/shared/bot-text";
import { BOT_DOC_SECTIONS, botDocFile, botDocLanguage, LEGACY_BOT_DOC_REDIRECTS } from "@/lib/shared/bot-doc-sections";
import { DISCORD_PERMISSIONS, decodeDiscordPermissions } from "@/lib/shared/discord-permissions";
import { MIGRATED_ROUTES } from "@/lib/shared/i18n-routes";
import { isMigratedRoute, localeHref, LOCALES, SITE_TIME_ZONE, type Locale } from "@/lib/shared/locales";
import { formatMessageParts } from "@/lib/shared/message-format";
import { localizedSitemapEntries, publicSitemapRoutes } from "@/lib/shared/sitemap";
import type { BotActivity, BotKpis, BotServersPayload, BotStatus } from "@/lib/shared/types";
import { authUser } from "../helpers/auth-user";

const STATUS: BotStatus = {
  startupTs: Date.now() - 90_061_000,
  uptimeMs: 90_061_000,
  version: "2.4.0",
  buildHash: "abcdef",
  buildDate: "2026-10-01",
  gatewayLatency: 42,
  shardCount: { active: 1, total: 1 },
  cpuUsage: 3.5,
  ramUsage: 180,
  status: "OPERATIONAL",
};

const KPIS: BotKpis = {
  servers: { value: 12345, delta: "+3", series: [1, 2, 3] },
  channels: { value: 40, delta: "-2", series: [3, 2, 1] },
  messages: { value: 900, delta: null, series: [1, 1, 2] },
  relays: { value: 300, delta: null, series: [2, 2, 2] },
};

const SERVERS: BotServersPayload = {
  servers: [
    { id: "1", name: "Nova Esports", memberCount: 1500, relays7j: 12, status: "ok", sparkline: [1, 2], accentColor: "#5ac8ff", sigil: "NV" },
    { id: "2", name: "Lagoon", memberCount: 80, relays7j: 2, status: "lag", sparkline: [1], accentColor: "#5ac8ff", sigil: "LG" },
    { id: "3", name: "Quiet", memberCount: 20, relays7j: 0, status: "off", sparkline: [], accentColor: "#5ac8ff", sigil: "QT" },
  ],
  total: 3,
  limit: 8,
  offset: 0,
};

const ACTIVITY: BotActivity = { range: "7d", labels: ["10-01", "10-02"], relays: [3, 5], scrims: [1, 2], avgPerDay: 5.4 };

async function renderBotPage(locale: Locale): Promise<string> {
  mockLocale = locale;
  const tree = await BotPage();
  return renderToStaticMarkup(<AppLocaleProvider locale={locale}>{tree}</AppLocaleProvider>);
}

/** Le texte lu par le visiteur (et les attributs lus par un lecteur d'écran), sans balisage. */
function visibleText(html: string): string {
  const attributes = [...html.matchAll(/(?:aria-label|title|alt|data-label)="([^"]*)"/g)].map((m) => m[1]);
  return [html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " "), ...attributes]
    .join(" ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

type Tree = { [key: string]: string | Tree };
function leaves(tree: unknown, prefix = ""): { key: string; source: string }[] {
  return typeof tree === "string"
    ? [{ key: prefix, source: tree }]
    : Object.entries(tree as Tree).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
}

/** Phrases françaises du bot que l'anglais a réécrites (sans arguments ni balises). */
const FRENCH_ONLY = (() => {
  const en = new Set(leaves(messagesFor("en").bot).map((leaf) => leaf.source));
  return leaves(messagesFor("fr").bot)
    .map((leaf) => leaf.source)
    .filter((text) => !en.has(text))
    .filter((text) => !/[{}<>]/.test(text) && text.length >= 6);
})();

beforeEach(async () => {
  jest.clearAllMocks();
  mockLocale = "en";
  jest.mocked(getCurrentUser).mockResolvedValue(null);
  jest.mocked(cachedBotStatus).mockResolvedValue(STATUS);
  jest.mocked(cachedBotKpis).mockResolvedValue(KPIS);
  jest.mocked(cachedBotServers).mockResolvedValue(SERVERS);
  jest.mocked(cachedBotActivity).mockResolvedValue(ACTIVITY);
});

describe("liste blanche — le bot est traduit", () => {
  it("ouvre /en/bot et sa documentation", () => {
    for (const route of ["/bot", "/bot/docs", "/bot/docs/[slug]"]) expect(MIGRATED_ROUTES).toContain(route);
    expect(isMigratedRoute("/bot/docs/guide")).toBe(true);
    expect(localeHref("/bot/docs/guide", "en")).toBe("/en/bot/docs/guide");
    // Les pages légales du bot restent à leur adresse (lot 7a).
    expect(localeHref("/privacy-policy-bot", "en")).toBe("/privacy-policy-bot");
  });

  it("donne à /bot et au guide leur entrée anglaise au sitemap, avec leurs hreflang", () => {
    const entries = localizedSitemapEntries(publicSitemapRoutes(["guide"]));
    for (const route of ["/bot", "/bot/docs/guide"]) {
      const languages = { fr: route, en: `/en${route}`, "x-default": route };
      expect(entries).toContainEqual(expect.objectContaining({ path: route, languages }));
      expect(entries).toContainEqual(expect.objectContaining({ path: `/en${route}`, languages }));
    }
    expect(entries.map((entry) => entry.path)).not.toContain("/en/bot/docs/user-guide-en");
  });
});

describe("métadonnées par langue", () => {
  it("anglais : titre, description, canonique, hreflang et carte anglaise", async () => {
    mockLocale = "en";
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("BlueGenji Bot");
    expect(String(metadata.description)).toMatch(/^The BlueGenji Discord bot/);
    expect(metadata.alternates).toEqual({
      canonical: "/en/bot",
      languages: { fr: "/bot", en: "/en/bot", "x-default": "/bot" },
    });
    expect(metadata.openGraph).toMatchObject({ locale: "en_US", url: "/en/bot" });
    expect(JSON.stringify(metadata.openGraph)).toContain("/og/en/bot.png");
  });

  it("français : texte inchangé, carte française", async () => {
    mockLocale = "fr";
    const metadata = await generateMetadata();
    expect(String(metadata.description)).toBe(
      "Le bot Discord de BlueGenji : annonces synchronisées entre serveurs affiliés, statistiques et commandes de tournoi.",
    );
    expect(metadata.alternates?.canonical).toBe("/bot");
    expect(metadata.openGraph).toMatchObject({ locale: "fr_FR" });
    expect(JSON.stringify(metadata.openGraph)).not.toContain("/og/en/");
  });

  it("documentation : titre de section traduit", async () => {
    const { generateMetadata: docsMetadata } = await import("@/app/bot/docs/[[...slug]]/page");
    mockLocale = "en";
    const en = await docsMetadata({ params: Promise.resolve({ slug: ["guide"] }) });
    expect(en.title).toBe("User guide — Bot documentation");
    expect(en.alternates?.canonical).toBe("/en/bot/docs/guide");
    expect(JSON.stringify(en.openGraph)).toContain("/og/en/botDocs.png");
    mockLocale = "fr";
    const fr = await docsMetadata({ params: Promise.resolve({ slug: ["guide"] }) });
    expect(fr.title).toBe("Guide utilisateur — Documentation du bot");
    expect(fr.alternates?.canonical).toBe("/bot/docs/guide");
  });
});

describe("rendu anglais — aucune phrase française sous /en/bot", () => {
  it("la page entière", async () => {
    const html = await renderBotPage("en");
    const text = visibleText(html);
    expect(FRENCH_ONLY.length).toBeGreaterThan(60);
    for (const french of FRENCH_ONLY) expect(text).not.toContain(french);
    expect(text).not.toMatch(/[éèêàçùôœ]/);
    expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(text).toContain("DISCORD BOT · CROSS-SERVER");
    expect(text).toContain("Operational");
    expect(text).toContain("All services are responding");
    expect(text).toContain("3 SERVERS SHOWN");
    expect(text).toContain("Up to date — Announcements are relayed to this server without delay.");
    expect(text).toContain("Lagging");
    expect(text).toContain("Offline");
    // Nombres de la langue : « 12,345 », jamais « 12 345 ».
    expect(text).toContain("12,345");
    expect(text).toContain("/ 7d");
    expect(text).toContain("AVG. 5 / DAY");
    expect(text).toContain("Waiting for events...");
  });

  it("liens dans la langue de la page ; les pages légales du bot restent à leur adresse", async () => {
    const html = await renderBotPage("en");
    expect(html).toContain('href="/en/bot/docs"');
    expect(html).toContain('href="/en/bot/docs/guide"');
    expect(html).toContain('href="/privacy-policy-bot"');
    expect(html).not.toContain('href="/en/bot/docs/user-guide-en"');
  });

  it("le flux temps réel ne reçoit que trois espaces de messages", () => {
    const picked = botClientMessages(messagesFor("en").bot);
    expect(Object.keys(picked).sort()).toEqual(["feed", "status", "strip"]);
  });

  it("bande d'état : durée de service dans la langue du fournisseur", () => {
    const en = renderToStaticMarkup(
      <BotTextProvider locale="en" messages={botClientMessages(messagesFor("en").bot)}>
        <BotStatusStrip status={STATUS} />
      </BotTextProvider>,
    );
    expect(en).toContain("Gateway latency");
    expect(en).toContain("42 ms");
    expect(en).not.toContain("Latence passerelle");
  });
});

describe("rendu français — inchangé", () => {
  it("garde les textes d'origine", async () => {
    const html = await renderBotPage("fr");
    const text = visibleText(html);
    for (const french of [
      "BOT DISCORD · INTER-SERVEURS",
      "Inviter sur mon serveur",
      "Opérationnel",
      "Tous les services répondent",
      "3 SERVEURS AFFICHÉS",
      "À jour — Les annonces sont relayées sans délai sur ce serveur.",
      "○ Hors ligne",
      "Commandes et documentation",
      "Connecte ton serveur à la scène",
      "PERMISSIONS DEMANDÉES",
      "MOY. 5 / JOUR",
      "/ 7j",
    ]) {
      expect(text).toContain(french);
    }
    // Séparateur de milliers français (espace fine insécable).
    expect(text).toMatch(/12\s345/u);
    expect(html).toContain('href="/bot/docs"');
    expect(html).not.toContain('href="/en/');
  });
});

describe("documentation — un fichier par langue", () => {
  it("le guide sert help.md sous /en, helpfr.md en français", () => {
    const guide = BOT_DOC_SECTIONS.find((section) => section.slug === "guide");
    expect(guide).toBeDefined();
    if (!guide) return;
    expect(botDocFile(guide, "fr")).toBe("helpfr.md");
    expect(botDocFile(guide, "en")).toBe("help.md");
    expect(botDocLanguage(guide, "en")).toBe("en");
  });

  it("une page du staff sans anglais reste française sous /en, et le dit", () => {
    const staff = BOT_DOC_SECTIONS.filter((section) => section.staffOnly);
    expect(staff.length).toBeGreaterThan(0);
    for (const section of staff) {
      expect(section.fileEn).toBeUndefined();
      expect(botDocFile(section, "en")).toBe(section.file);
      expect(botDocLanguage(section, "en")).toBe("fr");
    }
  });

  it("aucune page publique ne reste sans anglais", () => {
    for (const section of BOT_DOC_SECTIONS.filter((s) => !s.staffOnly)) expect(section.fileEn).toBeDefined();
  });

  it("l'ancien guide anglais redirige vers le guide sous /en", () => {
    expect(LEGACY_BOT_DOC_REDIRECTS["user-guide-en"]).toBe("/en/bot/docs/guide");
    expect(BOT_DOC_SECTIONS.map((section) => section.slug)).not.toContain("user-guide-en");
  });
});

describe("documentation — rendu par langue", () => {
  beforeEach(async () => {
    const dir = await BOT_DIR_PROMISE;
    process.env.BOT_DOCS_PATH = dir;
    await mkdir(path.join(dir, "doc"), { recursive: true });
    await writeFile(path.join(dir, "help.md"), "# BlueGenjiBot - Help\n\nEnglish guide body.\n", "utf8");
    await writeFile(path.join(dir, "helpfr.md"), "# BlueGenjiBot - Aide\n\nGuide en français.\n", "utf8");
    await writeFile(path.join(dir, "doc/main.md"), "# Architecture\n\nClient Discord du bot.\n", "utf8");
  });

  type Render = (locale: Locale, slug?: string[]) => Promise<string>;

  /**
   * `BOT_PROJECT_DIR` est lu au chargement du module, et les documents lus sont
   * gardés une minute : chaque cas recharge la page (et son cache) avec le
   * dossier de test, et la session qu'il veut.
   */
  async function docsModule(staff = false): Promise<Render> {
    let render: Render | null = null;
    await jest.isolateModulesAsync(async () => {
      const auth = await import("@/lib/server/auth");
      jest.mocked(auth.getCurrentUser).mockResolvedValue(staff ? authUser({ isAdmin: true }) : null);
      const page = await import("@/app/bot/docs/[[...slug]]/page");
      // Rendu par le React du registre isolé : celui que lisent les composants de la page.
      const server = await import("react-dom/server");
      const { AppLocaleProvider: Provider } = await import("@/components/i18n/locale-context");
      render = async (locale, slug) => {
        mockLocale = locale;
        const tree = await page.default({ params: Promise.resolve({ slug }) });
        return server.renderToStaticMarkup(<Provider locale={locale}>{tree}</Provider>);
      };
    });
    if (!render) throw new Error("page de documentation non chargée");
    return render;
  }

  it("anglais : help.md, interface anglaise, aucun français", async () => {
    const render = await docsModule();
    const html = await render("en", ["guide"]);
    const text = visibleText(html);
    expect(text).toContain("English guide body.");
    expect(text).not.toContain("Guide en français");
    expect(text).toContain("GETTING STARTED · EN");
    expect(text).toContain("SOURCE · BLUEGENJIBOT/HELP.MD");
    expect(text).toContain("Back to the dashboard");
    expect(text).not.toMatch(/[éèêàçùôœ]/);
    expect(html).toContain('href="/en/bot"');
    expect(html).not.toContain(' lang="fr"');
  });

  it("français : helpfr.md, comme avant", async () => {
    const render = await docsModule();
    const text = visibleText(await render("fr", ["guide"]));
    expect(text).toContain("Guide en français.");
    expect(text).toContain("PRISE EN MAIN · FR");
    expect(text).toContain("Retour au dashboard");
    expect(text).toContain("SOURCE · BLUEGENJIBOT/HELPFR.MD");
  });

  it("une page du staff sous /en : corps français annoncé lang=fr, interface anglaise", async () => {
    const render = await docsModule(true);
    const html = await render("en", ["architecture"]);
    expect(html).toContain('<article class="panel" lang="fr">');
    expect(html).toContain("Client Discord du bot.");
    expect(html).toContain("Staff-only page, written in French.");
  });

  it("fichier introuvable : la phrase du site, dans la langue", async () => {
    process.env.BOT_DOCS_PATH = path.join(await BOT_DIR_PROMISE, "absent");
    const render = await docsModule();
    const text = visibleText(await render("en", ["guide"]));
    expect(text).toContain("couldn't be read from the bot project");
    expect(text).toContain("help.md");
  });

  it("l'ancienne adresse du guide anglais redirige", async () => {
    const render = await docsModule();
    await expect(render("fr", ["user-guide-en"])).rejects.toThrow("NEXT_REDIRECT /en/bot/docs/guide");
  });
});

describe("permissions Discord — libellés par langue", () => {
  it("chaque permission connue a son libellé dans les deux langues", () => {
    for (const locale of LOCALES) {
      const { permissions } = messagesFor(locale).bot;
      for (const { flag } of DISCORD_PERMISSIONS) expect(permissions[flag].length).toBeGreaterThan(0);
    }
  });

  it("décode dans la langue demandée, bit inconnu compris", () => {
    const en = botText("en", messagesFor("en").bot);
    const bitfield = (BigInt(1) << BigInt(40)) | (BigInt(1) << BigInt(47));
    expect(decodeDiscordPermissions(String(bitfield), en)).toEqual([
      { bit: 40, flag: "MODERATE_MEMBERS", label: "Time out members" },
      { bit: 47, flag: "BIT_47", label: "Unknown permission (bit 47)" },
    ]);
    expect(decodeDiscordPermissions(String(bitfield))?.[0].label).toBe("Exclure temporairement des membres");
  });
});

describe("bot — équivalence avec next-intl, message par message", () => {
  it.each(LOCALES.map((locale) => [locale]))("%s", (locale) => {
    const messages = leaves(messagesFor(locale).bot);
    expect(messages.length).toBeGreaterThan(150);
    for (const { key, source } of messages) {
      const reference = createTranslator({ locale, messages: { m: source }, timeZone: SITE_TIME_ZONE });
      for (const count of [0, 1, 2]) {
        const values = { count, file: "help.md", days: 7, hours: 3, minutes: "04", seconds: "05", value: 42, date: "2026-10-01", scopes: "BOT", bit: 47, section: "Guide" };
        const expected = reference.markup("m", { ...values, code: (chunks: string) => `<code>${chunks}</code>` });
        const actual = formatMessageParts<string>(locale, source, values, {
          code: (children) => `<code>${children.join("")}</code>`,
        }).join("");
        expect(`${key}: ${actual}`).toBe(`${key}: ${expected}`);
      }
    }
  });
});

describe("hors fournisseur — composants de tests et écrans tiers en français", () => {
  it("rend la bande d'état en français", () => {
    const html = renderToStaticMarkup(<BotStatusStrip status={STATUS} />);
    expect(html).toContain("Latence passerelle");
    expect(html).toContain("Depuis le dernier démarrage");
  });
});

