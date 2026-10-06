import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Lot 5b : `/association`, `/benevoles`, `/recrutement` (et la redirection
 * `/partenaires`) en français et en anglais — `docs/features/I18N.md`
 * § Association, bénévoles, recrutement. Services simulés ; le contenu du
 * staff mêle des lignes traduites et des lignes d'avant le lot (sans anglais),
 * que la page anglaise ne doit pas rendre.
 */
let mockLocale: "fr" | "en" = "en";
let mockUser: ReturnType<typeof authUserForMock> | null = null;

function authUserForMock() {
  const { authUser } = jest.requireActual<typeof import("../helpers/auth-user")>("../helpers/auth-user");
  return authUser({ id: 1, isAdmin: true });
}

jest.mock("next/navigation", () => ({
  usePathname: () => "/association",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  permanentRedirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
jest.mock("@/components/cyber/landing/PublicPageShell", () => ({
  PublicPageShell: ({ children }: { children: unknown }) => children,
}));
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn(async () => mockUser) }));
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://bluegenji.test" }));
jest.mock("@/lib/server/site-copy-service", () => {
  const { defaultSiteCopy } = jest.requireActual<typeof import("@/lib/shared/site-copy")>("@/lib/shared/site-copy");
  return { getSiteCopy: jest.fn(async (locale: "fr" | "en") => defaultSiteCopy(locale)), getSiteCopyEditor: jest.fn(async () => null) };
});
jest.mock("@/lib/server/bureau-service", () => ({
  listBureauMembers: jest.fn(async () => [
    { id: 1, name: "Léo Perreaut", role: "Président", roleEn: "President", initials: "LP", color: "c" },
    { id: 2, name: "Bryan Boulleaux", role: "Trésorier", roleEn: null, initials: "BB", color: "c" },
  ]),
}));
jest.mock("@/lib/server/about-stats-service", () => ({
  listAboutStats: jest.fn(async () => [
    { id: 1, value: "12", label: "Arbitres", labelEn: "Referees" },
    { id: 2, value: "0 €", label: "Frais d'inscription", labelEn: null },
  ]),
}));
jest.mock("@/lib/server/about-pillars-service", () => ({
  listAboutPillars: jest.fn(async () => [
    { id: 1, title: "Accessible", text: "Inscription gratuite.", titleEn: "Accessible", textEn: "Free registration." },
    { id: 2, title: "Compétitif", text: "Tableaux arbitrés.", titleEn: null, textEn: null },
  ]),
}));
jest.mock("@/lib/server/benevoles-service", () => ({
  listBenevoles: jest.fn(async () => [
    { id: 1, firstName: "Marie", pseudo: null, lastName: "Dupont", category: "Arbitre", categoryEn: "Referee", photoUrl: null, joinedAt: "2024-03-15" },
    { id: 2, firstName: "Paul", pseudo: null, lastName: "Martin", category: "Arbitre", categoryEn: null, photoUrl: null, joinedAt: "2024-04-01" },
    { id: 3, firstName: "Zoé", pseudo: null, lastName: "Bernard", category: "Développeuse", categoryEn: null, photoUrl: null, joinedAt: "2024-05-01" },
  ]),
}));
jest.mock("@/lib/server/recruitment-service", () => ({
  listRecruitmentAds: jest.fn(async () => [
    {
      id: 1,
      title: "Arbitres pour le dimanche",
      titleEn: "Referees for Sundays",
      roles: "Arbitrer les matchs",
      rolesEn: "Referee matches",
      body: "Deux tournois par mois.",
      bodyEn: "Two tournaments a month.",
      teamName: "Pôle arbitrage",
      domain: "ARBITRAGE",
      contactUrl: "https://example.com/apply",
      contactDiscord: "arbitrage_bg",
      contactDiscordId: null,
      contactPreferred: "AUTO",
      priority: "PRIORITY",
      active: true,
    },
    {
      id: 2,
      title: "Annonce d'avant la traduction",
      titleEn: null,
      roles: null,
      rolesEn: null,
      body: "Saisie en français seulement.",
      bodyEn: null,
      teamName: null,
      domain: "COMMUNICATION",
      contactUrl: null,
      contactDiscord: null,
      contactDiscordId: null,
      contactPreferred: "AUTO",
      priority: "OPTIONAL",
      active: true,
    },
  ]),
  getRecruiterContactDefaults: jest.fn(async () => ({ discord: null, discordId: null })),
}));

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import AssociationPage, { generateMetadata as associationMetadata } from "@/app/association/page";
import BenevolesPage, { generateMetadata as volunteersMetadata } from "@/app/benevoles/page";
import PartenairesPage from "@/app/partenaires/page";
import RecrutementPage, { generateMetadata as recruitmentMetadata } from "@/app/recrutement/page";
import { RecruitmentHighlight } from "@/components/recruitment-highlight";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { RecruitmentTextProvider } from "@/components/i18n/recruitment-text";
import { ToastProvider } from "@/components/ui/toast";
import { messagesFor } from "@/lib/server/i18n-messages";
import { MIGRATED_ROUTES } from "@/lib/shared/i18n-routes";
import { isMigratedRoute, localeHref, LOCALES, SITE_TIME_ZONE, type Locale } from "@/lib/shared/locales";
import { formatMessage } from "@/lib/shared/message-format";
import { RECRUITMENT_DOMAIN_LABELS, localizeRecruitmentAds, type RecruitmentAd } from "@/lib/shared/recruitment";
import { recruitmentClientMessages } from "@/lib/shared/recruitment-text";
import { localizedSitemapEntries, publicSitemapRoutes } from "@/lib/shared/sitemap";
import { listBenevoles } from "@/lib/server/benevoles-service";
import { listBureauMembers } from "@/lib/server/bureau-service";
import { listRecruitmentAds } from "@/lib/server/recruitment-service";

async function render(page: () => Promise<unknown>, locale: Locale): Promise<string> {
  mockLocale = locale;
  const tree = (await page()) as ReactElement;
  return renderToStaticMarkup(
    <AppLocaleProvider locale={locale}>
      <ToastProvider>{tree}</ToastProvider>
    </AppLocaleProvider>,
  );
}

/** Texte lu : contenu visible et attributs lus par un lecteur d'écran ou une infobulle. */
function readable(markup: string): string {
  const withoutScripts = markup.replace(/<script[\s\S]*?<\/script>/g, " ");
  const attributes = [...withoutScripts.matchAll(/(?:aria-label|title|alt|placeholder|data-label)="([^"]*)"/g)].map((m) => m[1]);
  return `${withoutScripts.replace(/<[^>]+>/g, " ")} ${attributes.join(" ")}`
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
}

/** Le texte d'un élément `lang="fr"` (contrôles du staff, D4) n'est pas un oubli de traduction. */
function stripFrenchMarked(markup: string): string {
  let previous = "";
  let current = markup;
  while (current !== previous) {
    previous = current;
    current = current.replace(/<(\w+)[^>]*\slang="fr"[^>]*>(?:(?!<\1[\s>])[\s\S])*?<\/\1>/g, " ");
  }
  return current;
}

type Tree = { [key: string]: string | Tree };
function leaves(tree: unknown, prefix = ""): { key: string; source: string }[] {
  return typeof tree === "string"
    ? [{ key: prefix, source: tree }]
    : Object.entries(tree as Tree).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
}

/** Phrases françaises d'un espace que l'anglais a réécrites (sans arguments). */
function frenchOnly(namespace: "association" | "volunteers" | "recruitment"): string[] {
  const en = new Set(leaves(messagesFor("en")[namespace]).map((leaf) => leaf.source));
  return leaves(messagesFor("fr")[namespace])
    .map((leaf) => leaf.source)
    .filter((text) => !en.has(text) && !/[{}]/.test(text) && text.length >= 6);
}

const FRENCH_LETTERS = /[àâçéèêëîïôûùœ«»]/i;

beforeEach(() => {
  mockLocale = "en";
  mockUser = null;
});

describe("liste blanche — la vitrine est traduite", () => {
  it("ouvre /en/association, /en/benevoles, /en/recrutement et la redirection /en/partenaires", () => {
    for (const route of ["/association", "/benevoles", "/recrutement", "/partenaires"]) {
      expect(MIGRATED_ROUTES).toContain(route);
      expect(isMigratedRoute(route)).toBe(true);
    }
    expect(localeHref("/recrutement#annonce-3", "en")).toBe("/en/recrutement#annonce-3");
  });

  it("leur donne leurs entrées anglaises au sitemap, avec leurs hreflang", () => {
    const entries = localizedSitemapEntries(publicSitemapRoutes());
    for (const route of ["/association", "/benevoles", "/recrutement"]) {
      const languages = { fr: route, en: `/en${route}`, "x-default": route };
      expect(entries).toContainEqual(expect.objectContaining({ path: `/en${route}`, languages }));
      expect(entries).toContainEqual(expect.objectContaining({ path: route, languages }));
    }
  });

  it("/partenaires mène à la section des partenaires de l'accueil, dans sa langue", async () => {
    mockLocale = "fr";
    await expect(PartenairesPage()).rejects.toThrow("NEXT_REDIRECT /#sponsors");
    mockLocale = "en";
    await expect(PartenairesPage()).rejects.toThrow("NEXT_REDIRECT /en#sponsors");
  });
});

describe("métadonnées par langue — carte d'aperçu anglaise", () => {
  it.each([
    ["association", associationMetadata, "/association", "The Esports Association"],
    ["volunteers", volunteersMetadata, "/benevoles", "Volunteers"],
    ["recruitment", recruitmentMetadata, "/recrutement", "Recruitment"],
  ])("%s", async (card, metadataOf, path, title) => {
    mockLocale = "en";
    const en = await metadataOf();
    expect(en.title).toBe(title);
    expect(String(en.description)).not.toMatch(FRENCH_LETTERS);
    expect(en.alternates).toEqual({ canonical: `/en${path}`, languages: { fr: path, en: `/en${path}`, "x-default": path } });
    expect(en.openGraph).toMatchObject({ locale: "en_US", url: `/en${path}` });
    expect(JSON.stringify(en.openGraph)).toContain(`/og/en/${card}.png`);

    mockLocale = "fr";
    const fr = await metadataOf();
    expect(fr.alternates?.canonical).toBe(path);
    expect(fr.openGraph).toMatchObject({ locale: "fr_FR" });
    expect(String(fr.description)).toBe(messagesFor("fr")[card === "association" ? "association" : card === "volunteers" ? "volunteers" : "recruitment"].meta.description);
  });
});

describe("rendu anglais — aucune phrase française, contenu du staff sans anglais masqué", () => {
  it("/en/association", async () => {
    const html = await render(AssociationPage, "en");
    const text = readable(html);
    for (const french of frenchOnly("association")) expect(text).not.toContain(french);
    expect(text).not.toMatch(/Président|Trésorier|Frais d'inscription|Compétitif/);
    expect(text).toContain("President");
    expect(text).toContain("Léo Perreaut");
    expect(text).not.toContain("Bryan Boulleaux");
    expect(text).toContain("Referees");
    expect(text).toContain("Free registration.");
    expect(text).toContain("1 MEMBER · VOLUNTEERS");
    expect(text).toContain("French nonprofit (law of 1901)");
    expect(text).toContain("Articles of association");
    expect(html).toContain('hrefLang="fr"');
    // Noms propres : « Léo », « Janvilliers » ; aucune autre lettre accentuée.
    expect(text.replace(/Léo|Perreaut/g, "")).not.toMatch(FRENCH_LETTERS);
    expect(html).toContain('href="/en/connexion"');
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(ld).toContain("A French nonprofit (law of 1901), BlueGenji Esport");
  });

  it("/en/benevoles : une catégorie se lit en anglais dès qu'un de ses bénévoles l'est", async () => {
    const text = readable(await render(BenevolesPage, "en"));
    for (const french of frenchOnly("volunteers")) expect(text).not.toContain(french);
    expect(text).toContain("Referee");
    // Paul n'a pas d'anglais à lui, mais sa catégorie en a un (Marie) : il est rendu.
    expect(text).toContain("Paul");
    expect(text).not.toContain("Zoé");
    expect(text).not.toContain("Développeuse");
    expect(text).toContain("2 VOLUNTEERS · 1 CATEGORY");
    expect(text).toContain("Since Mar 15, 2024");
    expect(text.replace(/Zoé/g, "")).not.toMatch(FRENCH_LETTERS);
  });

  it("/en/recrutement : les annonces traduites seulement, dans leur anglais", async () => {
    const html = await render(RecrutementPage, "en");
    const text = readable(html);
    for (const french of frenchOnly("recruitment")) expect(text).not.toContain(french);
    expect(text).toContain("Referees for Sundays");
    expect(text).toContain("Tasks: Referee matches");
    expect(text).toContain("Refereeing");
    expect(text).toContain("Urgent");
    expect(text).not.toContain("Annonce d'avant la traduction");
    expect(text).toContain("1 OPENING");
    // Le référent est saisi en français, sans anglais : annoncé lang="fr", seule exception tolérée.
    expect(html).toMatch(/lang="fr"[^>]*>Pôle arbitrage</);
    expect(text.replace(/Pôle arbitrage/g, "")).not.toMatch(FRENCH_LETTERS);
  });

  it("la gestion sous /en reste en français, annoncée lang=fr", async () => {
    mockUser = authUserForMock();
    const html = await render(AssociationPage, "en");
    const stripped = readable(stripFrenchMarked(html));
    expect(html).toMatch(/lang="fr"[^>]*>\+ Ajouter/);
    expect(stripped).not.toContain("Modifier");
    expect(stripped).not.toContain("Supprimer");
  });

  it("sous /en, pas de flèches d'ordre : un voisin sans anglais y est masqué (l'ordre se règle en français)", async () => {
    mockUser = authUserForMock();
    expect(await render(AssociationPage, "en")).not.toMatch(/aria-label="Déplacer /);
    expect(await render(AssociationPage, "fr")).toMatch(/aria-label="Déplacer /);
  });
});

describe("rendu anglais — rien encore traduit : le dire, sans « 0 » ni « aucun »", () => {
  it("/en/association : le bureau annonce sa version anglaise, sans compteur à zéro", async () => {
    jest.mocked(listBureauMembers).mockResolvedValueOnce([
      { id: 2, name: "Bryan Boulleaux", role: "Trésorier", roleEn: null, initials: "BB", color: "c" },
    ]);
    const text = readable(await render(AssociationPage, "en"));
    expect(text).toContain("The English version of the board is on its way.");
    expect(text).not.toContain("0 MEMBERS");
  });

  it("/en/benevoles : ni « 0 VOLUNTEERS » ni « No volunteers yet », et pas d'« ajouter le premier » au staff", async () => {
    mockUser = authUserForMock();
    jest.mocked(listBenevoles).mockResolvedValueOnce([
      { id: 3, firstName: "Zoé", pseudo: null, lastName: "Bernard", category: "Développeuse", categoryEn: null, photoUrl: null, joinedAt: "2024-05-01" },
    ]);
    const text = readable(await render(BenevolesPage, "en"));
    expect(text).toContain("The English version of this list is on its way.");
    expect(text).not.toContain("No volunteers yet.");
    expect(text).not.toContain("0 VOLUNTEERS");
    expect(text).not.toContain("Ajouter le premier bénévole");
  });

  it("/en/recrutement : les annonces arrivent, au lieu de « aucun poste » ou « aucune urgence »", async () => {
    mockUser = authUserForMock();
    const all = await listRecruitmentAds();
    jest.mocked(listRecruitmentAds).mockResolvedValueOnce(all.filter((ad) => ad.titleEn === null));
    const text = readable(await render(RecrutementPage, "en"));
    expect(text).toContain("Our openings are being translated into English.");
    expect(text).not.toContain("No open staff positions right now.");
    expect(text).not.toContain("0 OPENINGS");
    expect(text).not.toContain("Publier la première annonce");

    jest.mocked(listRecruitmentAds).mockResolvedValueOnce([
      ...all.filter((ad) => ad.titleEn !== null).map((ad) => ({ ...ad, priority: "OPTIONAL" as const })),
      ...all.filter((ad) => ad.titleEn === null).map((ad) => ({ ...ad, priority: "PRIORITY" as const })),
    ]);
    const partial = readable(await render(RecrutementPage, "en"));
    expect(partial).not.toContain("No urgent openings right now.");
    expect(partial).toContain("Our openings are being translated into English.");

    // Masquée mais facultative : « aucune urgence » reste vrai, des annonces anglaises suivent.
    jest.mocked(listRecruitmentAds).mockResolvedValueOnce(all.map((ad) => ({ ...ad, priority: "OPTIONAL" as const })));
    const optional = readable(await render(RecrutementPage, "en"));
    expect(optional).toContain("No urgent openings right now.");
    expect(optional).not.toContain("Our openings are being translated into English.");
  });

  it("/en/recrutement : les contrôles du staff (lang=fr) nomment l'annonce par son titre français", async () => {
    mockUser = authUserForMock();
    const html = await render(RecrutementPage, "en");
    expect(html).toContain('aria-label="Modifier Arbitres pour le dimanche"');
    expect(html).toContain('aria-label="Supprimer Arbitres pour le dimanche"');
    expect(html).not.toContain("Modifier Referees for Sundays");
  });

  it("/en/recrutement : le statut « Inactif » (vu du seul staff) reste en français, annoncé lang=fr", async () => {
    mockUser = authUserForMock();
    const all = await listRecruitmentAds();
    jest.mocked(listRecruitmentAds).mockResolvedValueOnce(all.map((ad) => ({ ...ad, active: false })));
    const html = await render(RecrutementPage, "en");
    expect(html).toMatch(/lang="fr"[^>]*>Inactif</);
    expect(readable(html)).not.toContain("Inactive");
  });

  it("/en/recrutement : pas de flèches d'ordre pour le staff (une annonce masquée fausserait l'échange)", async () => {
    mockUser = authUserForMock();
    expect(await render(RecrutementPage, "en")).not.toMatch(/aria-label="(Monter|Descendre) l&#x27;annonce/);
    expect(await render(RecrutementPage, "fr")).toMatch(/aria-label="(Monter|Descendre) l&#x27;annonce/);
  });
});

describe("rendu français — inchangé, tout le contenu du staff", () => {
  it("/association", async () => {
    const text = readable(await render(AssociationPage, "fr"));
    for (const french of [
      "FONDÉE EN",
      "Association loi 1901",
      "Manifeste",
      "Raison d'être",
      "2 MEMBRES · BÉNÉVOLES",
      "Trésorier",
      "Frais d'inscription",
      "Compétitif",
      "Télécharger le bulletin →",
      "Statuts de l'association",
    ]) {
      expect(text).toContain(french);
    }
  });

  it("/benevoles", async () => {
    const text = readable(await render(BenevolesPage, "fr"));
    for (const french of ["L'ÉQUIPE · BÉNÉVOLES", "3 BÉNÉVOLES · 2 CATÉGORIES", "Développeuse", "Depuis le 15/03/2024"]) {
      expect(text).toContain(french);
    }
  });

  it("/recrutement", async () => {
    const text = readable(await render(RecrutementPage, "fr"));
    for (const french of [
      "L'asso recrute",
      "Recrutement en cours",
      "Missions : Arbitrer les matchs",
      "Arbitrage",
      "Urgente",
      "Autres recrutements",
      "Annonce d'avant la traduction",
      "2 ANNONCES",
    ]) {
      expect(text).toContain(french);
    }
  });

  it("la gestion marque EN le contenu qui attend son anglais", async () => {
    mockUser = authUserForMock();
    const html = await render(AssociationPage, "fr");
    expect(html).toContain('aria-label="Modifier Bryan Boulleaux (EN à rédiger)"');
    expect(html).toContain('aria-label="Modifier Léo Perreaut"');
    const recruitment = await render(RecrutementPage, "fr");
    expect(recruitment).toContain("(EN à rédiger)");
  });
});

describe("mise en avant du recrutement — dans la langue de la page", () => {
  const ads = (locale: Locale): RecruitmentAd[] =>
    localizeRecruitmentAds(
      [
        {
          id: 1,
          title: "Arbitres",
          titleEn: "Referees",
          roles: null,
          rolesEn: null,
          body: "Le dimanche.",
          bodyEn: "On Sundays.",
          // Référent saisi en français : absent du résumé anglais.
          teamName: "Pôle arbitrage",
          domain: "ARBITRAGE",
          contactUrl: null,
          contactDiscord: null,
          contactDiscordId: null,
          contactPreferred: "AUTO",
          priority: "PRIORITY",
          active: true,
        },
      ],
      locale,
    );

  function highlight(locale: Locale): string {
    return renderToStaticMarkup(
      <AppLocaleProvider locale={locale}>
        <RecruitmentTextProvider
          locale={locale}
          messages={locale === "fr" ? undefined : recruitmentClientMessages(messagesFor(locale).recruitment)}
        >
          <RecruitmentHighlight
            modalAds={ads(locale)}
            modalSilenced={false}
            modalSeen={[]}
            bannerAds={ads(locale)}
            bannerDismissed={false}
            onAdPage={false}
          />
        </RecruitmentTextProvider>
      </AppLocaleProvider>,
    );
  }

  it("anglais : banderole et modale en anglais, liens sous /en, sans lang=fr", () => {
    const html = highlight("en");
    const text = readable(html);
    expect(text).toContain("Referees");
    expect(text).toContain("Recruitment openings");
    expect(text).toContain("View the opening: Referees");
    expect(text).toContain("Read the opening →");
    expect(html).toContain('href="/en/recrutement#annonce-1"');
    expect(html).not.toContain('lang="fr"');
    expect(text).not.toMatch(FRENCH_LETTERS);
  });

  it("français : inchangé", () => {
    const text = readable(highlight("fr"));
    expect(text).toContain("Voir l'annonce : Arbitres");
    expect(text).toContain("Plus tard");
    expect(text).toContain("Arbitrage");
    expect(text).toContain("Pôle arbitrage · Arbitrage");
  });
});

describe("messages — équivalence avec next-intl et tables françaises", () => {
  it.each(LOCALES.map((locale) => [locale]))("%s : chaque message formaté comme next-intl", (locale) => {
    for (const namespace of ["association", "volunteers", "recruitment"] as const) {
      for (const { key, source } of leaves(messagesFor(locale)[namespace])) {
        const reference = createTranslator({ locale, messages: { m: source }, timeZone: SITE_TIME_ZONE });
        for (const count of [0, 1, 2]) {
          const values = { count, categories: count, shown: 1, roles: "R", title: "T", value: "V", date: "D", position: 1 };
          expect(`${namespace}.${key}: ${formatMessage(locale, source, values)}`).toBe(
            `${namespace}.${key}: ${reference("m", values)}`,
          );
        }
      }
    }
  });

  it("les pôles français reprennent la table partagée (éditeur du staff)", () => {
    expect(messagesFor("fr").recruitment.domains).toEqual(RECRUITMENT_DOMAIN_LABELS);
  });
});
