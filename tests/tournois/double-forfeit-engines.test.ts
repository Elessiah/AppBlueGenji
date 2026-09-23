import { describe, expect, it } from "@jest/globals";
import { DEFAULT_SWISS_POINTS, computeTiebreaks, replaySwiss } from "@/lib/shared/swiss";
import { replaySurvival } from "@/lib/shared/survival";
import {
  DEFAULT_ENDURANCE_CONFIG,
  planNextPlayoffRound,
  replayEndurance,
} from "@/lib/shared/bg-survie";
import type { MatchFormat } from "@/lib/shared/match-format";

/**
 * Le double forfait décliné par chaque moteur à classement : une défaite pour
 * **les deux** engagées, jamais un nul, jamais une victoire.
 */

const teams = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ teamId: index + 1, seed: index + 1 }));

describe("Ronde suisse — double forfait", () => {
  const matches = [
    {
      round: 1,
      completed: true,
      team1Id: 1,
      team2Id: 2,
      winnerTeamId: null,
      loserTeamId: null,
      isBye: false,
      doubleForfeit: true,
    },
    {
      round: 1,
      completed: true,
      team1Id: 3,
      team2Id: 4,
      winnerTeamId: 3,
      loserTeamId: 4,
      isBye: false,
    },
  ];

  const standings = replaySwiss({
    teams: teams(4),
    matches,
    forfeits: [],
    points: DEFAULT_SWISS_POINTS,
  });
  const of = (id: number) => standings.find((s) => s.teamId === id)!;

  it("compte une défaite pour chacune, sans point de nul", () => {
    expect(of(1)).toMatchObject({ losses: 1, draws: 0, wins: 0, points: DEFAULT_SWISS_POINTS.loss });
    expect(of(2)).toMatchObject({ losses: 1, draws: 0, wins: 0, points: DEFAULT_SWISS_POINTS.loss });
  });

  it("garde la rencontre dans l'historique : pas de nouvel appariement 1-2", () => {
    expect(of(1).opponentIds).toEqual([2]);
    expect(of(1).status).toBe("ACTIVE");
  });

  it("ne rapporte rien au Sonneborn-Berger, pas même un demi-nul", () => {
    const tiebreaks = computeTiebreaks(standings, matches);
    expect(tiebreaks.get(1)?.sonnebornBerger).toBe(0);
    expect(tiebreaks.get(2)?.sonnebornBerger).toBe(0);
  });

  it("se lirait comme un nul sans le drapeau (garde contre la régression)", () => {
    const withoutFlag = replaySwiss({
      teams: teams(2),
      matches: [{ ...matches[0], doubleForfeit: undefined }],
      forfeits: [],
      points: DEFAULT_SWISS_POINTS,
    });
    expect(withoutFlag[0].draws).toBe(1);
  });
});

describe("Survie — double forfait", () => {
  const base = {
    forfeits: [],
    roundsBeforeFirstCut: 2,
    roundsPerCut: 2,
    lastRound: 1,
  };

  it("compte une défaite pour les deux engagées", () => {
    const standings = replaySurvival({
      ...base,
      teams: teams(4),
      barrageRounds: 0,
      matches: [
        {
          round: 1,
          completed: true,
          winnerTeamId: null,
          loserTeamId: null,
          isBye: false,
          doubleForfeitTeamIds: [1, 2],
        },
        { round: 1, completed: true, winnerTeamId: 3, loserTeamId: 4, isBye: false },
      ],
    });
    const of = (id: number) => standings.find((s) => s.teamId === id)!;
    expect(of(1)).toMatchObject({ wins: 0, losses: 1, status: "ACTIVE" });
    expect(of(2)).toMatchObject({ wins: 0, losses: 1, status: "ACTIVE" });
    expect(of(3).wins).toBe(1);
  });

  it("élimine les deux engagées d'un barrage clos en double forfait", () => {
    // Cinq équipes : le barrage oppose les deux dernières (4 et 5).
    const standings = replaySurvival({
      ...base,
      teams: teams(5),
      barrageRounds: 1,
      matches: [
        {
          round: 1,
          completed: true,
          winnerTeamId: null,
          loserTeamId: null,
          isBye: false,
          doubleForfeitTeamIds: [4, 5],
        },
      ],
    });
    const eliminated = standings.filter((s) => s.status === "ELIMINATED").map((s) => s.teamId);
    expect(eliminated.sort()).toEqual([4, 5]);
    expect(standings.filter((s) => s.status === "ACTIVE")).toHaveLength(3);
  });
});

describe("BlueGenji Survie — double forfait en qualification", () => {
  const FT3: MatchFormat = { type: "FT", value: 3 };

  it("retire à chacune le score plein du format, comme au perdant d'un forfait", () => {
    const standings = replayEndurance({
      teams: teams(4),
      matches: [
        {
          round: 1,
          completed: true,
          winnerTeamId: null,
          loserTeamId: null,
          doubleForfeitTeamIds: [1, 2],
        },
      ],
      forfeits: [],
      config: DEFAULT_ENDURANCE_CONFIG,
      lastRound: 1,
      matchFormat: FT3,
    });
    const of = (id: number) => standings.find((s) => s.teamId === id)!;
    expect(of(1)).toMatchObject({ points: 6, losses: 1, wins: 0, draws: 0 });
    expect(of(2)).toMatchObject({ points: 6, losses: 1, wins: 0, draws: 0 });
    expect(of(3).points).toBe(9);
  });

  it("peut éliminer : le capital tombe à zéro", () => {
    const standings = replayEndurance({
      teams: teams(2),
      matches: [
        {
          round: 1,
          completed: true,
          winnerTeamId: null,
          loserTeamId: null,
          doubleForfeitTeamIds: [1, 2],
        },
      ],
      forfeits: [],
      config: { ...DEFAULT_ENDURANCE_CONFIG, startPoints: 3 },
      lastRound: 1,
      matchFormat: FT3,
    });
    expect(standings.every((s) => s.points === 0 && s.status === "ELIMINATED")).toBe(true);
  });

  it("vaut un point en saisie libre (le forfait d'un format libre vaut 1-0)", () => {
    const standings = replayEndurance({
      teams: teams(2),
      matches: [
        {
          round: 1,
          completed: true,
          winnerTeamId: null,
          loserTeamId: null,
          doubleForfeitTeamIds: [1, 2],
        },
      ],
      forfeits: [],
      config: DEFAULT_ENDURANCE_CONFIG,
      lastRound: 1,
      matchFormat: null,
    });
    expect(standings.map((s) => s.points)).toEqual([8, 8]);
  });
});

describe("BlueGenji Survie — arbre final et double forfait", () => {
  const won = (winner: number, loser: number) => ({ winnerTeamId: winner, loserTeamId: loser });
  const vacated = { winnerTeamId: null, loserTeamId: null, doubleForfeit: true };

  it("fait passer l'adversaire par exemption, en gardant sa position", () => {
    const plan = planNextPlayoffRound([won(1, 8), vacated, won(3, 6), won(4, 5)]);
    expect(plan).toEqual([
      { bracket: "UPPER", pairing: { teamAId: 1, teamBId: null } },
      { bracket: "UPPER", pairing: { teamAId: 3, teamBId: 4 } },
    ]);
  });

  it("ne pose aucune rencontre quand deux créneaux voisins sont vides", () => {
    const plan = planNextPlayoffRound([vacated, vacated, won(3, 6), won(4, 5)]);
    expect(plan).toEqual([{ bracket: "UPPER", pairing: { teamAId: 3, teamBId: 4 } }]);
  });

  it("donne la 3ᵉ place par exemption à la seule demi-finaliste battue", () => {
    const plan = planNextPlayoffRound([won(1, 2), vacated]);
    expect(plan).toEqual([
      { bracket: "UPPER", pairing: { teamAId: 1, teamBId: null } },
      { bracket: "THIRD_PLACE", pairing: { teamAId: 2, teamBId: null } },
    ]);
  });

  it("ne pose rien quand les deux demi-finales sont des doubles forfaits", () => {
    expect(planNextPlayoffRound([vacated, vacated])).toEqual([]);
  });

  it("attend un tour pas encore joué (vainqueur manquant sans double forfait)", () => {
    expect(planNextPlayoffRound([won(1, 8), { winnerTeamId: null, loserTeamId: null }])).toEqual(
      [],
    );
  });

  it("ne crée pas de petite finale par exemption sans double forfait", () => {
    // Une demi-finale gagnée par exemption (effectif impair) n'a pas de battue :
    // pas de petite finale, comme avant.
    const plan = planNextPlayoffRound([won(1, 2), { winnerTeamId: 3, loserTeamId: null }]);
    expect(plan).toEqual([{ bracket: "UPPER", pairing: { teamAId: 1, teamBId: 3 } }]);
  });
});
