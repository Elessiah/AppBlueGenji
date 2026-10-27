import { describe, expect, it } from "@jest/globals";
import { groupNoRefereeAlerts, type NoRefereeCandidate } from "@/lib/shared/match-referee";
import { formatRoundNoRefereeAlert, ROUND_ALERT_LISTED_MATCHES } from "@/lib/shared/referee-alerts";
import { refereeAlertPush } from "@/lib/shared/push-messages";

/**
 * Décision de l'utilisateur du 2026-10-27 : l'alerte « sans arbitre ni
 * autogestion » reste par match pour un match planifié, et devient une seule
 * alerte par manche, qui liste ses matchs, pour les matchs sans horaire.
 */
const candidate = (overrides: Partial<NoRefereeCandidate>): NoRefereeCandidate => ({
  matchId: 1,
  pairing: "10:20",
  scheduled: false,
  phaseId: 0,
  bracket: "UPPER",
  roundNumber: 1,
  ...overrides,
});

describe("groupNoRefereeAlerts", () => {
  it("garde une alerte par match planifié", () => {
    const { perMatch, perRound } = groupNoRefereeAlerts([
      candidate({ matchId: 5, scheduled: true }),
      candidate({ matchId: 3, scheduled: true }),
    ]);
    expect(perMatch.map((m) => m.matchId)).toEqual([3, 5]);
    expect(perRound).toEqual([]);
  });

  it("groupe les matchs sans horaire d'une manche en une seule alerte, triés", () => {
    const { perMatch, perRound } = groupNoRefereeAlerts([
      candidate({ matchId: 9 }),
      candidate({ matchId: 4 }),
      candidate({ matchId: 7 }),
    ]);
    expect(perMatch).toEqual([]);
    expect(perRound).toEqual([{ phaseId: 0, bracket: "UPPER", roundNumber: 1, matchIds: [4, 7, 9] }]);
  });

  it("manche mixte : le planifié à part, les sans horaire ensemble", () => {
    const { perMatch, perRound } = groupNoRefereeAlerts([
      candidate({ matchId: 1, scheduled: true }),
      candidate({ matchId: 2 }),
      candidate({ matchId: 3 }),
    ]);
    expect(perMatch.map((m) => m.matchId)).toEqual([1]);
    expect(perRound).toEqual([{ phaseId: 0, bracket: "UPPER", roundNumber: 1, matchIds: [2, 3] }]);
  });

  it("sépare les manches par phase, tableau et numéro", () => {
    const { perRound } = groupNoRefereeAlerts([
      candidate({ matchId: 1 }),
      candidate({ matchId: 2, bracket: "LOWER" }),
      candidate({ matchId: 3, roundNumber: 2 }),
      candidate({ matchId: 4, phaseId: 8 }),
      candidate({ matchId: 5 }),
    ]);
    expect(perRound.map((round) => round.matchIds)).toEqual([[1, 5], [2], [3], [4]]);
  });

  it("ne rend rien sans candidat", () => {
    expect(groupNoRefereeAlerts([])).toEqual({ perMatch: [], perRound: [] });
  });
});

describe("formatRoundNoRefereeAlert", () => {
  const base = {
    tournament: { id: 12, name: "Coupe BlueGenji" },
    tournamentUrl: "https://example.test/tournois/12",
    bracket: "UPPER",
    roundNumber: 1,
  };
  const team = (name: string) => ({ name, participantType: "TEAM" as const });

  it("liste les matchs de la manche et leur nombre", () => {
    const line = formatRoundNoRefereeAlert({
      ...base,
      matches: [
        { matchId: 31, team1: team("Les Renards"), team2: team("Team Nova") },
        { matchId: 32, team1: team("Alpha"), team2: team("Bravo") },
      ],
      total: 2,
    });
    expect(line).toContain("« Coupe BlueGenji » (#12)");
    expect(line).toContain("Les Renards vs Team Nova (match #31) ; Alpha vs Bravo (match #32)");
    expect(line).toContain("— 2 matchs en lancement sans arbitre ni autogestion — une décision est attendue.");
    expect(line.endsWith(" https://example.test/tournois/12")).toBe(true);
  });

  it("dit « un joueur » pour une entrée solo, jamais son pseudo", () => {
    const solo = (name: string) => ({ name, participantType: "SOLO" as const });
    const line = formatRoundNoRefereeAlert({
      ...base,
      tournamentUrl: null,
      matches: [{ matchId: 40, team1: solo("PseudoA"), team2: solo("PseudoB") }],
      total: 1,
    });
    expect(line).not.toContain("PseudoA");
    expect(line).not.toContain("PseudoB");
    expect(line).toContain("un joueur vs un joueur (match #40)");
    expect(line).toContain("— 1 match en lancement");
  });

  it(`borne la liste à ${ROUND_ALERT_LISTED_MATCHES} matchs, puis « et N autres »`, () => {
    const matches = Array.from({ length: 15 }, (_, index) => ({
      matchId: 100 + index,
      team1: team(`A${index}`),
      team2: team(`B${index}`),
    }));
    const line = formatRoundNoRefereeAlert({ ...base, matches, total: 15 });
    expect(line).toContain("(match #111)");
    expect(line).not.toContain("(match #112)");
    expect(line).toContain(" ; et 3 autres — 15 matchs en lancement");
  });
});

describe("refereeAlertPush — alerte d'une manche", () => {
  const match = {
    tournamentId: 12,
    tournamentName: "Coupe BlueGenji",
    matchId: 31,
    bracket: "UPPER",
    roundNumber: 1,
    matchCount: 3,
  };

  it("en anglais, dit la manche et le nombre de matchs", () => {
    const push = refereeAlertPush("ligne", "match_no_referee-round-31", "en", "match_no_referee_round", match);
    expect(push.body).toContain("Round without a referee · Coupe BlueGenji");
    expect(push.body).toContain("3 matches with neither a referee nor self-management");
    expect(push.tag).toBe("referee-match_no_referee-round-31");
  });

  it("au singulier pour un seul match (EN)", () => {
    const push = refereeAlertPush("ligne", "k", "en", "match_no_referee_round", { ...match, matchCount: 1 });
    expect(push.body).toContain(": 1 match with neither");
  });

  it("en français, reprend la ligne Discord", () => {
    const push = refereeAlertPush("🧑‍⚖️ Arbitrage requis — ligne", "k", "fr", "match_no_referee_round", match);
    expect(push.body).toContain("Arbitrage requis — ligne");
  });
});
