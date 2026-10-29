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
    draws: 0,
    points: 500,
    trend: "flat",
    trendValue: 0,
    ...partial,
  };
}

describe("Leaderboard", () => {
  it("mène vers la page dédiée du classement, ni l'annuaire ni les joueurs", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <Leaderboard initialRows={[leaderboardRow()]} />
      </ToastProvider>,
    );
    expect(markup).toContain('href="/classement"');
    expect(markup).not.toContain('href="/equipes"');
    expect(markup).not.toContain('href="/joueurs"');
  });

  it("colore les défaites, laisse neutre un compte nul", () => {
    const render = (losses: number) =>
      renderToStaticMarkup(
        <ToastProvider>
          <Leaderboard initialRows={[leaderboardRow({ losses })]} />
        </ToastProvider>,
      );
    expect(render(2)).toContain('class="result-loss">2<');
    expect(render(0)).not.toContain("result-loss");
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

describe("Leaderboard — nom qui ne garde rien de visible", () => {
  it("pose le repli traduit « Équipe #id » (pastille, lien, titre), jamais « # »", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <Leaderboard initialRows={[leaderboardRow({ teamId: 12, teamName: null })]} />
      </ToastProvider>,
    );
    expect(markup).toContain(">Équipe #12<");
    expect(markup).toContain('title="Voir la fiche de l&#x27;équipe #12"');
    // La pastille prend l'initiale du repli, plus « # ».
    expect(markup).toMatch(/--size:24px[^"]*">É<\/div>/);
    expect(markup).not.toContain(">#12<");
  });
});

describe("Leaderboard — nuls et entrées", () => {
  const render = (row: Partial<LandingLeaderboardRow>) =>
    renderToStaticMarkup(
      <ToastProvider>
        <Leaderboard initialRows={[leaderboardRow(row)]} />
      </ToastProvider>,
    );

  it("Leaderboard_rowWithDraws_showsShortAndSpokenDraws", () => {
    const markup = render({ wins: 0, losses: 0, draws: 1 });
    expect(markup).toContain('<span aria-hidden="true">1 N</span>');
    expect(markup).toContain('<span class="sr-only">1 match nul</span>');
  });

  it("Leaderboard_rowWithSeveralDraws_pluralizesSpokenLabel", () => {
    expect(render({ draws: 3 })).toContain('<span class="sr-only">3 matchs nuls</span>');
  });

  it("Leaderboard_rowWithoutDraws_showsNoDrawsSpan", () => {
    expect(render({ draws: 0 })).not.toContain('class="draws"');
  });

  it("Leaderboard_newEntry_usesItsOwnTrendColour", () => {
    const markup = render({ trend: "new" });
    expect(markup).toContain("trendNew");
    expect(markup).not.toContain("trendUp");
  });
});
