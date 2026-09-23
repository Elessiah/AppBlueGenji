import { describe, expect, it } from "@jest/globals";

import {
  formatEndurancePenaltyLiftedLog,
  formatEndurancePenaltyLog,
  formatEntrantRemovedLog,
  formatForfeitLog,
  formatMatchResultLog,
  formatPlayerSignupLog,
  formatRegistrationLog,
  formatRoundRolledBackLog,
  formatTournamentCreatedLog,
  formatTournamentDeletedLog,
  formatTournamentFinishedLog,
  formatTournamentStartedLog,
  formatUnderfilledTournamentLog,
} from "@/lib/shared/bot-logs";
import { ANONYMOUS_PLAYER_LABEL, entrantLabel, staffAuditLine } from "@/lib/shared/log-privacy";

const TOURNAMENT = { id: 12, name: "Coupe BlueGenji" };

/**
 * La contrainte qui tient tout le module : le canal de logs est une bande
 * déroulante. Une ligne qui se replie sur trois lignes chasse les neuf
 * évènements précédents de l'écran.
 */
const TOURNAMENT_LINES = () => [
  formatTournamentCreatedLog({
    tournament: TOURNAMENT,
    format: "SWISS",
    game: "OW",
    maxTeams: 16,
    participantType: "TEAM",
    startAt: "2026-03-14T18:00:00.000Z",
  }),
  formatRegistrationLog({
    tournament: TOURNAMENT,
    entrant: { name: "Les Renards", participantType: "TEAM" },
    registeredTeams: 3,
    maxTeams: 16,
    byStaff: false,
  }),
  formatForfeitLog({ tournament: TOURNAMENT, entrant: { name: "Les Renards", participantType: "TEAM" } }),
  formatEntrantRemovedLog({
    tournament: TOURNAMENT,
    entrant: { name: "Les Renards", participantType: "TEAM" },
    registeredTeams: 2,
    maxTeams: 16,
  }),
  formatMatchResultLog({
    tournament: TOURNAMENT,
    bracket: "UPPER",
    roundNumber: 2,
    team1: { name: "Les Renards", participantType: "TEAM" },
    team2: { name: "Team Nova", participantType: "TEAM" },
    team1Score: 2,
    team2Score: 1,
  }),
  formatTournamentStartedLog({
    tournament: TOURNAMENT,
    format: "SURVIVAL",
    registeredTeams: 8,
    participantType: "TEAM",
  }),
  formatTournamentFinishedLog({ tournament: TOURNAMENT, champion: { name: "Les Renards", participantType: "TEAM" } }),
  formatUnderfilledTournamentLog({
    tournament: TOURNAMENT,
    registeredTeams: 0,
    participantType: "TEAM",
  }),
  formatTournamentDeletedLog({ tournament: TOURNAMENT }),
  formatEndurancePenaltyLog({
    tournament: TOURNAMENT,
    entrant: { name: "Les Renards", participantType: "TEAM" },
    points: 3,
    reason: "Retard au coup d'envoi",
  }),
  formatEndurancePenaltyLiftedLog({
    tournament: TOURNAMENT,
    entrant: { name: "Les Renards", participantType: "TEAM" },
    points: 3,
  }),
];

/**
 * Tout ce que le site journalise, tournoi ou non.
 *
 * L'inscription d'un joueur est la seule ligne qui ne parle d'aucun tournoi :
 * elle est donc tenue à l'écart de la règle « nomme le tournoi », et à rien
 * d'autre — une ligne sur trois lignes ou un pictogramme repris ailleurs
 * abîmerait le canal exactement de la même façon.
 */
const ALL_LINES = () => [
  ...TOURNAMENT_LINES(),
  formatPlayerSignupLog({ provider: "GOOGLE" }),
];

describe("règles de rédaction communes", () => {
  it("tient chaque évènement sur une seule ligne", () => {
    for (const line of ALL_LINES()) {
      expect(line).not.toContain("\n");
    }
  });

  it("nomme le tournoi et son identifiant dans chaque ligne qui en concerne un", () => {
    for (const line of TOURNAMENT_LINES()) {
      expect(line).toContain("« Coupe BlueGenji » (#12)");
    }
  });

  it("ouvre chaque ligne sur la même entame : pictogramme, nature, sujet nommé", () => {
    // C'est ce qui rend le canal lisible en diagonale : la nature de
    // l'évènement tombe toujours au même endroit — y compris sur la seule ligne
    // dont le sujet n'est pas un tournoi.
    for (const line of ALL_LINES()) {
      expect(line).toMatch(/^\S+ [A-ZÀ-Ý][^—]* — (« .+ » \(#\d+\)|compte créé via )/u);
    }
  });

  it("emploie un pictogramme distinct par nature d'évènement", () => {
    const emojis = ALL_LINES().map((line) => line.split(" ")[0]);

    expect(new Set(emojis).size).toBe(emojis.length);
  });
});

describe("formatEntrantRemovedLog", () => {
  it("nomme l'équipe et l'effectif restant, et l'auteur « le staff »", () => {
    // Le canal est la **seule** trace qui subsiste d'une inscription effacée :
    // après coup, rien sur la page ne dira que cet engagé a été inscrit.
    const line = formatEntrantRemovedLog({
      tournament: TOURNAMENT,
      entrant: { name: "Les Renards", participantType: "TEAM" },
      registeredTeams: 2,
      maxTeams: 16,
    });

    expect(line).toContain("Inscription retirée");
    expect(line).toContain("Les Renards");
    expect(line).toContain("par le staff");
    expect(line).toContain("2/16 équipes");
  });

  it("parle de joueurs pour un tournoi individuel", () => {
    const line = formatEntrantRemovedLog({
      tournament: TOURNAMENT,
      entrant: { name: "Nova", participantType: "SOLO" },
      registeredTeams: 7,
      maxTeams: 32,
    });

    expect(line).toContain("7/32 joueurs");
  });

  it("ne se confond pas avec un abandon", () => {
    // Deux faits distincts : l'abandon laisse l'engagé au classement avec un
    // forfait à son nom, le retrait efface son inscription avant le tirage.
    const removed = formatEntrantRemovedLog({
      tournament: TOURNAMENT,
      entrant: { name: "Les Renards", participantType: "TEAM" },
      registeredTeams: 2,
      maxTeams: 16,
    });
    const forfeit = formatForfeitLog({ tournament: TOURNAMENT, entrant: { name: "Les Renards", participantType: "TEAM" } });

    expect(removed.split(" ")[0]).not.toBe(forfeit.split(" ")[0]);
    expect(removed).not.toContain("Abandon");
  });
});

describe("formatTournamentCreatedLog", () => {
  it("annonce format, jeu, capacité et date de début, sans nommer l'organisateur", () => {
    const line = formatTournamentCreatedLog({
      tournament: TOURNAMENT,
      format: "SWISS",
      game: "OW",
      maxTeams: 16,
      participantType: "TEAM",
      startAt: "2026-03-14T18:00:00.000Z",
    });

    expect(line).toContain("Ronde suisse · Overwatch");
    expect(line).toContain("16 équipes max");
    expect(line).not.toContain("créé par");
    expect(line).toContain("début le");
  });

  it("parle de joueurs pour un tournoi individuel", () => {
    const line = formatTournamentCreatedLog({
      tournament: TOURNAMENT,
      format: "SINGLE",
      game: "MR",
      maxTeams: 32,
      participantType: "SOLO",
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
      startAt: null,
    });

    expect(line).not.toContain("début le");
    expect(line.endsWith(".")).toBe(true);
  });

  it("rend telle quelle une valeur de format inconnue plutôt que « undefined »", () => {
    const line = formatTournamentCreatedLog({
      tournament: TOURNAMENT,
      format: "LEGACY_MODE",
      game: "OW",
      maxTeams: 8,
      participantType: "TEAM",
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
      entrant: { name: "Les Renards", participantType: "TEAM" },
      registeredTeams: 3,
      maxTeams: 16,
      byStaff: false,
    });

    expect(line).toContain("Les Renards");
    expect(line).toContain("3/16 équipes");
    expect(line).not.toContain("staff");
  });

  it("distingue l'ajout du staff de l'inscription d'un joueur", () => {
    const line = formatRegistrationLog({
      tournament: TOURNAMENT,
      entrant: { name: "Équipe fantôme", participantType: "TEAM" },
      registeredTeams: 4,
      maxTeams: 16,
      byStaff: true,
    });

    expect(line).toContain("(ajout du staff)");
  });

  it("compte en joueurs sur un tournoi individuel", () => {
    const line = formatRegistrationLog({
      tournament: TOURNAMENT,
      entrant: { name: "Kiro", participantType: "SOLO" },
      registeredTeams: 5,
      maxTeams: 32,
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
      team1: { name: "Les Renards", participantType: "TEAM" },
      team2: { name: "Team Nova", participantType: "TEAM" },
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
      team1: { name: "Les Renards", participantType: "TEAM" },
      team2: { name: "Team Nova", participantType: "TEAM" },
      team1Score: 1,
      team2Score: 0,
      forfeit: true,
    });

    expect(line).toContain("(forfait)");
  });

  it("dit « vs » plutôt que 0–0 sur un forfait arbitré, qui n'a aucun score", () => {
    const line = formatMatchResultLog({
      tournament: TOURNAMENT,
      bracket: "UPPER",
      roundNumber: 1,
      team1: { name: "Les Renards", participantType: "TEAM" },
      team2: { name: "Team Nova", participantType: "TEAM" },
      team1Score: null,
      team2Score: null,
      forfeit: true,
    });

    expect(line).toContain("Les Renards vs Team Nova");
    expect(line).toContain("(forfait)");
    expect(line).not.toContain("0–0");
  });

  it("emploie le vocabulaire de manche partagé avec les rappels", () => {
    const grand = formatMatchResultLog({
      tournament: TOURNAMENT,
      bracket: "GRAND",
      roundNumber: 1,
      team1: { name: "A", participantType: "TEAM" },
      team2: { name: "B", participantType: "TEAM" },
      team1Score: 3,
      team2Score: 2,
    });
    const lower = formatMatchResultLog({
      tournament: TOURNAMENT,
      bracket: "LOWER",
      roundNumber: 4,
      team1: { name: "A", participantType: "TEAM" },
      team2: { name: "B", participantType: "TEAM" },
      team1Score: 3,
      team2Score: 2,
    });

    expect(grand).toContain("Grande finale");
    expect(lower).toContain("Loser bracket · manche 4");
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
      champion: { name: "Les Renards", participantType: "TEAM" },
    });

    expect(line).toContain("Les Renards l'emporte");
  });

  it("reste une phrase correcte quand aucun classement ne désigne de championne", () => {
    const line = formatTournamentFinishedLog({ tournament: TOURNAMENT, champion: null });

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
  it("attribue la suppression au staff, sans le nommer", () => {
    const line = formatTournamentDeletedLog({ tournament: TOURNAMENT });

    expect(line).toContain("par le staff");
  });
});

describe("pénalités d'endurance", () => {
  it("nomme l'engagé, le montant et le motif — c'est ce qu'on vient y chercher", () => {
    const line = formatEndurancePenaltyLog({
      tournament: TOURNAMENT,
      entrant: { name: "Les Renards", participantType: "TEAM" },
      points: 3,
      reason: "Retard au coup d'envoi",
    });

    expect(line).toContain("Les Renards");
    expect(line).toContain("3 points");
    expect(line).toContain("Retard au coup d'envoi");
  });

  it("accorde le singulier sur une sanction d'un point", () => {
    const line = formatEndurancePenaltyLog({
      tournament: TOURNAMENT,
      entrant: { name: "Les Renards", participantType: "TEAM" },
      points: 1,
      reason: "Motif",
    });

    expect(line).toContain("1 point d'endurance");
    expect(line).not.toContain("1 points");
  });

  it("annonce le retrait comme une restitution, sans reprendre le motif", () => {
    // La sanction n'existe plus : rappeler pourquoi elle avait été posée
    // rouvrirait un débat que la ligne est justement là pour clore.
    const line = formatEndurancePenaltyLiftedLog({
      tournament: TOURNAMENT,
      entrant: { name: "Les Renards", participantType: "TEAM" },
      points: 3,
    });

    expect(line).toContain("récupère 3 points");
    expect(line).toContain("Pénalité annulée");
  });

  it("distingue les deux lignes à l'œil, dès le pictogramme", () => {
    const applied = formatEndurancePenaltyLog({
      tournament: TOURNAMENT,
      entrant: { name: "Les Renards", participantType: "TEAM" },
      points: 3,
      reason: "Motif",
    });
    const lifted = formatEndurancePenaltyLiftedLog({
      tournament: TOURNAMENT,
      entrant: { name: "Les Renards", participantType: "TEAM" },
      points: 3,
    });

    expect(applied.slice(0, 2)).not.toBe(lifted.slice(0, 2));
  });
});

describe("formatPlayerSignupLog", () => {
  it("compte une arrivée et sa voie d'entrée, sans nommer le joueur", () => {
    const line = formatPlayerSignupLog({ provider: "GOOGLE" });

    expect(line).toBe("👋 Nouveau joueur — compte créé via Google.");
    // Ni pseudo, ni identifiant : `#id` mène à `/joueurs/<id>`, donc au pseudo.
    expect(line).not.toMatch(/#\d/);
  });

  it("distingue les deux voies d'entrée", () => {
    // Un compte né par Discord porte un identifiant Discord, donc reçoit les
    // rappels de match en message privé ; un compte né par Google n'en a aucun
    // tant que le joueur ne l'a pas renseigné.
    const discord = formatPlayerSignupLog({ provider: "DISCORD" });

    expect(discord).toContain("via Discord");
    expect(discord).not.toContain("via Google");
  });

  it("ne se confond pas avec une inscription à un tournoi", () => {
    // Les deux mots « inscription » cohabitent sur le même canal : l'un désigne
    // un compte qui naît, l'autre une équipe qui s'engage. La ligne du joueur
    // n'emploie donc pas le mot, et son pictogramme est le sien.
    const signup = formatPlayerSignupLog({ provider: "GOOGLE" });
    const registration = formatRegistrationLog({
      tournament: TOURNAMENT,
      entrant: { name: "Les Renards", participantType: "TEAM" },
      registeredTeams: 3,
      maxTeams: 16,
      byStaff: false,
    });

    expect(signup).not.toContain("Inscription");
    expect(signup.split(" ")[0]).not.toBe(registration.split(" ")[0]);
  });
});

describe("confidentialité : aucun pseudo de joueur, aucun membre du staff nommé", () => {
  const SOLO = (name: string) => ({ name, participantType: "SOLO" as const });
  const TEAM = (name: string) => ({ name, participantType: "TEAM" as const });

  it("écrit « un joueur » à la place d'un engagé de tournoi individuel, partout", () => {
    const lines = [
      formatRegistrationLog({ tournament: TOURNAMENT, entrant: SOLO("Nova"), registeredTeams: 1, maxTeams: 8, byStaff: false }),
      formatForfeitLog({ tournament: TOURNAMENT, entrant: SOLO("Nova") }),
      formatEntrantRemovedLog({ tournament: TOURNAMENT, entrant: SOLO("Nova"), registeredTeams: 1, maxTeams: 8 }),
      formatMatchResultLog({
        tournament: TOURNAMENT,
        bracket: "UPPER",
        roundNumber: 1,
        team1: SOLO("Nova"),
        team2: SOLO("Kiro"),
        team1Score: 2,
        team2Score: 1,
      }),
      formatTournamentFinishedLog({ tournament: TOURNAMENT, champion: SOLO("Nova") }),
      formatEndurancePenaltyLog({ tournament: TOURNAMENT, entrant: SOLO("Nova"), points: 2, reason: "Retard" }),
      formatEndurancePenaltyLiftedLog({ tournament: TOURNAMENT, entrant: SOLO("Nova"), points: 2 }),
    ];
    for (const line of lines) {
      expect(line).not.toContain("Nova");
      expect(line).not.toContain("Kiro");
      expect(line).toContain("un joueur");
    }
  });

  it("garde le nom d'une équipe", () => {
    expect(formatForfeitLog({ tournament: TOURNAMENT, entrant: TEAM("Les Renards") })).toContain(
      "Les Renards",
    );
  });

  it("dit « le staff » pour chaque geste du staff, sans nom ni identifiant", () => {
    const lines = [
      formatEntrantRemovedLog({ tournament: TOURNAMENT, entrant: TEAM("Les Renards"), registeredTeams: 2, maxTeams: 16 }),
      formatTournamentDeletedLog({ tournament: TOURNAMENT }),
      formatRoundRolledBackLog({ tournament: TOURNAMENT, roundLabel: "la manche 2", clearedMatches: 3 }),
    ];
    for (const line of lines) expect(line).toContain("par le staff");
    expect(
      formatTournamentCreatedLog({
        tournament: TOURNAMENT,
        format: "SWISS",
        game: "OW",
        maxTeams: 16,
        participantType: "TEAM",
        startAt: null,
      }),
    ).not.toMatch(/créé par/);
  });
});

describe("entrantLabel / staffAuditLine", () => {
  it("rend le nom d'une équipe, jamais celui d'un joueur", () => {
    expect(entrantLabel({ name: "Les Renards", participantType: "TEAM" })).toBe("Les Renards");
    expect(entrantLabel({ name: "Nova", participantType: "SOLO" })).toBe(ANONYMOUS_PLAYER_LABEL);
  });

  it("reprend la ligne Discord et nomme l'auteur, pour les journaux du serveur", () => {
    const discord = formatTournamentDeletedLog({ tournament: TOURNAMENT });
    const audit = staffAuditLine(discord, { id: 3, pseudo: "Kiro" });

    expect(audit.startsWith("[staff-audit] ")).toBe(true);
    expect(audit).toContain(discord);
    expect(audit).toContain("Kiro (#3)");
  });
});
