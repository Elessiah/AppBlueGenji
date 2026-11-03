/**
 * EF-17 — l'anglais (et le français des fenêtres) ne voyage qu'avec ce qui le
 * lit : la fiche par sa porte (`TournamentSheetTextGate`), chaque vue avec son
 * morceau (`withViewText`, `useTournamentViewText`), les fenêtres dans la langue
 * du document seule (`withDialogsText`, `useDialogsText`).
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({ usePathname: () => "/en/tournois/12" }));
jest.mock("@/lib/shared/lazy-component", () => ({
  ...jest.requireActual<typeof import("@/lib/shared/lazy-component")>("@/lib/shared/lazy-component"),
  reloadAfterChunkError: jest.fn(),
}));

import { Suspense, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reloadAfterChunkError } from "@/lib/shared/lazy-component";
import { messagesFor } from "@/lib/server/i18n-messages";
import { documentLocale } from "@/lib/shared/document-locale";
import { SUSPEND_RETRY_MS, suspendOn } from "@/components/i18n/suspend-on-loader";
import { TournamentPageTextProvider, useTournamentPageText, useTournamentViewText } from "@/components/i18n/tournament-page-text";
import { TournamentSheetTextGate, type TournamentSheetEnglish } from "@/components/i18n/tournament-sheet-text-gate";
import { TournamentsTextProvider, useTournamentsText } from "@/components/i18n/tournaments-text";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import { DIALOGS_TEXT_LOADERS, loadDialogsText, useDialogsText, withDialogsText } from "@/app/(secured)/tournois/[id]/_lib/dialogs-text";
import { ENGLISH_ENDURANCE_CHART, ENGLISH_VIEWS, withViewText } from "@/app/(secured)/tournois/[id]/_lib/view-loaders";
import { FR_VIEWS_TEXT } from "@/app/(secured)/tournois/[id]/_lib/views-text";
import { tournamentPageMessages, type TournamentViewMessages } from "@/lib/shared/tournament-page-text";
import { tournamentActionsMessages } from "@/lib/shared/tournament-actions-text";
import { tournamentsSharedMessages } from "@/lib/shared/tournaments-text";
import { messageAt } from "@/lib/shared/scoped-text";
import { readSource } from "../helpers/read-source";
import frViews from "@/messages/fr/tournamentViews.json";
import frEndurance from "@/messages/fr/tournamentEndurance.json";
import frEnduranceChart from "@/messages/fr/tournamentEnduranceChart.json";

const EN = messagesFor("en");
const FR = messagesFor("fr");
const EN_SHEET = tournamentPageMessages(EN);
const EN_SWISS: TournamentViewMessages = { swiss: EN.tournamentViews.swiss, survival: EN.tournamentViews.survival };

/** Un chargeur de vue simulé : déjà chargé (`value`) ou en attente. */
function viewLoader(value: TournamentViewMessages | null) {
  return { load: jest.fn(async () => value ?? EN_SWISS), loaded: () => value };
}

function inSuspense(children: ReactNode): string {
  return renderToStaticMarkup(<Suspense fallback={<i>attente</i>}>{children}</Suspense>);
}

/** Ce que lance `fn` (une attente de `Suspense`). */
/** Un fichier manquant (déploiement, réseau) — le seul échec qu'un rechargement répare. */
function chunkError(): Error {
  return Object.assign(new Error("Loading chunk 412 failed."), { name: "ChunkLoadError" });
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (value) {
    return value;
  }
  return undefined;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
});

describe("documentLocale", () => {
  it("documentLocale_noDocument_returnsFr", () => {
    expect(documentLocale()).toBe("fr");
  });

  it("documentLocale_htmlLangEn_returnsEn", () => {
    Object.defineProperty(globalThis, "document", { value: { documentElement: { lang: "en" } }, configurable: true });
    expect(documentLocale()).toBe("en");
  });

  it("documentLocale_unknownLang_returnsFr", () => {
    Object.defineProperty(globalThis, "document", { value: { documentElement: { lang: "de" } }, configurable: true });
    expect(documentLocale()).toBe("fr");
  });
});

describe("suspendOn", () => {
  it("suspendOn_pendingLoader_throwsPromiseResolvingUndefined", async () => {
    const thrown = thrownBy(() => suspendOn({ load: jest.fn(async () => "ok") }));
    expect(thrown).toBeInstanceOf(Promise);
    await expect(thrown).resolves.toBeUndefined();
  });

  it("suspendOn_loaderRejects_schedulesReloadAndWaitsWithoutNewRequest", async () => {
    jest.useFakeTimers();
    try {
      const loader = { load: jest.fn(async () => Promise.reject(chunkError())) };
      const first = thrownBy(() => suspendOn(loader));
      await jest.advanceTimersByTimeAsync(0);
      expect(reloadAfterChunkError).toHaveBeenCalledTimes(1);
      // D'ici le nouvel essai : la même attente, aucune requête de plus.
      expect(thrownBy(() => suspendOn(loader))).toBeInstanceOf(Promise);
      expect(loader.load).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(SUSPEND_RETRY_MS);
      await expect(first).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it("suspendOn_severalRendersOnOneFailingLoader_reloadsOnceAndSharesOneRetryTimer", async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(reloadAfterChunkError).mockClear();
      // `onceLoader` partage une seule promesse : chaque rendu suspendu reçoit le même rejet.
      const shared = Promise.reject(chunkError());
      const loader = { load: jest.fn(() => shared) };
      const waits = [thrownBy(() => suspendOn(loader)), thrownBy(() => suspendOn(loader)), thrownBy(() => suspendOn(loader))];
      await jest.advanceTimersByTimeAsync(0);
      expect(reloadAfterChunkError).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(SUSPEND_RETRY_MS);
      for (const wait of waits) await expect(wait).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it("suspendOn_reloadDidNotHappen_retriesLoadAfterDelay", async () => {
    jest.useFakeTimers();
    try {
      const loader = { load: jest.fn<() => Promise<string>>().mockRejectedValueOnce(chunkError()).mockResolvedValue("ok") };
      thrownBy(() => suspendOn(loader));
      await jest.advanceTimersByTimeAsync(SUSPEND_RETRY_MS);
      // Le rechargement n'a pas eu lieu : le rendu suivant relance le chargement, qui réussit.
      await expect(thrownBy(() => suspendOn(loader))).resolves.toBeUndefined();
      expect(loader.load).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
  it("suspendOn_loaderRejectsWithNonChunkError_noReloadNoTimer", async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(reloadAfterChunkError).mockClear();
      const loader = { load: jest.fn(async () => Promise.reject(new TypeError("boom"))) };
      const thrown = thrownBy(() => suspendOn(loader));
      await expect(thrown).resolves.toBeUndefined();
      expect(reloadAfterChunkError).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("suspendOn_afterNonChunkError_nextRenderThrowsTheErrorWithoutNewRequest", async () => {
    const bug = new TypeError("boom");
    const loader = { load: jest.fn(async () => Promise.reject(bug)) };
    await thrownBy(() => suspendOn(loader));
    // Un bogue remonte à la limite d'erreur : ni attente, ni nouvelle requête.
    expect(thrownBy(() => suspendOn(loader))).toBe(bug);
    expect(loader.load).toHaveBeenCalledTimes(1);
  });
});

describe("textes des fenêtres, une langue par morceau", () => {
  function DeleteTitle() {
    return <b>{useDialogsText().t("delete.title")}</b>;
  }

  it("useDialogsText_textNotLoaded_suspends", () => {
    // Langue jamais chargée dans ce fichier : la fenêtre attend son texte.
    expect(DIALOGS_TEXT_LOADERS.en.loaded()).toBeNull();
    const html = inSuspense(
      <TournamentActionsTextProvider locale="en">
        <DeleteTitle />
      </TournamentActionsTextProvider>,
    );
    expect(html).toContain("attente");
  });

  it("loadDialogsText_eachLocale_returnsTextInThatLanguage", async () => {
    const fr = await loadDialogsText("fr");
    expect(fr.t("delete.title")).toBe("Supprimer définitivement ce tournoi");
    expect((await loadDialogsText("en")).t("delete.title")).toBe("Permanently delete this tournament");
    expect(await loadDialogsText("fr")).toBe(fr);
  });

  it("useDialogsText_textLoaded_returnsText", async () => {
    await loadDialogsText("fr");
    await loadDialogsText("en");
    expect(renderToStaticMarkup(<DeleteTitle />)).toContain("Supprimer définitivement ce tournoi");
    const en = renderToStaticMarkup(
      <TournamentActionsTextProvider locale="en">
        <DeleteTitle />
      </TournamentActionsTextProvider>,
    );
    expect(en).toContain("Permanently delete this tournament");
  });

  it("withDialogsText_locale_resolvesModuleAfterTextLoaded", async () => {
    const module = { name: "Dialog" };
    await expect(withDialogsText(Promise.resolve(module), "en")).resolves.toBe(module);
    expect(DIALOGS_TEXT_LOADERS.en.loaded()).not.toBeNull();
  });

  it("withDialogsText_moduleLoadFails_rejects", async () => {
    await expect(withDialogsText(Promise.reject(new Error("ChunkLoadError")), "fr")).rejects.toThrow("ChunkLoadError");
  });
});

describe("withViewText et chargeurs des vues", () => {
  it("withViewText_french_returnsLoadWithoutLoadingEnglish", async () => {
    const english = viewLoader(null);
    await expect(withViewText(Promise.resolve("vue"), english, "fr")).resolves.toBe("vue");
    expect(english.load).not.toHaveBeenCalled();
  });

  it("withViewText_english_waitsForBothAndReturnsModule", async () => {
    const english = viewLoader(null);
    await expect(withViewText(Promise.resolve("vue"), english, "en")).resolves.toBe("vue");
    expect(english.load).toHaveBeenCalledTimes(1);
  });

  it("withViewText_englishLoadFails_rejects", async () => {
    const english = { load: jest.fn(async () => Promise.reject(new Error("ChunkLoadError"))) };
    await expect(withViewText(Promise.resolve("vue"), english, "en")).rejects.toThrow("ChunkLoadError");
  });

  it("ENGLISH_VIEWS_load_swissAndSurvivalOnly", async () => {
    const views = await ENGLISH_VIEWS.load();
    expect(Object.keys(views).sort((a, b) => a.localeCompare(b))).toEqual(["survival", "swiss"]);
    expect(views.swiss?.team).toBe(EN.tournamentViews.swiss.team);
  });

  it("ENGLISH_ENDURANCE_CHART_load_mergesViewAndChartKeys", async () => {
    const { endurance } = await ENGLISH_ENDURANCE_CHART.load();
    expect(endurance?.penaltyBadgeSr).toBe(EN.tournamentEndurance.endurance.penaltyBadgeSr);
    expect(endurance?.chartClear).toBe(EN.tournamentEnduranceChart.endurance.chartClear);
  });
});

describe("useTournamentViewText", () => {
  function SwissTeam({ english }: Readonly<{ english: ReturnType<typeof viewLoader> }>) {
    return <b>{useTournamentViewText(FR_VIEWS_TEXT, english).t("swiss.team")}</b>;
  }

  it("useTournamentViewText_french_returnsFrView", () => {
    expect(renderToStaticMarkup(<SwissTeam english={viewLoader(EN_SWISS)} />)).toContain(FR.tournamentViews.swiss.team);
  });

  it("useTournamentViewText_englishWithoutSheet_returnsFrenchBundle", () => {
    // Fournisseur anglais sans dictionnaire : le français du paquet, jamais une attente.
    const html = renderToStaticMarkup(
      <TournamentPageTextProvider locale="en">
        <SwissTeam english={viewLoader(null)} />
      </TournamentPageTextProvider>,
    );
    expect(html).toBe(`<b>${FR_VIEWS_TEXT.t("swiss.team")}</b>`);
  });

  it("useTournamentViewText_englishLoaded_returnsSheetPlusViewText", () => {
    const english = viewLoader(EN_SWISS);
    const seen: unknown[] = [];
    function Probe() {
      const text = useTournamentViewText(FR_VIEWS_TEXT, english);
      seen.push(text);
      return <b>{`${text.t("swiss.team")}|${text.t("loading")}`}</b>;
    }
    const html = renderToStaticMarkup(
      <TournamentPageTextProvider locale="en" messages={EN_SHEET}>
        <Probe />
        <Probe />
      </TournamentPageTextProvider>,
    );
    expect(html).toContain(`${EN.tournamentViews.swiss.team}|Loading the tournament…`);
    // Un seul texte pour la fiche et la vue : chaque composant reçoit le même objet.
    expect(seen[0]).toBe(seen[1]);
  });

  it("useTournamentViewText_englishNotLoaded_suspends", () => {
    const english = viewLoader(null);
    const html = inSuspense(
      <TournamentPageTextProvider locale="en" messages={EN_SHEET}>
        <SwissTeam english={english} />
      </TournamentPageTextProvider>,
    );
    expect(html).toContain("attente");
    expect(english.load).toHaveBeenCalled();
  });
});

const EN_SHARED = EN.tournamentsShared;
const FR_SHARED = FR.tournamentsShared;

describe("TournamentSheetTextGate", () => {
  function Loading() {
    return <b>{useTournamentPageText().t("loading")}</b>;
  }
  const english: TournamentSheetEnglish = { page: EN_SHEET, actions: tournamentActionsMessages(EN), shared: tournamentsSharedMessages(EN) };

  it("TournamentSheetTextGate_french_rendersChildrenFrench", () => {
    const html = renderToStaticMarkup(
      <TournamentSheetTextGate locale="fr">
        <Loading />
      </TournamentSheetTextGate>,
    );
    expect(html).toContain("Chargement du tournoi…");
  });

  it("TournamentSheetTextGate_englishProvided_rendersEnglish", () => {
    const html = renderToStaticMarkup(
      <TournamentSheetTextGate locale="en" messages={english}>
        <Loading />
      </TournamentSheetTextGate>,
    );
    expect(html).toContain("Loading the tournament…");
  });

  it("TournamentSheetTextGate_englishProvided_sharesTournamentsTextWithTheList", () => {
    function Shared() {
      return <b>{useTournamentsText().t("rulesHelp.index")}</b>;
    }
    const render = (locale: "fr" | "en") =>
      renderToStaticMarkup(
        <TournamentSheetTextGate locale={locale} messages={locale === "en" ? english : undefined}>
          <Shared />
        </TournamentSheetTextGate>,
      );
    expect(render("en")).toContain(EN_SHARED.rulesHelp.index);
    expect(render("fr")).toContain(FR_SHARED.rulesHelp.index);
  });

  it("TournamentSheetTextGate_englishNotProvided_rendersFallback", () => {
    // Réponse du routeur, rien de la session (rendu serveur) : l'écran d'attente, jamais du français.
    const html = renderToStaticMarkup(
      <TournamentSheetTextGate locale="en">
        <Loading />
      </TournamentSheetTextGate>,
    );
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Chargement du tournoi…");
    expect(html).not.toContain("Loading the tournament…");
  });
});

describe("TournamentsTextProvider — espaces communs de la mise en page", () => {
  function Probe() {
    const { t } = useTournamentsText();
    return <b>{`${t("rulesHelp.index")}|${t("list.searchLabel")}`}</b>;
  }

  it("tournamentsSharedMessages_englishCatalog_returnsFourSharedParts", () => {
    expect(Object.keys(tournamentsSharedMessages(EN)).sort((a, b) => a.localeCompare(b))).toEqual([
      "labels",
      "matchFormat",
      "participants",
      "rulesHelp",
    ]);
  });

  it("TournamentsTextProvider_sharedMessagesOnly_keepsSharedEnglishAndFrenchList", () => {
    const html = renderToStaticMarkup(
      <TournamentsTextProvider locale="en" messages={tournamentsSharedMessages(EN)}>
        <Probe />
      </TournamentsTextProvider>,
    );
    expect(html).toContain(`${EN.tournamentsShared.rulesHelp.index}|${FR.tournaments.list.searchLabel}`);
  });

  it("TournamentsTextProvider_noMessages_returnsFrenchText", () => {
    const html = renderToStaticMarkup(
      <TournamentsTextProvider locale="fr">
        <Probe />
      </TournamentsTextProvider>,
    );
    expect(html).toContain(`${FR.tournamentsShared.rulesHelp.index}|${FR.tournaments.list.searchLabel}`);
  });
});

describe("chaque vue ne lit que les clés de son espace (EF-17)", () => {
  const DIR = "app/(secured)/tournois/[id]/";
  /** Les clés de vue écrites en toutes lettres dans un fichier. */
  function viewKeys(file: string): string[] {
    return [...readSource(DIR + file).matchAll(/"((?:swiss|survival|endurance)\.[A-Za-z0-9.]+)"/g)].map((match) => match[1]);
  }
  function missingFrom(namespace: Record<string, unknown>, keys: string[]): string[] {
    return keys.filter((key) => messageAt(namespace, key) === undefined);
  }

  it.each([
    ["_components/EnduranceView.tsx"],
    ["_components/EnduranceCard.tsx"],
    ["_components/EnduranceRankingViews.tsx"],
    ["_components/EnduranceRoundPanels.tsx"],
    ["_components/EnduranceChartPanel.tsx"],
    ["_lib/endurance-sections.ts"],
  ])("%s : ses clés sont dans `tournamentEndurance` (pas celles du graphique)", (file) => {
    expect(missingFrom(frEndurance, viewKeys(file))).toEqual([]);
  });

  it("EnduranceChart : ses clés sont dans l'endurance ou son graphique", () => {
    expect(missingFrom({ endurance: { ...frEndurance.endurance, ...frEnduranceChart.endurance } }, viewKeys("_components/EnduranceChart.tsx"))).toEqual([]);
  });

  it.each([["_components/SwissView.tsx"], ["_components/SurvivalView.tsx"]])("%s : ses clés sont dans `tournamentViews`", (file) => {
    expect(missingFrom(frViews, viewKeys(file))).toEqual([]);
  });
});
