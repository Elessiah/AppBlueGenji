/**
 * Lot 8a-1 — `/tournois` sous `/en` : liste, cartes, bandeau, bouton d'aide des
 * règles, carte « Connexion requise ». Le français reste celui d'avant (rendu
 * figé des cartes : `tournament-list-cards-render.test.tsx`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactElement } from "react";

let mockLocale: "fr" | "en" = "en";
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => mockLocale }));
jest.mock("next/navigation", () => ({
  usePathname: () => "/en/tournois",
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
}));
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showError: () => undefined, showSuccess: () => undefined }),
}));
jest.mock("@/app/(secured)/_shared/BgCanvas", () => ({ BgCanvas: () => null }));

import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import TournamentsPage, { generateMetadata as pageMetadata } from "@/app/(secured)/tournois/page";
import TournamentsLayout, { generateMetadata as layoutMetadata } from "@/app/(secured)/tournois/layout";
import TournamentsList from "@/app/(secured)/tournois/TournamentsList";
import { AuthGate } from "@/app/(secured)/_shared/AuthGate";
import { FinishedCard } from "@/app/(secured)/tournois/cards/FinishedCard";
import { RegistrationCard } from "@/app/(secured)/tournois/cards/RegistrationCard";
import { RunningCard } from "@/app/(secured)/tournois/cards/RunningCard";
import { UpcomingCard } from "@/app/(secured)/tournois/cards/UpcomingCard";
import { buildTickerItems } from "@/app/(secured)/tournois/_lib/ticker";
import { formatCardDate, runningCardAction } from "@/app/(secured)/tournois/_lib/card-display";
import { filterBuckets, filterTournamentsByQuery } from "@/app/(secured)/tournois/_lib/buckets";
import { PAGE_SECTION_NAV_LABELS, PAGE_SECTION_TITLES, pageSections } from "@/app/(secured)/tournois/_lib/page-sections";
import { RulesHelpFab } from "@/components/rules/RulesHelpFab";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { TournamentsTextProvider } from "@/components/i18n/tournaments-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import { isMigratedRoute, LOCALES, SITE_TIME_ZONE } from "@/lib/shared/locales";
import { formatMessage } from "@/lib/shared/message-format";
import { PARTICIPANT_WORDING } from "@/lib/shared/participants";
import { RULE_MODE_LABELS_FR } from "@/lib/shared/rule-mode-definitions";
import { localizedSitemapEntries, publicSitemapRoutes } from "@/lib/shared/sitemap";
import { matchFormatLabel } from "@/lib/shared/match-format";
import {
  FR_TOURNAMENTS_TEXT,
  localizedMatchFormatLabel,
  tournamentLabel,
  tournamentsClientMessages,
  tournamentsText,
} from "@/lib/shared/tournaments-text";
import type { TournamentBuckets, TournamentFormat } from "@/lib/shared/types";
import { tournamentCard } from "../helpers/tournament-card";

const EN_TEXT = tournamentsText("en", tournamentsClientMessages(messagesFor("en")));

function inEnglish(ui: ReactElement): string {
  return renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <TournamentsTextProvider locale="en" messages={tournamentsClientMessages(messagesFor("en"))}>
        {ui}
      </TournamentsTextProvider>
    </AppLocaleProvider>,
  );
}

/** Le texte visible et les attributs lus (noms accessibles, infobulles, champs). */
function readable(html: string): string {
  const attributes = [...html.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g)].map((m) => m[1]);
  const text = html.replace(/<[^>]+>/g, " ");
  return `${text} ${attributes.join(" ")}`;
}

// Mots français qui ne doivent plus paraître sous `/en/tournois` (noms saisis
// exclus : les fixtures n'en portent aucun de français).
const FRENCH_WORDS = /\b(Tournois|Voir|Inscriptions?|Début|Matchs|Clôture|Remplissage|Complet|Terminé|Vainqueur|Équipes?|Joueurs?|Prochainement|Rechercher|Aucun|Détails|Statut|Règles|Déroulement|équipes|joueurs|Connexion|Retour)\b/;
const ACCENTED = /[À-ÿ]/;

beforeAll(() => {
  jest.useFakeTimers({ now: new Date("2026-05-05T10:00:00.000Z") });
});
afterAll(() => {
  jest.useRealTimers();
});
beforeEach(() => {
  mockLocale = "en";
});

const DATES = {
  startVisibilityAt: "2026-05-01T10:00:00.000Z",
  registrationOpenAt: "2026-05-02T10:00:00.000Z",
  registrationCloseAt: "2026-05-10T10:00:00.000Z",
  startAt: "2026-05-12T10:00:00.000Z",
};

describe("route et référencement", () => {
  it("ouvre /tournois sous /en, ni la création ni les fiches (lot 8a-2)", () => {
    expect(isMigratedRoute("/tournois")).toBe(true);
    expect(isMigratedRoute("/tournois/creer")).toBe(false);
    expect(isMigratedRoute("/tournois/12/modifier")).toBe(false);
  });

  it("reste hors du sitemap dans les deux langues (noindex)", () => {
    const paths = localizedSitemapEntries(publicSitemapRoutes()).map((entry) => entry.path);
    expect(paths.some((path) => path.includes("/tournois"))).toBe(false);
  });

  it.each(LOCALES.map((locale) => [locale]))("%s : titre, canonique et hreflang réciproques", async (locale) => {
    mockLocale = locale;
    const metadata = await pageMetadata();
    expect(metadata.title).toBe(locale === "en" ? "Tournaments" : "Tournois");
    expect(metadata.alternates).toEqual({
      canonical: locale === "en" ? "/en/tournois" : "/tournois",
      languages: { fr: "/tournois", en: "/en/tournois", "x-default": "/tournois" },
    });
  });

  it("encart et titre de segment dans la langue de l'adresse", async () => {
    const en = await layoutMetadata();
    expect(en.title).toEqual(expect.objectContaining({ default: "Tournaments" }));
    expect(JSON.stringify(en.openGraph)).toContain("/og/en/tournaments.png");
    expect(JSON.stringify(en.openGraph)).toContain("en_US");
    mockLocale = "fr";
    const fr = await layoutMetadata();
    expect(fr.title).toEqual(expect.objectContaining({ default: "Tournois" }));
    expect(JSON.stringify(fr.openGraph)).toContain("/og/fr/tournaments.png");
  });
});

describe("mise en page — dictionnaire du navigateur", () => {
  it("sous /en, ne sérialise que les espaces client (ni `meta`)", async () => {
    const html = renderToStaticMarkup(await TournamentsLayout({ children: <TournamentsList /> }));
    expect(html).toContain("Search for a tournament");
    const client = tournamentsClientMessages(messagesFor("en"));
    expect(Object.keys(client).sort((a, b) => a.localeCompare(b))).toEqual(
      ["cards", "labels", "list", "matchFormat", "participants", "rulesHelp", "ticker", "tickerControls"],
    );
    expect(JSON.stringify(client).length).toBeLessThan(10_000);
  });

  it("en français, rien n'est passé : le texte est celui du paquet", async () => {
    mockLocale = "fr";
    const layout = await TournamentsLayout({ children: <TournamentsList /> });
    expect((layout.props as { messages?: unknown }).messages).toBeUndefined();
    expect(renderToStaticMarkup(layout)).toContain("Rechercher un tournoi");
  });
});

describe("page — rendu anglais", () => {
  it("n'a plus un mot de français, liens dans la langue de la page", () => {
    const html = inEnglish(<TournamentsPage />);
    const text = readable(html);
    expect(text).not.toMatch(FRENCH_WORDS);
    expect(text).not.toMatch(ACCENTED);
    expect(html).toContain("<em");
    expect(text).toContain("PLATFORM · TOURNAMENTS");
    expect(text).toContain("No tournaments");
    expect(text).toContain("No tournament published yet.");
    expect(html).toContain('href="/en/regles"');
    expect(html).toContain('aria-label="Tournament rules"');
  });

  it("français inchangé hors fournisseur", () => {
    const html = renderToStaticMarkup(<TournamentsPage />);
    expect(html).toContain("PLATEFORME · TOURNOIS");
    expect(html).toContain('placeholder="Rechercher un tournoi, un format…"');
    expect(html).toContain("Aucun tournoi publié pour le moment.");
    expect(html).toContain('aria-label="Règles des tournois"');
    expect(html).toMatch(/Tournois <em[^>]*>BlueGenji<\/em>/);
  });
});

describe("cartes — rendu anglais", () => {
  it.each<[string, ReactElement]>([
    ["en cours", <RunningCard key="r" t={tournamentCard({ ...DATES, state: "RUNNING", runningProgress: 0.5, format: "SWISS" })} />],
    ["inscriptions", <RegistrationCard key="g" t={tournamentCard({ ...DATES, state: "REGISTRATION", registeredTeams: 8, maxTeams: 8 })} />],
    ["à venir", <UpcomingCard key="u" t={tournamentCard({ ...DATES, state: "UPCOMING", participantType: "SOLO" })} />],
    ["terminé", <FinishedCard key="f" t={tournamentCard({ ...DATES, state: "FINISHED", format: "BG_SURVIE", game: "MR" })} />],
  ])("%s : aucun français", (_label, card) => {
    const html = inEnglish(card);
    const text = readable(html);
    expect(text).not.toMatch(FRENCH_WORDS);
    expect(text).not.toMatch(ACCENTED);
    expect(html).toContain('href="/tournois/1"');
    // La fiche reste française (lot 8a-2) : le lien le dit depuis `/en`.
    expect(html).toMatch(/href="\/tournois\/1"[^>]*hrefLang="fr"|hrefLang="fr"[^>]*href="\/tournois\/1"/);
  });

  it("en français, le lien vers la fiche ne porte pas d'hrefLang", () => {
    const html = renderToStaticMarkup(<RunningCard t={tournamentCard({ ...DATES, state: "RUNNING" })} />);
    expect(html).not.toContain("hrefLang");
  });

  it("parle le glossaire", () => {
    const running = readable(inEnglish(<RunningCard t={tournamentCard({ ...DATES, state: "RUNNING", runningProgress: 0.5, format: "SWISS" })} />));
    expect(running).toContain("In progress");
    expect(running).toContain("Swiss");
    expect(running).toContain("View the standings");
    expect(running).toContain("50%");
    const finished = readable(inEnglish(<FinishedCard t={tournamentCard({ ...DATES, state: "FINISHED", format: "BG_SURVIE", game: "MR" })} />));
    expect(finished).toContain("BlueGenji&#x27;s Survival");
    expect(finished).toContain("Winner");
    const registration = readable(inEnglish(<RegistrationCard t={tournamentCard({ ...DATES, state: "REGISTRATION", registeredTeams: 8, maxTeams: 8 })} />));
    expect(registration).toContain("Registration open");
    expect(registration).toContain("Full");
  });

  it("dates dans la langue de la page, sur 24 h", () => {
    const iso = "2026-05-12T18:30:00.000Z";
    expect(formatCardDate(iso, true, "en")).not.toMatch(/AM|PM/);
    expect(formatCardDate(iso, true, "en")).toMatch(/May/);
    // Jour sans zéro initial en anglais (« May 2 », jamais « May 02 »).
    expect(formatCardDate("2026-05-02T12:00:00.000Z", false, "en")).toMatch(/May 2,/);
    expect(formatCardDate(iso, true)).toBe(
      new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    );
  });
});

describe("recherche par format", () => {
  const cards = [tournamentCard({ id: 1, name: "Alpha", format: "SWISS" }), tournamentCard({ id: 2, name: "Beta", format: "SINGLE" })];
  const enFormat = (format: string) => tournamentLabel(EN_TEXT, "format", format);

  it("sous /en, trouve le format sous le nom affiché par la carte", () => {
    const shown = enFormat("SWISS");
    expect(filterTournamentsByQuery(cards, shown, enFormat).map((c) => c.name)).toEqual(["Alpha"]);
    expect(filterTournamentsByQuery(cards, "ronde suisse", enFormat)).toEqual([]);
    const buckets = filterBuckets({ running: [], registration: cards, upcoming: [], finished: [] }, shown, "all", enFormat);
    expect(buckets.registration.map((c) => c.name)).toEqual(["Alpha"]);
  });

  it("français par défaut", () => {
    expect(filterTournamentsByQuery(cards, "ronde suisse").map((c) => c.name)).toEqual(["Alpha"]);
  });
});

describe("bandeau défilant", () => {
  const buckets: TournamentBuckets = {
    running: [tournamentCard({ id: 1, name: "Cup", state: "RUNNING", registeredTeams: 1 })],
    registration: [tournamentCard({ id: 2, name: "Open", state: "REGISTRATION", registeredTeams: 3, maxTeams: 8, participantType: "SOLO" })],
    upcoming: [tournamentCard({ id: 3, name: "Next", state: "UPCOMING" })],
    finished: [],
  };

  it("anglais : accords et heure sur 24 h", () => {
    const items = buildTickerItems(buckets, EN_TEXT);
    expect(items[0]).toBe("IN PROGRESS · Cup · 1 team competing");
    expect(items[1]).toBe("REGISTRATION OPEN · Open · 3/8 players");
    expect(items[2]).toMatch(/^UPCOMING · Next · /);
    expect(items.join(" ")).not.toMatch(ACCENTED);
    expect(buildTickerItems({ running: [], registration: [], upcoming: [], finished: [] }, EN_TEXT)).toEqual([
      "No tournament news right now",
    ]);
  });

  it("français inchangé", () => {
    const items = buildTickerItems(buckets);
    expect(items[0]).toBe("EN COURS · Cup · 1 équipes engagées");
    expect(items[1]).toBe("INSCRIPTIONS · Open · 3/8 joueurs");
    expect(items[2]).toMatch(/^À VENIR · Next · /);
  });
});

describe("bouton d'aide des règles", () => {
  it.each(Object.keys(RULE_MODE_LABELS_FR).map((format) => [format as TournamentFormat]))("%s : libellé des deux langues", (format) => {
    const fr = renderToStaticMarkup(<RulesHelpFab format={format} tournamentId={4} contextLabel="Cup" />);
    expect(fr).toContain(`aria-label="Règles du mode ${RULE_MODE_LABELS_FR[format]} — Cup"`.replace("'", "&#x27;"));
    const en = inEnglish(<RulesHelpFab format={format} tournamentId={4} contextLabel="Cup" />);
    expect(readable(en)).not.toMatch(ACCENTED);
    expect(en).toMatch(/aria-label="[^"]+ rules — Cup"/);
  });
});

describe("carte « Connexion requise »", () => {
  it("anglaise sous /en, française sans prop", () => {
    const en = renderToStaticMarkup(
      <AppLocaleProvider locale="en">
        <AuthGate text={messagesFor("en").login.authGate} />
      </AppLocaleProvider>,
    );
    expect(en).toContain("Login required");
    expect(en).toContain('href="/en/connexion?redirect=%2Fen%2Ftournois"');
    expect(en).toContain('href="/en"');
    expect(en).toContain('href="/en/regles"');
    expect(readable(en)).not.toMatch(ACCENTED);
    const fr = renderToStaticMarkup(<AuthGate />);
    expect(fr).toContain("Connexion requise");
    expect(fr).toContain("Cette page fait partie de l&#x27;espace compétitif.");
  });
});

describe("le français des messages égale les tables d'origine", () => {
  it("sections, effectifs, modes des règles, notation des matchs", () => {
    const fr = messagesFor("fr").tournaments;
    expect(fr.list.sections).toEqual(PAGE_SECTION_TITLES);
    expect(fr.list.sectionNav).toEqual(PAGE_SECTION_NAV_LABELS);
    expect(fr.rulesHelp.modes).toEqual(RULE_MODE_LABELS_FR);
    for (const type of ["TEAM", "SOLO"] as const) {
      expect(fr.participants[type].manyCapitalized).toBe(PARTICIPANT_WORDING[type].manyCapitalized);
      expect(fr.participants[type].manyParticipating).toBe(PARTICIPANT_WORDING[type].manyParticipating);
    }
    for (const format of [null, { type: "BO", value: 5 }, { type: "FT", value: 3, maxMaps: 4 }] as const) {
      expect(localizedMatchFormatLabel(FR_TOURNAMENTS_TEXT, format)).toBe(matchFormatLabel(format));
    }
    expect(pageSections({ hidden: 0, mine: 0, running: 1, registration: 0, upcoming: 0, finished: 0 }, { hidden: false, mine: false }, FR_TOURNAMENTS_TEXT)).toEqual(
      pageSections({ hidden: 0, mine: 0, running: 1, registration: 0, upcoming: 0, finished: 0 }, { hidden: false, mine: false }),
    );
    expect(runningCardAction("SINGLE")).toBe("Voir le bracket");
    expect(runningCardAction("SINGLE", EN_TEXT)).toBe("View the bracket");
  });

  it("code inconnu rendu tel quel", () => {
    expect(tournamentLabel(EN_TEXT, "format", "WEIRD")).toBe("WEIRD");
    expect(tournamentLabel(EN_TEXT, "format", "MULTI")).toBe("Multi-stage");
  });
});

describe("tournaments — équivalence avec next-intl, message par message", () => {
  function leaves(tree: object, prefix = ""): Array<{ key: string; source: string }> {
    return Object.entries(tree).flatMap(([key, value]) =>
      typeof value === "string" ? [{ key: `${prefix}${key}`, source: value }] : leaves(value as object, `${prefix}${key}.`),
    );
  }

  it.each(LOCALES.map((locale) => [locale]))("%s", (locale) => {
    const messages = leaves(messagesFor(locale).tournaments);
    expect(messages.length).toBeGreaterThanOrEqual(80);
    for (const { key, source } of messages) {
      const reference = createTranslator({ locale, messages: { m: source }, timeZone: SITE_TIME_ZONE });
      for (const count of [0, 1, 2]) {
        const values = { count, name: "Cup", registered: "3", max: "8", date: "May 12", label: "All", section: "X", percent: "50", base: "BO5", maps: "4", mode: "Swiss", context: "Cup" };
        if (source.includes("<")) continue; // balises : rendu riche, vérifié sur la page
        expect(`${key}: ${formatMessage(locale, source, values)}`).toBe(`${key}: ${reference("m", values)}`);
      }
    }
  });
});
