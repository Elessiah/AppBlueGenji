import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { Leaderboard } from "@/components/cyber/landing/Leaderboard";
import { ToastProvider } from "@/components/ui/toast";
import type { LandingLeaderboardRow } from "@/lib/shared/landing";

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

describe("Leaderboard", () => {
  it("mène vers l'annuaire des équipes, pas des joueurs", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <Leaderboard initialRows={[leaderboardRow()]} />
      </ToastProvider>,
    );
    expect(markup).toContain('href="/equipes"');
    expect(markup).not.toContain('href="/joueurs"');
  });

  it("affiche un état vide plutôt qu'un tableau muet, en structure de tableau valide", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <Leaderboard initialRows={[]} />
      </ToastProvider>,
    );
    expect(markup).toContain("Aucune équipe classée pour le moment.");
    // `role="table"` n'accepte que des `role="row"` comme enfants directs.
    const rowIndex = markup.indexOf('role="row"', markup.indexOf("Aucune équipe classée") - 200);
    expect(rowIndex).toBeGreaterThan(-1);
    expect(rowIndex).toBeLessThan(markup.indexOf("Aucune équipe classée"));
    expect(markup).toMatch(/role="cell"[^>]*>Aucune équipe classée/);
  });

  it("garde le classement quand il n'est pas vide", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <Leaderboard initialRows={[leaderboardRow({ teamName: "Bravo Squad" })]} />
      </ToastProvider>,
    );
    expect(markup).toContain("Bravo Squad");
    expect(markup).not.toContain("Aucune équipe classée");
  });
});
