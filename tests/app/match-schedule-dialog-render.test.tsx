/**
 * `MatchScheduleDialog` rendu (FR et `/en`) : sous-titre traduit, mois
 * présélectionné tenu pour vide, avis aux joueurs derrière un « i », région
 * de date passée toujours montée. La logique de l'avertissement vit dans
 * `pastStartWarning` (`tests/lib/shared/match-start-entry.test.ts`).
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

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchScheduleDialog } from "@/app/(secured)/tournois/[id]/_components/MatchScheduleDialog";
import { EntrantProvider } from "@/app/(secured)/tournois/[id]/_lib/entrant-link";
import { buildEntrantLogoMap } from "@/lib/shared/entrant-logos";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import { ToastProvider } from "@/components/ui/toast";
import { messagesFor } from "@/lib/server/i18n-messages";
import { tournamentActionsMessages } from "@/lib/shared/tournament-actions-text";
import type { BracketMatch } from "@/lib/shared/types";
import enDialogs from "@/messages/en/tournamentDialogs.json";
import frDialogs from "@/messages/fr/tournamentDialogs.json";
import { bracketMatch } from "../helpers/bracket-match";

const EN = messagesFor("en");
const noop = () => undefined;
const globals = globalThis as { document?: unknown; window?: unknown };
const saved = { document: globals.document, window: globals.window };
beforeAll(() => {
  globals.document = { body: {}, referrer: "" };
  globals.window = { location: { origin: "http://localhost", pathname: "/tournois/1" }, history: { length: 1 } };
  jest.useFakeTimers({ now: new Date("2026-05-05T10:00:00.000Z") });
});
afterAll(() => {
  globals.document = saved.document;
  globals.window = saved.window;
  jest.useRealTimers();
});

function render(locale: "fr" | "en", match: BracketMatch, refereeScheduling = false): string {
  const tree: ReactElement = (
    <ToastProvider>
      <EntrantProvider participantType="TEAM" soloUserIds={{}} logos={buildEntrantLogoMap([])}>
        <MatchScheduleDialog
          match={match}
          tournamentStartAt="2026-05-01T18:00:00.000Z"
          tournamentFinished={false}
          refereeScheduling={refereeScheduling}
          onClose={noop}
          onSaved={noop}
        />
      </EntrantProvider>
    </ToastProvider>
  );
  if (locale === "fr") return renderToStaticMarkup(tree);
  return renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <TournamentActionsTextProvider locale="en" messages={tournamentActionsMessages(EN)}>
        {tree}
      </TournamentActionsTextProvider>
    </AppLocaleProvider>,
  );
}

const versus = bracketMatch({ id: 7, roundNumber: 2, team1Id: 10, team1Name: "Alpha", team2Id: 11, team2Name: "Bravo", status: "READY" });
// Texte lu, sans les initiales décoratives (`aria-hidden`) des emblèmes.
const text = (html: string) => html.replace(/<span aria-hidden="true"[^>]*>[^<]*<\/span>/g, "").replace(/<[^>]+>/g, "");

describe("MatchScheduleDialog — sous-titre", () => {
  it("relie les engagés par « contre » en français, « vs » en anglais", () => {
    expect(text(render("fr", versus))).toContain("Alpha contre Bravo");
    expect(text(render("en", versus))).toContain("Alpha vs Bravo");
    expect(text(render("fr", versus))).not.toContain("Alpha vs Bravo");
  });

  it("nomme une place vide par la clé traduite", () => {
    const tbd = bracketMatch({ id: 8, team1Id: 10, team1Name: "Alpha", team2Id: null, team2Name: null, status: "PENDING" });
    expect(text(render("fr", tbd))).toContain(`Alpha contre ${frDialogs.schedule.tbd}`);
    expect(text(render("en", tbd))).toContain(`Alpha vs ${enDialogs.schedule.tbd}`);
  });
});

describe("MatchScheduleDialog — mois présélectionné", () => {
  it("sans date posée : mois affiché, mais saisie tenue pour « aucun horaire »", () => {
    const html = render("fr", versus);
    // Le mois courant (mai) reste présélectionné dans sa liste…
    expect(html).toMatch(/<option value="5" selected="">mai<\/option>/);
    // …sans rendre la saisie incomplète : ni « jour manquant », ni « Vider la date ».
    expect(html).toContain(frDialogs.schedule.none);
    expect(html).not.toContain(frDialogs.schedule.clear);
    expect(text(html)).not.toContain("À compléter");
  });

  it("une date posée garde son mois et propose de la vider", () => {
    const html = render("fr", { ...versus, startAt: "2026-05-20T19:00:00.000Z" });
    expect(html).toContain(frDialogs.schedule.clear);
    expect(html).toContain(frDialogs.schedule.preview);
  });
});

describe("MatchScheduleDialog — avis aux joueurs", () => {
  it("passe derrière un « i », hors du paragraphe d'aide permanent (FR et EN)", () => {
    for (const [locale, dialogs] of [["fr", frDialogs], ["en", enDialogs]] as const) {
      const html = render(locale, versus);
      const hint = html.match(/<p id="match-start-at-hint"[^>]*>([^<]*)<\/p>/)?.[1] ?? "";
      expect(hint).toBe(dialogs.schedule.hint.replace(/'/g, "&#x27;"));
      expect(html).toMatch(/<div id="match-start-at-notice"[^>]*hidden="">/);
      expect(text(html)).toContain(dialogs.schedule.notice.replace(/'/g, "&#x27;"));
      expect(html).toContain('aria-controls="match-start-at-notice"');
    }
  });

  it("tournoi planifié par l'arbitrage : l'avis de retrait, toujours derrière le « i »", () => {
    const html = render("fr", versus, true);
    expect(text(html)).toContain(frDialogs.schedule.noticePlanning.replace(/'/g, "&#x27;"));
    expect(html.match(/<p id="match-start-at-hint"[^>]*>([^<]*)<\/p>/)?.[1]).not.toContain("annoncé aux joueurs");
  });

  it("match joué : aucun avis, donc aucun « i »", () => {
    const html = render("fr", { ...versus, status: "COMPLETED", team1Score: 2, team2Score: 0, winnerTeamId: 10 });
    expect(html).not.toContain("match-start-at-notice");
  });
});

describe("MatchScheduleDialog — date passée", () => {
  it("la région d'avertissement est montée dès l'ouverture, vide et sans cadre", () => {
    for (const locale of ["fr", "en"] as const) {
      const html = render(locale, versus);
      expect(html).toContain('<output id="match-start-past-warning" tabindex="-1" style="display:block"></output>');
    }
  });
});
