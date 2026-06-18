import { describe, it, expect } from "@jest/globals";
import type { BracketMatch, BracketType, MatchStatus } from "@/lib/shared/types";
import {
  ACCENT,
  buildSections,
  defaultOpenKey,
  findMyNextMatch,
  qualifyLabelFor,
  stageName,
} from "@/app/(secured)/tournois/[id]/_lib/bracket-sections";

const mockMatch = (overrides: Partial<BracketMatch>): BracketMatch => ({
  id: 1,
  tournamentId: 1,
  bracket: "UPPER",
  roundNumber: 1,
  matchNumber: 1,
  status: "PENDING" as MatchStatus,
  team1Id: null,
  team2Id: null,
  team1Name: null,
  team2Name: null,
  team1Placeholder: null,
  team2Placeholder: null,
  team1Score: null,
  team2Score: null,
  winnerTeamId: null,
  loserTeamId: null,
  forfeitTeamId: null,
  nextWinnerMatchId: null,
  nextWinnerSlot: null,
  nextLoserMatchId: null,
  nextLoserSlot: null,
  scoreDeadlineAt: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("stageName", () => {
  it("nomme les stades finaux à partir de la fin (tableau principal)", () => {
    const total = 6; // 32èmes, 16èmes, 8èmes, quarts, demi, finale
    expect(stageName(5, total, "UPPER")).toBe("Finale");
    expect(stageName(4, total, "UPPER")).toBe("Demi-finales");
    expect(stageName(3, total, "UPPER")).toBe("Quarts de finale");
    expect(stageName(2, total, "UPPER")).toBe("8èmes de finale");
    expect(stageName(1, total, "UPPER")).toBe("Premiers tours");
    expect(stageName(0, total, "UPPER")).toBe("Premiers tours");
  });

  it("renomme la finale du tableau perdants", () => {
    expect(stageName(2, 3, "LOWER")).toBe("Finale perdants");
  });

  it("force un nom unique pour GRAND et THIRD_PLACE", () => {
    expect(stageName(0, 1, "GRAND")).toBe("Grande Finale");
    expect(stageName(0, 1, "THIRD_PLACE")).toBe("Petite Finale");
  });
});

describe("qualifyLabelFor", () => {
  it("dérive le libellé au singulier du stade suivant", () => {
    expect(qualifyLabelFor("8èmes de finale")).toBe("Qualifié en 8ème de finale");
    expect(qualifyLabelFor("Quarts de finale")).toBe("Qualifié en quart de finale");
    expect(qualifyLabelFor("Demi-finales")).toBe("Qualifié en demi-finale");
    expect(qualifyLabelFor("Finale")).toBe("Qualifié en finale");
  });

  it("retombe sur un libellé générique minuscule pour un stade inconnu", () => {
    expect(qualifyLabelFor("Phase de Poules")).toBe("Qualifié en phase de poules");
  });
});

describe("buildSections", () => {
  it("groupe les premiers tours et isole chaque stade final", () => {
    const sections = buildSections([1, 2, 3, 4, 5, 6], "UPPER");
    expect(sections.map((s) => s.title)).toEqual([
      "Premiers tours",
      "8èmes de finale",
      "Quarts de finale",
      "Demi-finales",
      "Finale",
    ]);
    // Premiers tours = rounds 1 et 2 regroupés.
    expect(sections[0].rounds).toEqual([1, 2]);
    expect(sections[0].roundIdxBase).toBe(0);
    expect(sections[1].rounds).toEqual([3]);
    expect(sections[1].roundIdxBase).toBe(2);
  });

  it("chaîne les badges de qualification vers le stade suivant, sauf la dernière section", () => {
    const sections = buildSections([1, 2, 3, 4, 5, 6], "UPPER");
    expect(sections[0].qualifyLabel).toBe("Qualifié en 8ème de finale");
    expect(sections[1].qualifyLabel).toBe("Qualifié en quart de finale");
    expect(sections[3].qualifyLabel).toBe("Qualifié en finale");
    expect(sections[sections.length - 1].qualifyLabel).toBeNull();
  });

  it("ne crée pas de section « Premiers tours » sur un petit bracket", () => {
    const sections = buildSections([1, 2, 3], "UPPER"); // quarts, demi, finale
    expect(sections.map((s) => s.title)).toEqual(["Quarts de finale", "Demi-finales", "Finale"]);
  });

  it("réduit un tableau d'un seul match à une seule section sans badge", () => {
    const sections = buildSections([1], "GRAND");
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Grande Finale");
    expect(sections[0].qualifyLabel).toBeNull();
  });
});

describe("findMyNextMatch", () => {
  const matches = [
    mockMatch({ id: 10, roundNumber: 1, team1Id: 7, team2Id: 8, winnerTeamId: 7 }),
    mockMatch({ id: 20, roundNumber: 2, team1Id: 7, team2Id: 9, winnerTeamId: null }),
    mockMatch({ id: 30, roundNumber: 1, team1Id: 1, team2Id: 2, winnerTeamId: null }),
  ];

  it("retourne le match en cours du joueur (round le plus bas, sans vainqueur)", () => {
    expect(findMyNextMatch(matches, 7)?.id).toBe(20);
  });

  it("retourne null si le joueur n'a pas d'équipe", () => {
    expect(findMyNextMatch(matches, null)).toBeNull();
  });

  it("retourne null si toutes les rencontres du joueur sont terminées", () => {
    const done = [mockMatch({ id: 1, team1Id: 7, team2Id: 8, winnerTeamId: 8 })];
    expect(findMyNextMatch(done, 7)).toBeNull();
  });
});

describe("defaultOpenKey", () => {
  const rounds = [1, 2, 3, 4]; // 8èmes, quarts, demi, finale
  const sections = buildSections(rounds, "UPPER");

  it("ouvre la section du prochain match du joueur en priorité", () => {
    const matches = [
      mockMatch({ id: 1, roundNumber: 1, status: "COMPLETED", team1Id: 5, team2Id: 6, winnerTeamId: 5 }),
      mockMatch({ id: 2, roundNumber: 3, team1Id: 5, team2Id: 9, winnerTeamId: null }),
    ];
    expect(defaultOpenKey(sections, matches, 5)).toBe("Demi-finales");
  });

  it("ouvre le round actif si le joueur ne participe pas", () => {
    const matches = [
      mockMatch({ id: 1, roundNumber: 1, status: "COMPLETED", winnerTeamId: 1 }),
      mockMatch({ id: 2, roundNumber: 2, status: "READY" }),
    ];
    expect(defaultOpenKey(sections, matches, null)).toBe("Quarts de finale");
  });

  it("ouvre la finale quand tout est terminé", () => {
    const matches = rounds.map((r, i) =>
      mockMatch({ id: i, roundNumber: r, status: "COMPLETED", winnerTeamId: 1 }),
    );
    expect(defaultOpenKey(sections, matches, null)).toBe("Finale");
  });

  it("retourne null sans section", () => {
    expect(defaultOpenKey([], [], 1)).toBeNull();
  });
});

describe("ACCENT", () => {
  it("définit une couleur distincte par type de tableau", () => {
    const types: BracketType[] = ["UPPER", "LOWER", "GRAND", "THIRD_PLACE"];
    const colors = types.map((t) => ACCENT[t]);
    expect(new Set(colors).size).toBe(types.length);
  });
});
