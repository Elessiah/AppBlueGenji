import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarCard } from "@/components/cyber/landing/CalendarCard";
import { JoinCTA } from "@/components/cyber/landing/JoinCTA";
import { Leaderboard } from "@/components/cyber/landing/Leaderboard";
import { ToastProvider } from "@/components/ui/toast";
import { defaultSiteCopy } from "@/lib/shared/site-copy";
import type { LandingCalendarEvent, LandingLeaderboardRow } from "@/lib/shared/landing";

// `EditableCopy` (rendu par `JoinCTA`) appelle `useRouter()` pour rafraîchir
// la page après une édition — sans routeur applicatif monté ici.
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

function leaderboardRow(partial: Partial<LandingLeaderboardRow> = {}): LandingLeaderboardRow {
  return {
    rank: 1,
    teamId: 1,
    teamName: "Alpha",
    logoUrl: null,
    wins: 5,
    losses: 1,
    draws: 0,
    points: 500,
    trend: "flat",
    trendValue: 0,
    ...partial,
  };
}

describe("Leaderboard — accessibilité", () => {
  it("porte un vrai titre de section (h3), pas un simple span", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <Leaderboard initialRows={[leaderboardRow()]} />
      </ToastProvider>,
    );
    expect(markup).toMatch(/<h3[^>]*>\s*TOP ÉQUIPES/);
  });

  it("annonce le filtre actif via aria-pressed", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <Leaderboard initialRows={[leaderboardRow()]} />
      </ToastProvider>,
    );
    // Le chip "Général" (filtre par défaut "all") est pressé, les deux autres non.
    const generalIndex = markup.indexOf(">Général<");
    const beforeGeneral = markup.slice(Math.max(0, generalIndex - 200), generalIndex);
    expect(beforeGeneral).toContain('aria-pressed="true"');

    const overwatchIndex = markup.indexOf(">Overwatch<");
    const beforeOverwatch = markup.slice(Math.max(0, overwatchIndex - 200), overwatchIndex);
    expect(beforeOverwatch).toContain('aria-pressed="false"');
  });

  it("expose une structure de tableau accessible", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <Leaderboard initialRows={[leaderboardRow()]} />
      </ToastProvider>,
    );
    expect(markup).toContain('role="table"');
    expect(markup).toContain('role="row"');
    expect(markup).toContain('role="columnheader"');
    expect(markup).toContain('role="cell"');
    expect(markup).toContain('aria-label="Tendance"');
  });
});

describe("CalendarCard — accessibilité", () => {
  it("porte un vrai titre de section (h3), pas un simple span", () => {
    const markup = renderToStaticMarkup(<CalendarCard events={[] as LandingCalendarEvent[]} />);
    expect(markup).toMatch(/<h3[^>]*>\s*PROCHAINS ÉVÉNEMENTS/);
  });

  const event: LandingCalendarEvent = {
    tournamentId: 42,
    name: "Coupe d'automne",
    game: "OW",
    startAt: "2026-10-12T18:00:00.000Z",
    registrationOpenAt: "2026-10-01T18:00:00.000Z",
    registrationCloseAt: "2026-10-11T18:00:00.000Z",
    state: "REGISTRATION",
    maxTeams: 16,
    registeredTeams: 4,
  };

  it("mène chaque événement à la fiche de son tournoi", () => {
    const markup = renderToStaticMarkup(<CalendarCard events={[event, { ...event, tournamentId: 7, name: "Ligue" }]} />);
    expect(markup).toMatch(/<a[^>]*href="\/tournois\/42"[^>]*>Coupe d&#x27;automne<\/a>/);
    expect(markup).toMatch(/<a[^>]*href="\/tournois\/7"[^>]*>Ligue<\/a>/);
  });

  it("donne au lien le seul nom du tournoi, sans date, jeu ni état", () => {
    const markup = renderToStaticMarkup(<CalendarCard events={[event]} />);
    const link = markup.match(/<a[^>]*href="\/tournois\/42"[^>]*>([\s\S]*?)<\/a>/);
    expect(link?.[1]).toBe("Coupe d&#x27;automne");
    expect(link?.[0]).not.toContain("aria-label");
  });
});

describe("JoinCTA — accessibilité", () => {
  it("porte le titre de son propre appel (h2), plutôt qu'un h3 rattaché à la section précédente", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <JoinCTA copy={defaultSiteCopy()} />
      </ToastProvider>,
    );
    expect(markup).toMatch(/<h2[^>]*>/);
    expect(markup).not.toMatch(/<h3[^>]*>.*Ton équipe/);
  });
});
