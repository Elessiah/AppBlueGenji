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
