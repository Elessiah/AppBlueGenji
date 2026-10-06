import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { StatsPanel } from "@/components/stats/StatsPanel";
import { messagesFor } from "@/lib/server/i18n-messages";
import { computeDeepStats, type StatsMatch, type StatsOutcome, type TeamRankingPosition } from "@/lib/shared/stats";
import { statsPanelMessages } from "@/lib/shared/stats-text";
import { readSource } from "../helpers/read-source";

/**
 * Bloc de statistiques (lot 4, `docs/features/I18N.md` § Classement) : français
 * inchangé par défaut (fiches équipe et joueur pas encore traduites), anglais
 * complet dès qu'une page lui passe ses messages.
 */

const NOW = new Date("2026-06-15T12:00:00Z");

function match(matchId: number, outcome: StatsOutcome, overrides: Partial<StatsMatch> = {}): StatsMatch {
  return {
    matchId,
    tournamentId: 10,
    tournamentName: "Cup",
    game: matchId % 2 ? "OW" : "MR",
    format: matchId % 3 ? "SINGLE" : "BG_SURVIE",
    bracket: "UPPER",
    playedAt: `2026-0${(matchId % 5) + 1}-1${matchId % 9}T18:00:00Z`,
    opponentTeamId: 90 + (matchId % 3),
    opponentName: `Rival ${matchId % 3}`,
    outcome,
    scoreFor: 2,
    scoreAgainst: 1,
    forfeit: "NONE",
    ...overrides,
  };
}

const STATS = computeDeepStats(
  [match(1, "WIN"), match(2, "WIN"), match(3, "LOSS"), match(4, "DRAW"), match(5, "WIN"), match(6, "WIN"), match(7, "WIN")],
  [],
  NOW,
);
const RANKING: TeamRankingPosition = { position: 3, total: 12, points: 540, placementPoints: -12 };
const EN = { locale: "en" as const, messages: statsPanelMessages(messagesFor("en")) };

function text(html: string): string {
  const attributes = [...html.matchAll(/(?:aria-label|title)="([^"]*)"/g)].map((m) => m[1]);
  return [html.replace(/<[^>]+>/g, " "), ...attributes].join(" ").replace(/&#x27;/g, "'");
}

describe("StatsPanel — anglais", () => {
  const html = renderToStaticMarkup(<StatsPanel stats={STATS} accent="violet" ranking={RANKING} i18n={EN} />);
  const visible = text(html);

  it("n'affiche aucun mot français", () => {
    expect(visible).not.toMatch(/[éèêàçùôœ]/);
    for (const french of ["Palmarès", "Victoires", "Défaites", "Forfaits", "Adversaire", "Aucun", "matchs", "d'affilée", "Rang"]) {
      expect(visible).not.toContain(french);
    }
    expect(visible).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  it("titres, tuiles, légende de la cote", () => {
    expect(visible).toContain("Track record");
    expect(visible).toContain("Site ranking");
    expect(visible).toContain("out of 12 teams");
    expect(visible).toContain("Ranking points");
    expect(visible).toContain("Base 500");
    expect(visible).toContain("Placement points");
  });

  it("bilans W / D / L, taux sans espace, série au pluriel anglais", () => {
    expect(visible).toMatch(/\d+W \/ \d+D \/ \d+L|\d+W \/ \d+L/);
    expect(visible).toMatch(/\d+%/);
    expect(visible).not.toMatch(/\d+ %/);
    expect(visible).toContain("Streak broken by a draw");
    const streak = renderToStaticMarkup(<StatsPanel stats={{ ...STATS, currentStreak: { kind: "WIN", length: 3 } }} i18n={EN} />);
    expect(streak).toContain("3 wins in a row");
    const one = renderToStaticMarkup(<StatsPanel stats={{ ...STATS, currentStreak: { kind: "LOSS", length: 1 } }} i18n={EN} />);
    expect(one).toContain("1 loss in a row");
  });

  it("libellés de jeu et de format du glossaire", () => {
    expect(visible).toContain("Single elim.");
    expect(visible).toContain("BlueGenji's Survival");
    expect(visible).toContain("Overwatch");
  });

  it("mois et dates au format américain", () => {
    expect(visible).toContain("Jan");
    expect(visible).not.toContain("janv.");
    expect(visible).toMatch(/First match on \d{1,2}\/\d{1,2}\/2026/);
  });

  it("pastilles de forme W / L / D, nul compris", () => {
    expect(html).toContain('aria-label="Draw"');
    expect(html).toContain('aria-label="Win"');
  });
});

describe("StatsPanel — français inchangé", () => {
  it("sans messages, le bloc reste en français, à l'octet près pour ses phrases", () => {
    const visible = text(renderToStaticMarkup(<StatsPanel stats={STATS} ranking={RANKING} />));
    expect(visible).toContain("Palmarès");
    expect(visible).toContain("sur 12 équipes");
    expect(visible).toContain("Série interrompue par un nul");
    const streak = renderToStaticMarkup(<StatsPanel stats={{ ...STATS, currentStreak: { kind: "WIN", length: 3 } }} />);
    expect(streak).toContain("3 victoires d&#x27;affilée");
    expect(visible).toContain("Simple élim.");
    expect(visible).toContain("janv.");
    expect(visible).toMatch(/\d+ %/);
    expect(visible).toMatch(/Premier match le \d{2}\/\d{2}\/2026/);
  });

  it("aucune inscription à venir : pas d'indice ; une : singulier", () => {
    const one = renderToStaticMarkup(<StatsPanel stats={{ ...STATS, tournamentsUpcoming: 1 }} />);
    expect(one).toContain("+ 1 inscription à venir");
    const two = renderToStaticMarkup(<StatsPanel stats={{ ...STATS, tournamentsUpcoming: 2 }} i18n={EN} />);
    expect(two).toContain("+ 2 upcoming entries");
  });

  it("n'importe pas next-intl : le formateur réduit suffit au client", () => {
    expect(readSource("components/stats/StatsPanel.tsx")).not.toMatch(/from "next-intl/);
    expect(readSource("app/classement/RankingMore.tsx")).not.toMatch(/from "next-intl/);
    // « Afficher plus » ne reçoit que l'espace `more` : aucun dictionnaire du classement dans le paquet.
    expect(readSource("app/classement/RankingMore.tsx")).not.toMatch(/messages\/(fr|en)\/ranking\.json/);
  });
});

describe("StatsPanel — accords du pluriel français", () => {
  const single = computeDeepStats([match(1, "WIN")], [], NOW);
  const solo: TeamRankingPosition = { position: 1, total: 1, points: 520, placementPoints: 0 };

  it("un seul match : singulier partout (répartition, activité, forme, classement)", () => {
    const visible = text(renderToStaticMarkup(<StatsPanel stats={single} ranking={solo} />));
    expect(visible).toContain("1 victoire sur 1 match");
    expect(visible).toContain(": 1 match joué au total");
    expect(visible).toContain("Dernier résultat, du plus récent au plus ancien");
    expect(visible).toContain("sur 1 équipe");
    expect(visible).not.toMatch(/\b1 (victoires|matchs|équipes|derniers)\b/);
  });

  it("zéro victoire au singulier, plusieurs matchs au pluriel", () => {
    const losses = computeDeepStats([match(1, "LOSS"), match(3, "LOSS")], [], NOW);
    const visible = text(renderToStaticMarkup(<StatsPanel stats={losses} />));
    expect(visible).toContain("0 victoire sur 2 matchs");
    expect(visible).toContain(": 2 matchs joués au total");
    expect(visible).toContain("2 derniers résultats");
  });

  it("anglais : singulier d'une seule équipe, dernier résultat", () => {
    const visible = text(renderToStaticMarkup(<StatsPanel stats={single} ranking={solo} i18n={EN} />));
    expect(visible).toContain("out of 1 team");
    expect(visible).not.toContain("out of 1 teams");
    expect(visible).toContain("Last result, most recent first");
    expect(visible).toContain("won 1 of 1");
  });
});
