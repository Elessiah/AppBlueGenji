import { describe, expect, it } from "@jest/globals";
import {
  boardActionLabel,
  boardStateLabel,
  formatBoardStartAt,
  isTournamentFull,
} from "@/lib/shared/landing-board";
import type { TournamentFormat, TournamentState } from "@/lib/shared/types";
import { tournamentCard } from "../../helpers/tournament-card";

// Calendrier de la fabrique : visible le 1er mai, inscriptions du 2 au 10,
// coup d'envoi le 12.
const ANNOUNCED_AT = Date.parse("2026-05-01T12:00:00.000Z");
const REGISTRATION_AT = Date.parse("2026-05-05T12:00:00.000Z");
const LOCKED_AT = Date.parse("2026-05-11T12:00:00.000Z");
const RUNNING_AT = Date.parse("2026-05-13T12:00:00.000Z");

function card(state: TournamentState, overrides: Parameters<typeof tournamentCard>[0] = {}) {
  return tournamentCard({ state, ...overrides });
}

describe("isTournamentFull", () => {
  it("est plein quand l'effectif atteint ou dépasse le plafond", () => {
    expect(isTournamentFull({ maxTeams: 8, registeredTeams: 8 })).toBe(true);
    expect(isTournamentFull({ maxTeams: 8, registeredTeams: 9 })).toBe(true);
    expect(isTournamentFull({ maxTeams: 8, registeredTeams: 7 })).toBe(false);
  });

  it("compare comme le refus serveur (`registeredTeams >= max_teams`)", () => {
    // La validation impose au moins deux places ; un plafond nul, s'il existait,
    // serait plein côté serveur — la carte ne doit pas y annoncer une place.
    expect(isTournamentFull({ maxTeams: 0, registeredTeams: 0 })).toBe(true);
  });
});

describe("boardStateLabel", () => {
  it("annonce un tournoi dont les inscriptions ne sont pas ouvertes", () => {
    expect(boardStateLabel(card("UPCOMING"), ANNOUNCED_AT)).toBe("Bientôt");
  });

  it("distingue les inscriptions ouvertes, complètes et closes", () => {
    expect(boardStateLabel(card("REGISTRATION", { registeredTeams: 3 }), REGISTRATION_AT)).toBe(
      "Inscriptions ouvertes",
    );
    expect(boardStateLabel(card("REGISTRATION", { registeredTeams: 8 }), REGISTRATION_AT)).toBe("Complet");
    // Clos mais pas lancé : l'état stocké est `UPCOMING`, ce sont les dates qui
    // disent que la porte est fermée.
    expect(boardStateLabel(card("UPCOMING"), LOCKED_AT)).toBe("Inscriptions closes");
  });

  it("nomme l'état en cours et l'état terminé en français", () => {
    expect(boardStateLabel(card("RUNNING"), RUNNING_AT)).toBe("En cours");
    expect(boardStateLabel(card("FINISHED"), RUNNING_AT)).toBe("Terminé");
  });

  it("l'état stocké sert de plancher : un tournoi lancé en avance est en cours", () => {
    expect(boardStateLabel(card("RUNNING"), REGISTRATION_AT)).toBe("En cours");
  });

  it("ne rend qu'un des libellés français attendus, jamais la valeur brute", () => {
    const labels = new Set(["Bientôt", "Inscriptions ouvertes", "Complet", "Inscriptions closes", "En cours", "Terminé"]);
    for (const state of ["UPCOMING", "REGISTRATION", "RUNNING", "FINISHED"] as const) {
      for (const now of [ANNOUNCED_AT, REGISTRATION_AT, LOCKED_AT, RUNNING_AT]) {
        for (const registeredTeams of [0, 8]) {
          expect(labels.has(boardStateLabel(card(state, { registeredTeams }), now))).toBe(true);
        }
      }
    }
  });
});

describe("boardActionLabel", () => {
  it("ne propose jamais l'inscription : le tableau ne connaît pas le lecteur", () => {
    expect(boardActionLabel(card("REGISTRATION", { registeredTeams: 3 }), REGISTRATION_AT)).toBe(
      "Voir le tournoi",
    );
    expect(boardActionLabel(card("REGISTRATION", { registeredTeams: 8 }), REGISTRATION_AT)).toBe(
      "Voir le tournoi",
    );
  });

  it("ne propose pas l'inscription avant l'ouverture ni après la clôture", () => {
    expect(boardActionLabel(card("UPCOMING"), ANNOUNCED_AT)).toBe("Voir le tournoi");
    expect(boardActionLabel(card("UPCOMING"), LOCKED_AT)).toBe("Voir le tournoi");
  });

  it("ne propose jamais l'inscription sur un tournoi lancé", () => {
    for (const format of ["SINGLE", "DOUBLE", "SWISS", "SURVIVAL", "MULTI", "BG_SURVIE"] as const) {
      expect(boardActionLabel(card("RUNNING", { format, registeredTeams: 2 }), RUNNING_AT)).not.toBe(
        "S'inscrire",
      );
    }
  });

  it.each<[TournamentFormat, string]>([
    ["SINGLE", "Voir le bracket"],
    ["DOUBLE", "Voir le bracket"],
    ["SWISS", "Suivre le tournoi"],
    ["SURVIVAL", "Suivre le tournoi"],
    ["BG_SURVIE", "Suivre le tournoi"],
    ["MULTI", "Suivre le tournoi"],
  ])("un tournoi %s en cours propose « %s »", (format, expected) => {
    expect(boardActionLabel(card("RUNNING", { format }), RUNNING_AT)).toBe(expected);
  });

  it("un tournoi terminé se consulte", () => {
    expect(boardActionLabel(card("FINISHED"), RUNNING_AT)).toBe("Voir le tournoi");
  });
});

describe("formatBoardStartAt", () => {
  const NOW = Date.parse("2026-09-25T12:00:00.000Z");

  it("donne jour, mois et heure à la minute, sans secondes", () => {
    const text = formatBoardStartAt("2026-09-21T18:30:45.000Z", NOW);
    expect(text).toBe("21 sept. · 20:30");
    expect(text).not.toMatch(/:\d{2}:\d{2}/);
  });

  it("rédige l'heure de Paris quel que soit le fuseau du serveur", () => {
    // 23 h 30 UTC le 31 décembre = 0 h 30 le 1er janvier à Paris.
    expect(formatBoardStartAt("2026-12-31T23:30:00.000Z", NOW)).toBe("1 janv. 2027 · 00:30");
  });

  it("n'écrit l'année que si elle diffère de l'année en cours", () => {
    expect(formatBoardStartAt("2026-10-02T08:00:00.000Z", NOW)).not.toMatch(/2026/);
    expect(formatBoardStartAt("2027-03-02T09:00:00.000Z", NOW)).toContain("2027");
  });

  it("rend une chaîne vide sur une date illisible", () => {
    expect(formatBoardStartAt("pas une date", NOW)).toBe("");
    expect(formatBoardStartAt("", NOW)).toBe("");
  });
});
