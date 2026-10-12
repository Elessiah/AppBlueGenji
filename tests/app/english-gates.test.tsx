/**
 * Portes de l'anglais des équipes et des joueurs (revue de performance du lot
 * 9-2) : l'anglais servi au chargement complet est rendu et gardé ; sans lui,
 * l'écran d'attente ; la fiche d'une équipe attend ses deux espaces ensemble.
 * Fichier à part : les chargeurs sont des états de module.
 */
import { afterAll, describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayersTextGate, StatsPanelGate, TeamErrorsTextGate, TeamPageTextGate } from "@/components/i18n/english-gates";
import { englishPlayers, englishStatsPanel, englishTeam, englishTeamErrors } from "@/components/i18n/english-loaders-account";
import { usePlayersText } from "@/components/i18n/players-text";
import { useStatsPanelI18n } from "@/components/i18n/stats-panel-i18n";
import { useTeamErrorsText } from "@/components/i18n/team-errors-text";
import { useTeamPageText } from "@/components/i18n/team-page-text";
import { statsPanelMessages } from "@/lib/shared/stats-text";
import { messagesFor } from "@/lib/server/i18n-messages";

const EN = messagesFor("en");
const EN_STATS = statsPanelMessages(EN);
const globals = globalThis as { window?: unknown };

function inBrowser<T>(run: () => T): T {
  globals.window = globalThis;
  try {
    return run();
  } finally {
    delete globals.window;
  }
}

afterAll(() => {
  delete globals.window;
});

function TeamProbe() {
  const stats = useStatsPanelI18n();
  return (
    <>
      {useTeamPageText().t("meta.fallbackTitle")} / {stats?.locale ?? "fr"}
    </>
  );
}
function PlayersProbe() {
  return <>{usePlayersText().t("meta.title")}</>;
}
function ErrorsProbe() {
  return <>{useTeamErrorsText().locale}</>;
}

describe("portes : français sans attente", () => {
  it("rien à charger en français", () => {
    const html = renderToStaticMarkup(
      <TeamErrorsTextGate locale="fr">
        <PlayersTextGate locale="fr">
          <ErrorsProbe /> <PlayersProbe />
        </PlayersTextGate>
      </TeamErrorsTextGate>,
    );
    expect(html).toBe("fr Joueurs");
  });
});

describe("portes : anglais", () => {
  it("rien reçu : l'écran d'attente", () => {
    for (const gate of [
      <TeamErrorsTextGate key="e" locale="en">x</TeamErrorsTextGate>,
      <PlayersTextGate key="p" locale="en">x</PlayersTextGate>,
      <StatsPanelGate key="s" locale="en">x</StatsPanelGate>,
      <TeamPageTextGate key="t" locale="en">x</TeamPageTextGate>,
    ]) {
      expect(inBrowser(() => renderToStaticMarkup(gate))).toContain('role="status"');
    }
  });

  it("la fiche d'une équipe attend ses deux espaces : l'un sans l'autre, toujours l'écran d'attente", () => {
    const html = inBrowser(() =>
      renderToStaticMarkup(
        <TeamPageTextGate locale="en" messages={EN.team}>
          <TeamProbe />
        </TeamPageTextGate>,
      ),
    );
    expect(html).toContain('role="status"');
  });

  it("servi au chargement complet : rendu en anglais, et gardé pour la session", () => {
    const html = inBrowser(() =>
      renderToStaticMarkup(
        <TeamErrorsTextGate locale="en" messages={EN.teamErrors}>
          <PlayersTextGate locale="en" messages={EN.players}>
            <TeamPageTextGate locale="en" messages={EN.team} stats={EN_STATS}>
              <ErrorsProbe /> <PlayersProbe /> <TeamProbe />
            </TeamPageTextGate>
          </PlayersTextGate>
        </TeamErrorsTextGate>,
      ),
    );
    expect(html).toBe(`en ${EN.players.meta.title} ${EN.team.meta.fallbackTitle} / en`);
    expect(englishTeamErrors.loaded()).toBe(EN.teamErrors);
    expect(englishPlayers.loaded()).toBe(EN.players);
    expect(englishTeam.loaded()).toBe(EN.team);
    expect(englishStatsPanel.loaded()).toEqual(EN_STATS);
    // Une navigation suivante (rien sérialisé) : rendu tout de suite.
    const next = inBrowser(() =>
      renderToStaticMarkup(
        <StatsPanelGate locale="en">
          <PlayersTextGate locale="en">
            <PlayersProbe />
          </PlayersTextGate>
        </StatsPanelGate>,
      ),
    );
    expect(next).toBe(EN.players.meta.title);
  });
});
