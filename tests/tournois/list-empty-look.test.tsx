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
import { listEmptyKind, searchAwaitsArchive } from "@/app/(secured)/tournois/_lib/empty-state";
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
const teamsList = read("app/(secured)/equipes/TeamsList.tsx");
const playersList = read("app/(secured)/joueurs/PlayersList.tsx");

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

  it("listEmptyKind_noSectionsFilteredArchivePending_returnsPending", () => {
    expect(
      listEmptyKind({ loaded: true, shownSections: 0, upcomingCount: 0, query: "strike", gameFilter: "all", archivePending: true }),
    ).toBe("pending");
  });

  it("listEmptyKind_noSectionsSearchArchiveFailed_returnsFiltered", () => {
    const archivePending = searchAwaitsArchive({ archiveWanted: true, listTruncated: true, archiveFailed: true, query: "strike" });

    expect(
      listEmptyKind({ loaded: true, shownSections: 0, upcomingCount: 0, query: "strike", gameFilter: "all", archivePending }),
    ).toBe("filtered");
  });

  it("listEmptyKind_noSectionsGameFilterOnlyArchiveWanted_returnsFilteredAtOnce", () => {
    const archivePending = searchAwaitsArchive({ archiveWanted: true, listTruncated: true, archiveFailed: false, query: "" });

    expect(
      listEmptyKind({ loaded: true, shownSections: 0, upcomingCount: 0, query: "", gameFilter: "mr", archivePending }),
    ).toBe("filtered");
  });

  it("listEmptyKind_noSectionsUnfilteredArchivePending_returnsEmpty", () => {
    expect(
      listEmptyKind({ loaded: true, shownSections: 0, upcomingCount: 0, query: "", gameFilter: "all", archivePending: true }),
    ).toBe("empty");
  });

  it("listEmptyKind_sectionsShownArchivePending_returnsNothingUpcoming", () => {
    expect(
      listEmptyKind({ loaded: true, shownSections: 1, upcomingCount: 0, query: "", gameFilter: "ow", archivePending: true }),
    ).toBe("nothingUpcoming");
  });

  it("listEmptyKind_whitespaceQuery_treatedAsNoFilter", () => {
    expect(listEmptyKind({ loaded: true, shownSections: 0, upcomingCount: 0, query: "   ", gameFilter: "all" })).toBe("empty");
  });
});

describe("searchAwaitsArchive", () => {
  it("searchAwaitsArchive_queryWithTruncatedListWanted_returnsTrue", () => {
    expect(searchAwaitsArchive({ archiveWanted: true, listTruncated: true, archiveFailed: false, query: "strike" })).toBe(true);
  });

  it("searchAwaitsArchive_noQuery_returnsFalse", () => {
    expect(searchAwaitsArchive({ archiveWanted: true, listTruncated: true, archiveFailed: false, query: "" })).toBe(false);
  });

  it("searchAwaitsArchive_whitespaceQuery_returnsFalse", () => {
    expect(searchAwaitsArchive({ archiveWanted: true, listTruncated: true, archiveFailed: false, query: "   " })).toBe(false);
  });

  it("searchAwaitsArchive_archiveFailed_returnsFalse", () => {
    expect(searchAwaitsArchive({ archiveWanted: true, listTruncated: true, archiveFailed: true, query: "strike" })).toBe(false);
  });

  it("searchAwaitsArchive_archiveReceived_returnsFalse", () => {
    expect(searchAwaitsArchive({ archiveWanted: true, listTruncated: false, archiveFailed: false, query: "strike" })).toBe(false);
  });

  it("searchAwaitsArchive_archiveNotWanted_returnsFalse", () => {
    expect(searchAwaitsArchive({ archiveWanted: false, listTruncated: true, archiveFailed: false, query: "strike" })).toBe(false);
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
    const fr = inFrench(<ListEmptyState kind="filtered" canManage onClearFilters={() => undefined} />);
    expect(fr).toContain("Aucun résultat");
    expect(fr).toContain("Effacer la recherche et les filtres");
    expect(fr).toContain('type="button"');
    expect(fr).not.toContain("/tournois/creer");
    expect(fr).not.toContain("/regles");

    const en = inEnglish(<ListEmptyState kind="filtered" canManage onClearFilters={() => undefined} />);
    expect(en).toContain("Clear the search and filters");
  });

  it("render_nothingUpcomingWithFinished_showsFinishedLink", () => {
    const fr = inFrench(<ListEmptyState kind="nothingUpcoming" canManage={false} finishedCount={3} onShowFinished={() => undefined} />);
    expect(fr).toContain("Aucun tournoi à venir annoncé");
    expect(fr).toContain('href="#tournois-finished"');
    expect(fr).toContain("Voir les tournois terminés");
    // L'explication passe derrière le bouton « i », jamais en paragraphe permanent.
    expect(fr).toContain('aria-controls="tournaments-nothing-upcoming-help"');

    const en = inEnglish(<ListEmptyState kind="nothingUpcoming" canManage={false} finishedCount={3} onShowFinished={() => undefined} />);
    expect(en).toContain("No upcoming tournament announced");
    expect(en).toContain("See finished tournaments");
  });

  it("render_nothingUpcomingNoFinished_noFinishedLink", () => {
    const html = inFrench(<ListEmptyState kind="nothingUpcoming" canManage={false} finishedCount={0} onShowFinished={() => undefined} />);

    expect(html).not.toContain("#tournois-finished");
  });

  it("render_nothingUpcomingWithClearGame_showsGameScopedTextAndButton", () => {
    const fr = inFrench(
      <ListEmptyState kind="nothingUpcoming" canManage={false} finishedCount={0} onShowFinished={() => undefined} onClearGame={() => undefined} />,
    );
    expect(fr).toContain("Aucun tournoi à venir pour ce jeu");
    expect(fr).toContain("Afficher tous les jeux");
    expect(fr).not.toContain("Aucun tournoi à venir annoncé");

    const en = inEnglish(
      <ListEmptyState kind="nothingUpcoming" canManage={false} finishedCount={0} onShowFinished={() => undefined} onClearGame={() => undefined} />,
    );
    expect(en).toContain("No upcoming tournament for this game");
    expect(en).toContain("Show all games");
  });

  it("render_nothingUpcomingWithoutClearGame_keepsGlobalText", () => {
    const html = inFrench(<ListEmptyState kind="nothingUpcoming" canManage={false} finishedCount={0} onShowFinished={() => undefined} />);

    expect(html).toContain("Aucun tournoi à venir annoncé");
    expect(html).not.toContain("Afficher tous les jeux");
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
      "upcomingCount: gameFilteredBuckets.registration.length + gameFilteredBuckets.upcoming.length + hiddenUpcoming",
    );
    expect(page.indexOf('kind="nothingUpcoming"')).toBeLessThan(page.indexOf('id={pageSectionAnchor("finished")}'));
    expect(page).toContain("canManage={isAdmin}");
  });
});

describe("TournamentsList — câblage de l'état vide", () => {
  it("page_hiddenUpcoming_usesScheduledStateForStaffOnly", () => {
    expect(page).toContain("const scheduledHidden = useScheduledBuckets(hiddenAsBuckets);");
    expect(page).toMatch(/const hiddenUpcoming = showHidden\s*\?\s*filteredHidden\.filter\(/);
    expect(page).toContain("const state = scheduledHiddenState.get(card.id) ?? card.state;");
  });

  it("page_clearFilters_focusesSearchOnlyWithQuery", () => {
    expect(page).toContain('const hadQuery = query.trim() !== "";');
    expect(page).toContain("(hadQuery ? searchInputRef.current : allGamesChipRef.current)?.focus();");
    expect(page).toContain('ref={key === "all" ? allGamesChipRef : undefined}');
  });

  it("page_pendingArchive_showsLoadingRowOnPendingOutcome", () => {
    expect(page).toContain("archivePending: searchPending,");
    expect(page).toMatch(/\{emptyKind === "pending" && \(\s*<div className=\{s\.showMoreRow\}>\{t\("list\.finishedLoading"\)\}<\/div>/);
  });

  it("page_liveRegion_announcesLoadingWhileSearchPending", () => {
    const pendingLine = page.indexOf('if (searchPending) return t("list.finishedLoading");');

    expect(pendingLine).toBeGreaterThan(0);
    expect(pendingLine).toBeLessThan(page.indexOf('return t("list.resultsCount"'));
  });

  it("page_archiveFailure_stopsWaitingAndResetsWhenNoLongerWanted", () => {
    expect(page).toContain("if (archiveFailed && !wantFinishedArchive) setArchiveFailed(false);");
    expect(page).toContain("if (wantFinishedArchive && wantFinishedArchiveRef.current) setArchiveFailed(true);");
    expect(page).toContain("const finishedArchivePending = wantFinishedArchive && listTruncated && !archiveFailed;");
  });

  it("page_nothingUpcoming_passesClearGameOnlyUnderGameFilter", () => {
    expect(page).toContain('onClearGame={gameFilter === "all" ? undefined : clearGame}');
  });

  it("page_clearGame_keepsQueryAndFocusesAllChip", () => {
    const clearGame = page.slice(page.indexOf("const clearGame = () => {"), page.indexOf("};", page.indexOf("const clearGame = () => {")));

    expect(clearGame).toContain('setGameFilter("all");');
    expect(clearGame).toContain("allGamesChipRef.current?.focus();");
    expect(clearGame).not.toContain("setQuery");
  });
});

describe("voiles sans arête dure", () => {
  it("fabricFade_global_hasCrossedEdgeMasks", () => {
    const fade = block(globalsCss, ".fabric-fade");

    expect(fade).toMatch(/-webkit-mask-image:\s*linear-gradient\(to right, transparent,/);
    expect(fade).toMatch(/\smask-image:\s*linear-gradient\(to right, transparent,/);
    expect(fade).toContain("linear-gradient(to bottom, transparent,");
    expect(fade).toContain("mask-composite: intersect;");
    expect(fade).toContain("-webkit-mask-composite: source-in;");
  });

  it("fabric_global_staysUnmaskedForOtherPages", () => {
    expect(block(globalsCss, ".fabric")).not.toContain("mask");
  });

  it("fabricFade_optIn_onTournoisAndDirectoriesOnly", () => {
    expect(page).toContain("<div className={`${s.fabric} fabric-fade`} />");
    expect(teamsList).toContain('<div className="fabric fabric-fade" />');
    expect(playersList).toContain('<div className="fabric fabric-fade" />');
    expect(read("app/connexion/_components/LoginForm.tsx")).not.toContain("fabric-fade");
    expect(read("app/rgpd/page.tsx")).not.toContain("fabric-fade");
  });

  it("fabric_tournois_setsFadeVarsAndBoundedHeight", () => {
    const fabric = block(tournoisCss, ".fabric");

    expect(fabric).toContain("max-height: 1400px;");
    expect(fabric).toContain("--fade-x: min(18%, 220px);");
    expect(fabric).not.toContain("mask-image");
    expect(fabric).not.toContain("110%");
  });

  it("fabricBottom_tournois_anchoredToPageBottomAndBounded", () => {
    const bottom = block(tournoisCss, ".fabricBottom");

    expect(bottom).toContain("bottom: 0;");
    expect(bottom).toContain("height: min(100%, 560px);");
    expect(bottom).toContain("at 10% 110%");
    expect(page).toContain("<div className={`${s.fabricBottom} fabric-fade`} />");
  });

  it("hairlineFade_global_usedByThreeHeaders", () => {
    expect(block(globalsCss, ".hairline-fade::after")).toContain(
      "background: linear-gradient(90deg, transparent, var(--line-soft) 20%, var(--line-soft) 80%, transparent);",
    );
    expect(block(tournoisCss, ".page")).not.toContain("border-bottom");
    expect(block(annuaireCss, ".page")).not.toContain("border-bottom");
    expect(tournoisCss).not.toContain(".page::after");
    expect(annuaireCss).not.toContain(".page::after");
    expect(page).toContain("<div className={`${s.page} page-wide hairline-fade`}>");
    expect(teamsList).toContain("<header className={`${s.page} hairline-fade`}>");
    expect(playersList).toContain("<header className={`${s.page} hairline-fade`}>");
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
