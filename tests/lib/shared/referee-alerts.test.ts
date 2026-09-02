import { describe, expect, it } from "@jest/globals";

import {
  BOT_EVENT_CHANNELS,
  botEventChannel,
  formatScoreConflictAlert,
  formatStalledScoreReportAlert,
  isRefereeAlert,
} from "@/lib/shared/referee-alerts";
import type { BotEventKind } from "@/lib/shared/bot-logs";

const TOURNAMENT = { id: 42, name: "Coupe de Fer" };

describe("BOT_EVENT_CHANNELS", () => {
  it("classe toutes les valeurs de BotEventKind sans undefined", () => {
    // Itère explicitement sur Object.entries pour s'assurer que toutes les
    // clés sont traitées et qu'aucune valeur n'est undefined.
    for (const [key, channel] of Object.entries(BOT_EVENT_CHANNELS)) {
      expect(channel).toBeDefined();
      expect(channel).toMatch(/^(JOURNAL|REFEREE)$/);
    }
  });

  it("route score_conflict et score_report_stalled vers REFEREE", () => {
    expect(BOT_EVENT_CHANNELS.score_conflict).toBe("REFEREE");
    expect(BOT_EVENT_CHANNELS.score_report_stalled).toBe("REFEREE");
  });

  it("route tous les autres évènements vers JOURNAL", () => {
    const journalEvents: BotEventKind[] = [
      "match_finished",
      "registration",
      "tournament_created",
      "forfeit",
      "tournament_started",
      "tournament_finished",
      "tournament_underfilled",
    ];

    for (const kind of journalEvents) {
      expect(BOT_EVENT_CHANNELS[kind]).toBe("JOURNAL");
    }
  });
});

describe("botEventChannel et isRefereeAlert", () => {
  it("sont cohérents pour chaque nature d'évènement", () => {
    const events: BotEventKind[] = [
      "tournament_created",
      "registration",
      "forfeit",
      "match_finished",
      "tournament_started",
      "tournament_finished",
      "tournament_underfilled",
      "score_conflict",
      "score_report_stalled",
    ];

    for (const kind of events) {
      const channel = botEventChannel(kind);
      const isReferee = isRefereeAlert(kind);
      // isRefereeAlert doit retourner true ssi le canal est REFEREE.
      expect(isReferee).toBe(channel === "REFEREE");
    }
  });
});

describe("formatScoreConflictAlert", () => {
  it("tient sur une seule ligne", () => {
    const alert = formatScoreConflictAlert({
      tournament: TOURNAMENT,
      tournamentUrl: "http://localhost:3000/tournois/42",
      matchId: 101,
      bracket: "UPPER",
      roundNumber: 3,
      team1Name: "Les Renards",
      team2Name: "Team Nova",
    });

    expect(alert).not.toContain("\n");
  });

  it("contient 'Arbitrage requis'", () => {
    const alert = formatScoreConflictAlert({
      tournament: TOURNAMENT,
      tournamentUrl: null,
      matchId: 101,
      bracket: "UPPER",
      roundNumber: 1,
      team1Name: "Les Renards",
      team2Name: "Team Nova",
    });

    expect(alert).toContain("Arbitrage requis");
  });

  it("nomme le tournoi et son identifiant", () => {
    const alert = formatScoreConflictAlert({
      tournament: TOURNAMENT,
      tournamentUrl: null,
      matchId: 101,
      bracket: "UPPER",
      roundNumber: 1,
      team1Name: "A",
      team2Name: "B",
    });

    expect(alert).toContain("« Coupe de Fer »");
    expect(alert).toContain("(#42)");
  });

  it("inclut le libellé de manche", () => {
    const alert = formatScoreConflictAlert({
      tournament: TOURNAMENT,
      tournamentUrl: null,
      matchId: 101,
      bracket: "UPPER",
      roundNumber: 2,
      team1Name: "A",
      team2Name: "B",
    });

    expect(alert).toContain("Manche 2");
  });

  it("désigne les deux engagées", () => {
    const alert = formatScoreConflictAlert({
      tournament: TOURNAMENT,
      tournamentUrl: null,
      matchId: 101,
      bracket: "UPPER",
      roundNumber: 1,
      team1Name: "Les Renards",
      team2Name: "Team Nova",
    });

    expect(alert).toContain("Les Renards");
    expect(alert).toContain("Team Nova");
  });

  it("porte l'identifiant du match", () => {
    const alert = formatScoreConflictAlert({
      tournament: TOURNAMENT,
      tournamentUrl: null,
      matchId: 12345,
      bracket: "UPPER",
      roundNumber: 1,
      team1Name: "A",
      team2Name: "B",
    });

    expect(alert).toContain("match #12345");
  });

  it("termine avec l'URL quand tournamentUrl est fourni", () => {
    const url = "http://localhost:3000/tournois/42";
    const alert = formatScoreConflictAlert({
      tournament: TOURNAMENT,
      tournamentUrl: url,
      matchId: 101,
      bracket: "UPPER",
      roundNumber: 1,
      team1Name: "A",
      team2Name: "B",
    });

    expect(alert).toContain(url);
    expect(alert.endsWith(url)).toBe(true);
  });

  it("ne contient pas d'URL ni 'null'/'undefined' quand tournamentUrl est null", () => {
    const alert = formatScoreConflictAlert({
      tournament: TOURNAMENT,
      tournamentUrl: null,
      matchId: 101,
      bracket: "UPPER",
      roundNumber: 1,
      team1Name: "A",
      team2Name: "B",
    });

    expect(alert).not.toContain("null");
    expect(alert).not.toContain("undefined");
    expect(alert).not.toContain("http");
    // L'alerte ne doit pas finir par une espace (elle finit par un point).
    expect(alert).not.toMatch(/ $/);
  });

  it("handle le bracket GRAND (Grande finale)", () => {
    const alert = formatScoreConflictAlert({
      tournament: TOURNAMENT,
      tournamentUrl: null,
      matchId: 50,
      bracket: "GRAND",
      roundNumber: 1,
      team1Name: "Champion 1",
      team2Name: "Champion 2",
    });

    // matchRoundLabel retourne "Grande finale" pour GRAND.
    expect(alert).toContain("Grande finale");
  });
});

describe("formatStalledScoreReportAlert", () => {
  it("tient sur une seule ligne", () => {
    const alert = formatStalledScoreReportAlert(
      {
        tournament: TOURNAMENT,
        tournamentUrl: "http://localhost:3000/tournois/42",
        matchId: 101,
        bracket: "UPPER",
        roundNumber: 1,
        team1Name: "A",
        team2Name: "B",
      },
      30,
    );

    expect(alert).not.toContain("\n");
  });

  it("cite le nombre de minutes écoulées", () => {
    const alert = formatStalledScoreReportAlert(
      {
        tournament: TOURNAMENT,
        tournamentUrl: null,
        matchId: 101,
        bracket: "UPPER",
        roundNumber: 1,
        team1Name: "A",
        team2Name: "B",
      },
      30,
    );

    expect(alert).toContain("30 minutes");
  });

  it("cite correctement un nombre de minutes différent", () => {
    const alert = formatStalledScoreReportAlert(
      {
        tournament: TOURNAMENT,
        tournamentUrl: null,
        matchId: 101,
        bracket: "UPPER",
        roundNumber: 1,
        team1Name: "A",
        team2Name: "B",
      },
      45,
    );

    expect(alert).toContain("45 minutes");
  });

  it("contient 'Arbitrage requis' et autres métadonnées du match", () => {
    const alert = formatStalledScoreReportAlert(
      {
        tournament: TOURNAMENT,
        tournamentUrl: null,
        matchId: 101,
        bracket: "UPPER",
        roundNumber: 1,
        team1Name: "Les Renards",
        team2Name: "Team Nova",
      },
      60,
    );

    expect(alert).toContain("Arbitrage requis");
    expect(alert).toContain("« Coupe de Fer »");
    expect(alert).toContain("(#42)");
    expect(alert).toContain("Les Renards");
    expect(alert).toContain("Team Nova");
    expect(alert).toContain("match #101");
  });

  it("termine avec l'URL quand tournamentUrl est fourni", () => {
    const url = "http://localhost:3000/tournois/42";
    const alert = formatStalledScoreReportAlert(
      {
        tournament: TOURNAMENT,
        tournamentUrl: url,
        matchId: 101,
        bracket: "UPPER",
        roundNumber: 1,
        team1Name: "A",
        team2Name: "B",
      },
      30,
    );

    expect(alert.endsWith(url)).toBe(true);
  });

  it("ne contient pas d'URL ni 'null'/'undefined' quand tournamentUrl est null", () => {
    const alert = formatStalledScoreReportAlert(
      {
        tournament: TOURNAMENT,
        tournamentUrl: null,
        matchId: 101,
        bracket: "UPPER",
        roundNumber: 1,
        team1Name: "A",
        team2Name: "B",
      },
      30,
    );

    expect(alert).not.toContain("null");
    expect(alert).not.toContain("undefined");
    expect(alert).not.toContain("http");
    expect(alert).not.toMatch(/ $/);
  });
});

describe("pictogrammes distincts des alertes", () => {
  it("emploie des pictogrammes différents entre conflit et escalade", () => {
    const context = {
      tournament: TOURNAMENT,
      tournamentUrl: null,
      matchId: 101,
      bracket: "UPPER",
      roundNumber: 1,
      team1Name: "A",
      team2Name: "B",
    };

    const conflict = formatScoreConflictAlert(context);
    const stalled = formatStalledScoreReportAlert(context, 30);

    // Le pictogramme est le premier segment avant l'espace, pas le premier
    // « caractère » : un émoji porte un sélecteur de variante (U+FE0F) qui est
    // un point de code à part entière, et `charAt(0)` le laisserait derrière.
    const conflictEmoji = conflict.split(" ")[0];
    const stalledEmoji = stalled.split(" ")[0];

    expect(conflictEmoji).not.toBe(stalledEmoji);
    // ⚠️ pour conflit, ⏱️ pour escalade.
    expect(conflictEmoji).toBe("⚠️");
    expect(stalledEmoji).toBe("⏱️");
  });
});
