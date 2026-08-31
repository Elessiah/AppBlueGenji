import { describe, expect, it } from "@jest/globals";

import {
  formatForfeitLog,
  formatMatchResultLog,
  formatRegistrationLog,
  formatScoreConflictLog,
  formatTournamentCreatedLog,
  formatTournamentDeletedLog,
  formatTournamentFinishedLog,
  formatTournamentStartedLog,
  formatUnderfilledTournamentLog,
} from "@/lib/shared/bot-logs";

const TOURNAMENT = { id: 12, name: "Coupe BlueGenji" };

/**
 * La contrainte qui tient tout le module : le canal de logs est une bande
 * déroulante. Une ligne qui se replie sur trois lignes chasse les neuf
 * évènements précédents de l'écran.
 */
const ALL_LINES = () => [
  formatTournamentCreatedLog({
    tournament: TOURNAMENT,
    format: "SWISS",
    game: "OW2",
    maxTeams: 16,
    participantType: "TEAM",
    organizerPseudo: "Kiro",
    startAt: "2026-03-14T18:00:00.000Z",
  }),
  formatRegistrationLog({
    tournament: TOURNAMENT,
    entrantName: "Les Renards",
    registeredTeams: 3,
    maxTeams: 16,
    participantType: "TEAM",
    byStaff: false,
  }),
  formatForfeitLog({ tournament: TOURNAMENT, entrantName: "Les Renards" }),
  formatMatchResultLog({
    tournament: TOURNAMENT,
    bracket: "UPPER",
    roundNumber: 2,
    team1Name: "Les Renards",
    team2Name: "Team Nova",
    team1Score: 2,
    team2Score: 1,
  }),
  formatScoreConflictLog({
    tournament: TOURNAMENT,
    matchId: 31,
    bracket: "UPPER",
    roundNumber: 2,
    team1Name: "Les Renards",
    team2Name: "Team Nova",
  }),
  formatTournamentStartedLog({
    tournament: TOURNAMENT,
    format: "SURVIVAL",
    registeredTeams: 8,
    participantType: "TEAM",
  }),
  formatTournamentFinishedLog({ tournament: TOURNAMENT, championName: "Les Renards" }),
  formatUnderfilledTournamentLog({
    tournament: TOURNAMENT,
    registeredTeams: 0,
    participantType: "TEAM",
  }),
  formatTournamentDeletedLog({ tournament: TOURNAMENT, actorPseudo: "Kiro", actorId: 3 }),
];

describe("règles de rédaction communes", () => {
  it("tient chaque évènement sur une seule ligne", () => {
    for (const line of ALL_LINES()) {
      expect(line).not.toContain("\n");
    }
  });

  it("nomme le tournoi et son identifiant dans chaque ligne", () => {
    for (const line of ALL_LINES()) {
      expect(line).toContain("« Coupe BlueGenji » (#12)");
    }
  });

  it("ouvre chaque ligne sur la même entame : pictogramme, nature, tournoi", () => {
    // C'est ce qui rend le canal lisible en diagonale : la nature de
    // l'évènement tombe toujours au même endroit.
    for (const line of ALL_LINES()) {
      expect(line).toMatch(/^\S+ [A-ZÀ-Ý][^—]* — « Coupe BlueGenji » \(#12\)/u);
    }
  });

  it("emploie un pictogramme distinct par nature d'évènement", () => {
    const emojis = ALL_LINES().map((line) => line.split(" ")[0]);

    expect(new Set(emojis).size).toBe(emojis.length);
  });
});

describe("formatTournamentCreatedLog", () => {
  it("annonce format, jeu, capacité, auteur et date de début", () => {
    const line = formatTournamentCreatedLog({
      tournament: TOURNAMENT,
      format: "SWISS",
      game: "OW2",
      maxTeams: 16,
      participantType: "TEAM",
      organizerPseudo: "Kiro",
      startAt: "2026-03-14T18:00:00.000Z",
    });

    expect(line).toContain("Ronde suisse · Overwatch 2");
    expect(line).toContain("16 équipes max");
    expect(line).toContain("créé par Kiro");
    expect(line).toContain("début le");
  });

  it("parle de joueurs pour un tournoi individuel", () => {
    const line = formatTournamentCreatedLog({
      tournament: TOURNAMENT,
      format: "SINGLE",
      game: "MR",
      maxTeams: 32,
      participantType: "SOLO",
      organizerPseudo: "Kiro",
      startAt: null,
    });

    expect(line).toContain("32 joueurs max");
    expect(line).toContain("Marvel Rivals");
  });

  it("se passe de la date de début quand elle manque", () => {
    const line = formatTournamentCreatedLog({
      tournament: TOURNAMENT,
      format: "SINGLE",
      game: "MR",
      maxTeams: 8,
      participantType: "TEAM",
      organizerPseudo: "Kiro",
      startAt: null,
    });

    expect(line).not.toContain("début le");
    expect(line.endsWith(".")).toBe(true);
  });

  it("rend telle quelle une valeur de format inconnue plutôt que « undefined »", () => {
    const line = formatTournamentCreatedLog({
      tournament: TOURNAMENT,
      format: "LEGACY_MODE",
      game: "OW2",
      maxTeams: 8,
      participantType: "TEAM",
      organizerPseudo: "Kiro",
      startAt: null,
    });

    expect(line).toContain("LEGACY_MODE");
    expect(line).not.toContain("undefined");
  });
});

describe("formatRegistrationLog", () => {
  it("donne l'engagé et l'effectif atteint", () => {
    const line = formatRegistrationLog({
      tournament: TOURNAMENT,
      entrantName: "Les Renards",
      registeredTeams: 3,
      maxTeams: 16,
      participantType: "TEAM",
      byStaff: false,
    });

    expect(line).toContain("Les Renards");
    expect(line).toContain("3/16 équipes");
    expect(line).not.toContain("staff");
  });

  it("distingue l'ajout du staff de l'inscription d'un joueur", () => {
    const line = formatRegistrationLog({
      tournament: TOURNAMENT,
      entrantName: "Équipe fantôme",
      registeredTeams: 4,
      maxTeams: 16,
      participantType: "TEAM",
      byStaff: true,
    });

    expect(line).toContain("(ajout du staff)");
  });

  it("compte en joueurs sur un tournoi individuel", () => {
    const line = formatRegistrationLog({
      tournament: TOURNAMENT,
      entrantName: "Kiro",
      registeredTeams: 5,
      maxTeams: 32,
      participantType: "SOLO",
      byStaff: false,
    });

    expect(line).toContain("5/32 joueurs");
  });
});

describe("formatMatchResultLog", () => {
  it("porte le score, dans l'ordre des engagés du match", () => {
    const line = formatMatchResultLog({
      tournament: TOURNAMENT,
      bracket: "UPPER",
      roundNumber: 2,
      team1Name: "Les Renards",
      team2Name: "Team Nova",
      team1Score: 2,
      team2Score: 1,
    });

    expect(line).toContain("Match terminé");
    expect(line).toContain("Manche 2");
    expect(line).toContain("Les Renards 2–1 Team Nova");
    expect(line).not.toContain("forfait");
  });

  it("signale un forfait, que le score seul ne dirait pas", () => {
    const line = formatMatchResultLog({
      tournament: TOURNAMENT,
      bracket: "UPPER",
      roundNumber: 1,
      team1Name: "Les Renards",
      team2Name: "Team Nova",
      team1Score: 1,
      team2Score: 0,
      forfeit: true,
    });

    expect(line).toContain("(forfait)");
  });

  it("emploie le vocabulaire de manche partagé avec les rappels", () => {
    const grand = formatMatchResultLog({
      tournament: TOURNAMENT,
      bracket: "GRAND",
      roundNumber: 1,
      team1Name: "A",
      team2Name: "B",
      team1Score: 3,
      team2Score: 2,
    });
    const lower = formatMatchResultLog({
      tournament: TOURNAMENT,
      bracket: "LOWER",
      roundNumber: 4,
      team1Name: "A",
      team2Name: "B",
      team1Score: 3,
      team2Score: 2,
    });

    expect(grand).toContain("Grande finale");
    expect(lower).toContain("Loser bracket · manche 4");
  });
});

describe("formatScoreConflictLog", () => {
  it("désigne le match à arbitrer par son identifiant", () => {
    const line = formatScoreConflictLog({
      tournament: TOURNAMENT,
      matchId: 31,
      bracket: "UPPER",
      roundNumber: 2,
      team1Name: "Les Renards",
      team2Name: "Team Nova",
    });

    expect(line).toContain("match #31");
    expect(line).toContain("Les Renards vs Team Nova");
    expect(line).toContain("Arbitrage requis");
  });
});

describe("formatTournamentStartedLog", () => {
  it("donne l'effectif réel au coup d'envoi et le format", () => {
    const line = formatTournamentStartedLog({
      tournament: TOURNAMENT,
      format: "BG_SURVIE",
      registeredTeams: 11,
      participantType: "TEAM",
    });

    expect(line).toContain("11 équipes");
    expect(line).toContain("BlueGenji Survie");
  });
});

describe("formatTournamentFinishedLog", () => {
  it("annonce la championne", () => {
    const line = formatTournamentFinishedLog({
      tournament: TOURNAMENT,
      championName: "Les Renards",
    });

    expect(line).toContain("Les Renards l'emporte");
  });

  it("reste une phrase correcte quand aucun classement ne désigne de championne", () => {
    const line = formatTournamentFinishedLog({ tournament: TOURNAMENT, championName: null });

    expect(line).toBe("🏆 Tournoi terminé — « Coupe BlueGenji » (#12).");
  });
});

describe("formatUnderfilledTournamentLog", () => {
  it("distingue le plateau vide de l'unique engagée", () => {
    const empty = formatUnderfilledTournamentLog({
      tournament: TOURNAMENT,
      registeredTeams: 0,
      participantType: "TEAM",
    });
    const alone = formatUnderfilledTournamentLog({
      tournament: TOURNAMENT,
      registeredTeams: 1,
      participantType: "TEAM",
    });

    expect(empty).toContain("aucun engagement");
    expect(alone).toContain("1 seule équipe engagée");
  });

  it("accorde au masculin sur un tournoi individuel", () => {
    const alone = formatUnderfilledTournamentLog({
      tournament: TOURNAMENT,
      registeredTeams: 1,
      participantType: "SOLO",
    });

    expect(alone).toContain("1 seul joueur engagé");
  });
});

describe("formatTournamentDeletedLog", () => {
  it("nomme l'administrateur responsable", () => {
    const line = formatTournamentDeletedLog({
      tournament: TOURNAMENT,
      actorPseudo: "Kiro",
      actorId: 3,
    });

    expect(line).toContain("par Kiro (#3)");
  });
});
