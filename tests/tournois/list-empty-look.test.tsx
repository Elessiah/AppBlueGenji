/**
 * `/tournois` vide ou presque (`docs/features/TOURNOIS_LIST_EMPTY_LOOK.md`) :
 * le choix de l'état vide, son rendu en français et en anglais, et les voiles
 * qui s'éteignent sur leurs bords au lieu d'être coupés net.
 */
import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";

let mockPathname = "/tournois";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { listEmptyKind } from "@/app/(secured)/tournois/_lib/empty-state";
import { ListEmptyState } from "@/app/(secured)/tournois/ListEmptyState";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { TournamentsTextProvider } from "@/components/i18n/tournaments-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import { tournamentsClientMessages } from "@/lib/shared/tournaments-text";
import frTournaments from "@/messages/fr/tournaments.json";
import enTournaments from "@/messages/en/tournaments.json";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const tournoisCss = read("app/(secured)/tournois/tournois.module.css");
const annuaireCss = read("app/(secured)/_shared/annuaire.module.css");
const globalsCss = read("app/globals.css");
const page = read("app/(secured)/tournois/TournamentsList.tsx");

function inFrench(ui: ReactElement): string {
  mockPathname = "/tournois";
  return renderToStaticMarkup(
    <AppLocaleProvider locale="fr">
      <TournamentsTextProvider locale="fr">{ui}</TournamentsTextProvider>
    </AppLocaleProvider>,
  );
}

function inEnglish(ui: ReactElement): string {
  mockPathname = "/en/tournois";
  return renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <TournamentsTextProvider locale="en" messages={tournamentsClientMessages(messagesFor("en"))}>
        {ui}
      </TournamentsTextProvider>
    </AppLocaleProvider>,
  );
}

/** Le bloc CSS d'un sélecteur (première occurrence exacte, en début de ligne). */
function block(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("\n}", start + 1));
}

describe("listEmptyKind", () => {
  it("listEmptyKind_notLoaded_returnsNull", () => {
    expect(listEmptyKind({ loaded: false, shownSections: 0, upcomingCount: 0, query: "", gameFilter: "all" })).toBeNull();
  });

  it("listEmptyKind_noSectionsNoFilter_returnsEmpty", () => {
    expect(listEmptyKind({ loaded: true, shownSections: 0, upcomingCount: 0, query: "", gameFilter: "all" })).toBe("empty");
  });

  it("listEmptyKind_noSectionsWithQuery_returnsFiltered", () => {
    expect(listEmptyKind({ loaded: true, shownSections: 0, upcomingCount: 0, query: "strike", gameFilter: "all" })).toBe(
      "filtered",
    );
  });

  it("listEmptyKind_noSectionsWithGameFilter_returnsFiltered", () => {
    expect(listEmptyKind({ loaded: true, shownSections: 0, upcomingCount: 0, query: "", gameFilter: "mr" })).toBe("filtered");
  });

  it("listEmptyKind_sectionsButNothingUpcoming_returnsNothingUpcoming", () => {
    expect(listEmptyKind({ loaded: true, shownSections: 1, upcomingCount: 0, query: "", gameFilter: "all" })).toBe(
      "nothingUpcoming",
    );
  });

  it("listEmptyKind_nothingUpcomingUnderGameFilter_returnsNothingUpcoming", () => {
    expect(listEmptyKind({ loaded: true, shownSections: 1, upcomingCount: 0, query: "", gameFilter: "ow" })).toBe(
      "nothingUpcoming",
    );
  });

  it("listEmptyKind_nothingUpcomingWithQuery_returnsNull", () => {
    expect(listEmptyKind({ loaded: true, shownSections: 1, upcomingCount: 0, query: "strike", gameFilter: "all" })).toBeNull();
  });

  it("listEmptyKind_upcomingPresent_returnsNull", () => {
    expect(listEmptyKind({ loaded: true, shownSections: 2, upcomingCount: 1, query: "", gameFilter: "all" })).toBeNull();
  });

  it("listEmptyKind_whitespaceQuery_treatedAsNoFilter", () => {
    expect(listEmptyKind({ loaded: true, shownSections: 0, upcomingCount: 0, query: "   ", gameFilter: "all" })).toBe("empty");
  });
});

describe("ListEmptyState", () => {
  it("render_emptyKindManager_showsTitleRulesAndCreate", () => {
    const fr = inFrench(<ListEmptyState kind="empty" canManage />);
    expect(fr).toContain("Aucun tournoi pour le moment");
    expect(fr).toContain("Les prochains tournois s&#x27;annonceront ici, avec leurs dates d&#x27;inscription.");
    expect(fr).toContain('href="/tournois/creer"');
    expect(fr).toContain('href="/regles"');

    const en = inEnglish(<ListEmptyState kind="empty" canManage />);
    expect(en).toContain("No tournaments right now");
    expect(en).toContain('href="/en/tournois/creer"');
    expect(en).toContain('href="/en/regles"');
    expect(en).toContain("Read the rules");
  });

  it("render_emptyKindNonManager_hidesCreate", () => {
    const html = inFrench(<ListEmptyState kind="empty" canManage={false} />);

    expect(html).not.toContain("/tournois/creer");
    expect(html).toContain('href="/regles"');
  });

  it("render_filteredKind_showsClearButtonNoCreate", () => {
    const fr = inFrench(<ListEmptyState kind="filtered" canManage />);
    expect(fr).toContain("Aucun résultat");
    expect(fr).toContain("Effacer la recherche et les filtres");
    expect(fr).toContain('type="button"');
    expect(fr).not.toContain("/tournois/creer");
    expect(fr).not.toContain("/regles");

    const en = inEnglish(<ListEmptyState kind="filtered" canManage />);
    expect(en).toContain("Clear the search and filters");
  });

  it("render_nothingUpcomingWithFinished_showsFinishedLink", () => {
    const fr = inFrench(<ListEmptyState kind="nothingUpcoming" canManage={false} finishedCount={3} />);
    expect(fr).toContain("Aucun tournoi à venir annoncé");
    expect(fr).toContain('href="#tournois-finished"');
    expect(fr).toContain("Voir les tournois terminés");
    // L'explication passe derrière le bouton « i », jamais en paragraphe permanent.
    expect(fr).toContain('aria-controls="tournaments-nothing-upcoming-help"');

    const en = inEnglish(<ListEmptyState kind="nothingUpcoming" canManage={false} finishedCount={3} />);
    expect(en).toContain("No upcoming tournament announced");
    expect(en).toContain("See finished tournaments");
  });

  it("render_nothingUpcomingNoFinished_noFinishedLink", () => {
    const html = inFrench(<ListEmptyState kind="nothingUpcoming" canManage={false} finishedCount={0} />);

    expect(html).not.toContain("#tournois-finished");
  });

  it("messages_allNewKeys_presentInFrAndEn", () => {
    const frKeys = Object.keys(frTournaments.list.emptyState).sort();
    const enKeys = Object.keys(enTournaments.list.emptyState).sort();

    expect(enKeys).toEqual(frKeys);
    for (const key of frKeys) {
      const k = key as keyof typeof frTournaments.list.emptyState;
      expect(enTournaments.list.emptyState[k]).not.toBe(frTournaments.list.emptyState[k]);
    }
  });

  it("page_wiresEmptyStates_beforeFinishedSection", () => {
    expect(page).toContain("const emptyKind = listEmptyKind({");
    expect(page).toContain(
      "upcomingCount: gameFilteredBuckets.registration.length + gameFilteredBuckets.upcoming.length",
    );
    expect(page.indexOf('kind="nothingUpcoming"')).toBeLessThan(page.indexOf('id={pageSectionAnchor("finished")}'));
    expect(page).toContain("canManage={isAdmin}");
  });
});

describe("voiles sans arête dure", () => {
  it("fabric_tournois_hasEdgeFadeMask", () => {
    const fabric = block(tournoisCss, ".fabric");

    expect(fabric).toMatch(/-webkit-mask-image:\s*linear-gradient\(to right, transparent,/);
    expect(fabric).toMatch(/\smask-image:\s*linear-gradient\(to right, transparent,/);
    expect(fabric).toContain("linear-gradient(to bottom, transparent,");
    expect(fabric).toContain("mask-composite: intersect;");
    expect(fabric).toContain("-webkit-mask-composite: source-in;");
  });

  it("fabric_global_hasEdgeFadeMask", () => {
    const fabric = block(globalsCss, ".fabric");

    expect(fabric).toMatch(/-webkit-mask-image:\s*linear-gradient\(to right, transparent,/);
    expect(fabric).toContain("linear-gradient(to bottom, transparent,");
    expect(fabric).toContain("mask-composite: intersect;");
    expect(fabric).toContain("-webkit-mask-composite: source-in;");
  });

  it("page_bottomHairline_fadesAtEnds", () => {
    for (const css of [tournoisCss, annuaireCss]) {
      expect(block(css, ".page")).not.toContain("border-bottom");
      expect(block(css, ".page::after")).toContain(
        "background: linear-gradient(90deg, transparent, var(--line-soft) 20%, var(--line-soft) 80%, transparent);",
      );
    }
  });

  it("emptyState_animation_readsDecoAnimState", () => {
    const ring = block(tournoisCss, ".emptyIcon::after");
    const emptyCss = tournoisCss.slice(
      tournoisCss.indexOf("/* ---------- ÉTAT VIDE"),
      tournoisCss.indexOf("/* Ligne du bouton « Voir plus »"),
    );

    expect(ring).toContain("animation-play-state: var(--deco-anim-state);");
    expect(emptyCss).not.toMatch(/amber/);
  });
});
