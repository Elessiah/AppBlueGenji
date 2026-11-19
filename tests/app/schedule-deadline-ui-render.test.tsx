/**
 * Date butoir de planification, côté écran (`docs/features/SCHEDULE_DEADLINE.md`) :
 * la fenêtre ne propose que des heures acceptées (FR et `/en`), l'aide de la
 * saisie en masse prévient du remplacement, et la pastille « À planifier » n'annonce
 * aucune date avant que l'horloge soit connue.
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});
jest.mock("@/lib/shared/hooks/useDialogBehavior", () => ({ useDialogBehavior: () => ({ current: null }) }));
jest.mock("next/navigation", () => ({
  usePathname: () => "/tournois/1",
  useSearchParams: () => new URLSearchParams(""),
  useParams: () => ({ id: "1" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined, back: () => undefined, forward: () => undefined }),
}));

// La confirmation commune se monte après un effet : on ne regarde ici que son contenu.
jest.mock("@/components/ui/confirm-action-dialog", () => {
  const react = jest.requireActual<typeof import("react")>("react");
  return {
    ConfirmActionDialog: ({ title, children }: { title: string; children: unknown }) =>
      react.createElement("section", { "aria-label": title }, children as never),
  };
});

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScheduleDeadlineDialog } from "@/app/(secured)/tournois/[id]/_components/ScheduleDeadlineDialog";
import { LaunchPhaseBadge } from "@/app/(secured)/tournois/[id]/_components/MatchLaunchStrip";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import { ToastProvider } from "@/components/ui/toast";
import { messagesFor } from "@/lib/server/i18n-messages";
import { tournamentActionsMessages } from "@/lib/shared/tournament-actions-text";
import { bracketMatch } from "../helpers/bracket-match";
import { readSource } from "../helpers/read-source";
import "@/tests/helpers/lazy-tournament-texts";

const EN = messagesFor("en");
const noop = () => undefined;
const globals = globalThis as { document?: unknown; window?: unknown };
const saved = { document: globals.document, window: globals.window };
// Mercredi 18 novembre 2026, 15:40 à Paris.
const NOW = new Date("2026-11-18T14:40:00.000Z");
beforeAll(() => {
  globals.document = { body: {}, referrer: "" };
  globals.window = { location: { origin: "http://localhost", pathname: "/tournois/1" }, history: { length: 1 } };
  jest.useFakeTimers({ now: NOW });
});
afterAll(() => {
  globals.document = saved.document;
  globals.window = saved.window;
  jest.useRealTimers();
});

function wrap(locale: "fr" | "en", tree: ReactElement): string {
  const body = <ToastProvider>{tree}</ToastProvider>;
  if (locale === "fr") return renderToStaticMarkup(body);
  return renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <TournamentActionsTextProvider locale="en" messages={tournamentActionsMessages(EN)}>
        {body}
      </TournamentActionsTextProvider>
    </AppLocaleProvider>,
  );
}

const hourOptions = (html: string): number[] => {
  const select = /<select id="schedule-deadline-hour"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  return [...(select?.[1] ?? "").matchAll(/<option[^>]*value="(\d+)"/g)].map((found) => Number(found[1]));
};
const dialog = (locale: "fr" | "en", target: Parameters<typeof ScheduleDeadlineDialog>[0]["target"]) =>
  wrap(locale, <ScheduleDeadlineDialog target={target} matches={[]} onClose={noop} />);
const matchTarget = (deadlineAt: string | null) => ({
  kind: "match" as const,
  matchId: 7,
  team1Name: "Alpha",
  team2Name: null,
  deadlineAt,
});

describe("ScheduleDeadlineDialog rendu", () => {
  it("scheduleDeadlineDialog_noDeadline_opensOnSuggestedDayAndHour21", () => {
    const html = dialog("fr", matchTarget(null));

    // Mercredi 15:40 sans match joué : 21:00, deux jours plus tard (vendredi).
    expect(html).toContain('<option value="2026-11-20" selected="">');
    expect(hourOptions(html)).toHaveLength(24);
    expect(html).toContain('<option value="21" selected="">');
  });

  it("scheduleDeadlineDialog_pastDeadline_fallsBackToSuggestionNotToThePast", () => {
    const html = dialog("fr", matchTarget("2026-11-17T20:00:00.000Z"));

    expect(html).not.toContain('<option value="2026-11-17"');
    expect(html).toContain('<option value="2026-11-20" selected="">');
  });

  it("scheduleDeadlineDialog_farDeadline_isSortedIntoTheDays", () => {
    const html = dialog("fr", matchTarget("2026-12-30T17:00:00.000Z"));
    const days = [...html.matchAll(/<option value="(\d{4}-\d{2}-\d{2})"/g)].map((found) => found[1]);

    expect(days[0]).toBe("2026-11-19");
    expect(days.at(-1)).toBe("2026-12-30");
    expect([...days].sort()).toEqual(days);
  });

  it("scheduleDeadlineDialog_tomorrowChosen_offersNoHourUnderTwentyFourHoursAhead", () => {
    // Échéance posée demain 18:00 : ce jour est choisi, les heures à moins de 24 heures ne sont pas offertes.
    const html = dialog("fr", matchTarget("2026-11-19T17:00:00.000Z"));
    const hours = hourOptions(html);

    expect(hours[0]).toBe(16);
    expect(hours).not.toContain(15);
    expect(html).toContain('<option value="18" selected="">');
    expect(html).not.toContain('<option value="2026-11-18"');
  });

  it("scheduleDeadlineDialog_bulk_hintWarnsAboutReplacement", () => {
    const fr = dialog("fr", { kind: "tournament", tournamentId: 1, count: 3 });
    const en = dialog("en", { kind: "tournament", tournamentId: 1, count: 3 });

    expect(fr).toContain("Remplace la date butoir déjà posée");
    expect(en).toContain("Replaces the deadline already set");
    expect(dialog("fr", matchTarget(null))).not.toContain("Remplace la date butoir");
  });

  it("scheduleDeadlineDialog_unknownTeam_saysTbdInBothLanguages", () => {
    expect(dialog("fr", matchTarget(null))).toContain("Alpha contre TBD");
    expect(dialog("en", matchTarget(null))).toContain("Alpha vs TBD");
  });
});

describe("LaunchPhaseBadge : date butoir", () => {
  const toPlan = bracketMatch({ id: 7, team1Id: 10, team2Id: 11, status: "READY", scheduleDeadlineAt: "2026-11-17T20:00:00.000Z" });

  it("launchPhaseBadge_firstRender_announcesNoDeadline", () => {
    // Premier rendu (HTML serveur) : l'horloge est inconnue, une date possiblement passée ne s'affiche pas.
    const html = wrap("fr", <LaunchPhaseBadge match={toPlan} phase="TO_PLAN" />);

    expect(html).toContain("À planifier");
    expect(html).not.toContain('data-testid="schedule-deadline"');
  });
});

describe("planning et fenêtre d'horaire : câblage", () => {
  it("planningBoard_confirmPending_pillAndHintNotBareParagraph", () => {
    const source = readSource("app/(secured)/planning/_components/PlanningBoard.tsx");

    expect(source).toMatch(/<Pill variant="waiting">\{t\("autoConfirm\.pending"\)\}<\/Pill>/);
    expect(source).toContain('t("autoConfirm.pendingHint")');
  });

  it("matchScheduleDialog_unsavedDate_blocksDeadlineButtonWithToast", () => {
    const source = readSource("app/(secured)/tournois/[id]/_components/MatchScheduleDialog.tsx");

    expect(source).toContain("blocked={dirty}");
    expect(source).toContain('showInfo(text.t("schedule.deadlineDirty"))');
  });

  it("tournamentSheet_deadlineClose_reopensScheduleDialog", () => {
    const source = readSource("app/(secured)/tournois/[id]/_components/TournamentSheet.tsx");

    expect(source).toContain("setReopenScheduleId(matchForSchedule.id)");
    expect(source).toContain("setMatchForScheduleId(reopenScheduleId)");
  });
});
