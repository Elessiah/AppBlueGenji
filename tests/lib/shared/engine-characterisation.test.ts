/**
 * Caractérisation des fonctions pures du moteur (rejeux, classements, plans).
 *
 * Ces tests ne décrivent aucune règle : ils figent la **sortie complète** de
 * chaque fonction sur des centaines d'historiques générés (graine fixe), pour
 * qu'un refactor purement structurel ne puisse rien changer sans qu'un
 * instantané ne bouge. Effectifs variés (impairs compris), forfaits, doubles
 * forfaits, nuls, pénalités, abandons, plafonds de manches et entrées
 * aberrantes (identifiants inconnus, scores non numériques).
 *
 * Une empreinte par cas : un écart désigne le cas fautif, que l'on rejoue en
 * appelant le générateur avec la même graine.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "@jest/globals";
import { type EnduranceConfig } from "@/lib/shared/bg-survie/config";
import { type EnduranceMatchOutcome } from "@/lib/shared/bg-survie/match-outcome";
import {
  replayEndurance,
  replayEnduranceDetailed,
  type ReplayEnduranceInput,
} from "@/lib/shared/bg-survie/replay";
import { planEnduranceRound } from "@/lib/shared/bg-survie/standings";
import type { MatchFormat } from "@/lib/shared/match-format";
import { computeDeepStats, type StatsMatch, type StatsTournament } from "@/lib/shared/stats";
import {
  planSurvivalRound,
  rankActiveTeams,
  replaySurvival,
  type ReplaySurvivalInput,
  type SurvivalMatchOutcome,
} from "@/lib/shared/survival";
import {
  computeTiebreaks,
  DEFAULT_SWISS_POINTS,
  rankSwiss,
  replaySwiss,
  type ReplaySwissInput,
  type SwissMatchOutcome,
} from "@/lib/shared/swiss";
import {
  findPhaseIssue,
  resolvePhasePlan,
  type PhaseConfig,
} from "@/lib/shared/tournament-phases";
import type { SwissTiebreaker } from "@/lib/shared/types";

/** Générateur congruentiel : reproductible d'une exécution à l'autre. */
function rng(seed: number) {
  let state = (seed * 2654435761) >>> 0 || 1;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  return {
    next,
    int: (min: number, max: number): number => min + Math.floor(next() * (max - min + 1)),
    chance: (p: number): boolean => next() < p,
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)],
  };
}
type Rng = ReturnType<typeof rng>;

/** Sérialisation stable : Map (ordre d'insertion gardé), NaN, undefined. */
function digest(value: unknown): string {
  const json = JSON.stringify(value, (_key, v: unknown) => {
    if (v instanceof Map) return { __map: [...v.entries()] };
    if (typeof v === "number" && !Number.isFinite(v)) return `__num:${String(v)}`;
    if (v === undefined) return "__undefined";
    return v;
  });
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

function runCases<T>(count: number, make: (r: Rng, index: number) => T, run: (input: T) => unknown): string[] {
  const out: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const input = make(rng(index + 1), index);
    let result: unknown;
    try {
      result = run(input);
    } catch (error) {
      result = { thrown: error instanceof Error ? error.message : String(error) };
    }
    out.push(`${index}:${digest(result)}`);
  }
  return out;
}

const SIZES = [0, 1, 2, 3, 4, 5, 7, 8, 9, 11, 16, 17, 21, 32];

function teamsOf(count: number): { teamId: number; seed: number }[] {
  return Array.from({ length: count }, (_, i) => ({ teamId: 100 + i, seed: i + 1 }));
}

function teamIdOrStray(r: Rng, teams: { teamId: number }[]): number {
  if (teams.length === 0 || r.chance(0.04)) return 999;
  return r.pick(teams).teamId;
}

// ─── BlueGenji Survie ────────────────────────────────────────────────────────

const ENDURANCE_FORMATS: (MatchFormat | null | undefined)[] = [
  undefined,
  null,
  { type: "BO", value: 5 },
  { type: "FT", value: 3 },
  { type: "FT", value: 3, maxMaps: 4, drawsAllowed: true },
  { type: "BO", value: 3 },
];

function enduranceConfig(r: Rng): EnduranceConfig {
  return {
    startPoints: r.pick([1, 3, 5, 9]),
    winDelta: r.pick([1, 1, 2]),
    lossDelta: r.pick([1, 1, 2]),
    playoffSize: r.pick([2, 4, 8]),
    maxRounds: r.pick([null, null, 1, 2, 3, 5, 8]),
  };
}

function randomEnduranceOutcome(r: Rng, round: number, teams: { teamId: number }[]): EnduranceMatchOutcome {
  const a = teamIdOrStray(r, teams);
  const b = teamIdOrStray(r, teams);
  const kind = r.int(0, 9);
  const completed = !r.chance(0.12);
  if (kind === 0) {
    return { round, completed, winnerTeamId: null, loserTeamId: null, doubleForfeitTeamIds: [a, b] };
  }
  if (kind === 1) {
    return {
      round,
      completed,
      winnerTeamId: null,
      loserTeamId: null,
      drawTeamIds: [a, b],
      drawMaps: r.pick([null, 0, 1, 2, 2.7, -1]),
    };
  }
  if (kind === 2) {
    return { round, completed, winnerTeamId: a, loserTeamId: b, isForfeit: true };
  }
  if (kind === 3) {
    return { round, completed, winnerTeamId: r.chance(0.5) ? null : a, loserTeamId: r.chance(0.5) ? null : b };
  }
  return {
    round,
    completed,
    winnerTeamId: a,
    loserTeamId: b,
    winnerMaps: r.pick([null, 0, 1, 2, 3, 3, 3, 3.5, Number.NaN, -1]),
    loserMaps: r.pick([null, 0, 0, 1, 2, -1, Number.NaN]),
  };
}

function randomEnduranceInput(r: Rng, index: number): ReplayEnduranceInput {
  const teams = teamsOf(SIZES[index % SIZES.length]);
  const rounds = r.int(0, 9);
  const matches: EnduranceMatchOutcome[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const count = r.int(0, Math.max(1, Math.ceil(teams.length / 2)));
    for (let i = 0; i < count; i += 1) matches.push(randomEnduranceOutcome(r, round, teams));
  }
  const forfeits = Array.from({ length: r.int(0, 3) }, () => ({
    teamId: teamIdOrStray(r, teams),
    round: r.int(0, rounds + 1),
  }));
  const penalties = r.chance(0.3)
    ? undefined
    : Array.from({ length: r.int(0, 4) }, () => ({
        teamId: teamIdOrStray(r, teams),
        round: r.int(1, rounds + 1),
        points: r.int(1, 6),
      }));
  return {
    teams,
    matches,
    forfeits,
    penalties,
    config: enduranceConfig(r),
    lastRound: r.int(0, rounds + 2),
    matchFormat: r.pick(ENDURANCE_FORMATS),
  };
}

/** Issue tirée d'un appariement d'endurance : double forfait, nul ou victoire. */
function playedEnduranceMatch(
  r: Rng,
  round: number,
  completed: boolean,
  teamAId: number,
  teamBId: number,
): ReplayEnduranceInput["matches"][number] {
  const kind = r.int(0, 11);
  if (kind === 0) {
    return { round, completed, winnerTeamId: null, loserTeamId: null, doubleForfeitTeamIds: [teamAId, teamBId] };
  }
  if (kind === 1) {
    return { round, completed, winnerTeamId: null, loserTeamId: null, drawTeamIds: [teamAId, teamBId], drawMaps: r.int(0, 2) };
  }
  const aWins = r.chance(0.55);
  return {
    round,
    completed,
    winnerTeamId: aWins ? teamAId : teamBId,
    loserTeamId: aWins ? teamBId : teamAId,
    isForfeit: kind === 2,
    winnerMaps: 3,
    loserMaps: r.int(0, 2),
  };
}

/** Forfait et pénalité tirés en fin de manche. */
function drawEnduranceSanctions(r: Rng, input: ReplayEnduranceInput, round: number) {
  const { teams } = input;
  if (r.chance(0.15) && teams.length > 0) input.forfeits.push({ teamId: r.pick(teams).teamId, round });
  if (r.chance(0.2) && teams.length > 0) {
    input.penalties!.push({ teamId: r.pick(teams).teamId, round, points: r.int(1, 4) });
  }
}

/** Tournoi joué manche par manche avec les appariements du moteur. */
function simulatedEnduranceInput(r: Rng, index: number): ReplayEnduranceInput {
  const teams = teamsOf(SIZES[index % SIZES.length]);
  const config = enduranceConfig(r);
  const matchFormat = r.pick(ENDURANCE_FORMATS);
  const input: ReplayEnduranceInput = {
    teams,
    matches: [],
    forfeits: [],
    penalties: [],
    config,
    lastRound: 0,
    matchFormat,
  };
  const totalRounds = r.int(1, 12);
  for (let round = 1; round <= totalRounds; round += 1) {
    const pairings = planEnduranceRound(replayEndurance(input));
    if (pairings.length === 0) break;
    input.lastRound = round;
    const lastRoundUnfinished = round === totalRounds && r.chance(0.3);
    for (const { teamAId, teamBId } of pairings) {
      if (teamBId === null) continue;
      const completed = !(lastRoundUnfinished && r.chance(0.5));
      input.matches.push(playedEnduranceMatch(r, round, completed, teamAId, teamBId));
    }
    drawEnduranceSanctions(r, input, round);
  }
  return input;
}

// ─── Survie par coupes ───────────────────────────────────────────────────────

function survivalSchedule(r: Rng) {
  return {
    roundsBeforeFirstCut: r.pick([0, 1, 1, 2, 3]),
    roundsPerCut: r.pick([0, 1, 1, 2, 3]),
    barrageRounds: r.pick([0, 0, 1, 2]),
    targetTeams: r.pick([undefined, 1, 2, 4]),
  };
}

function randomSurvivalInput(r: Rng, index: number): ReplaySurvivalInput {
  const teams = teamsOf(SIZES[index % SIZES.length]);
  const rounds = r.int(0, 9);
  const matches: SurvivalMatchOutcome[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const count = r.int(0, Math.max(1, Math.ceil(teams.length / 2)));
    for (let i = 0; i < count; i += 1) {
      const isBye = r.chance(0.1);
      const doubleForfeit = !isBye && r.chance(0.1);
      matches.push({
        round,
        completed: !r.chance(0.12),
        winnerTeamId: doubleForfeit || r.chance(0.05) ? null : teamIdOrStray(r, teams),
        loserTeamId: isBye || doubleForfeit || r.chance(0.05) ? null : teamIdOrStray(r, teams),
        isBye,
        doubleForfeitTeamIds: doubleForfeit
          ? [teamIdOrStray(r, teams), teamIdOrStray(r, teams)]
          : r.pick([undefined, null]),
      });
    }
  }
  return {
    teams,
    matches,
    forfeits: Array.from({ length: r.int(0, 3) }, () => ({ teamId: teamIdOrStray(r, teams), round: r.int(-1, rounds + 1) })),
    lastRound: r.int(0, rounds + 2),
    ...survivalSchedule(r),
  };
}

/** Issue tirée d'un appariement de survie : double forfait ou victoire. */
function playedSurvivalMatch(
  r: Rng,
  round: number,
  completed: boolean,
  teamAId: number,
  teamBId: number,
): SurvivalMatchOutcome {
  if (r.chance(0.08)) {
    return { round, completed, winnerTeamId: null, loserTeamId: null, isBye: false, doubleForfeitTeamIds: [teamAId, teamBId] };
  }
  const aWins = r.chance(0.55);
  return {
    round,
    completed,
    winnerTeamId: aWins ? teamAId : teamBId,
    loserTeamId: aWins ? teamBId : teamAId,
    isBye: false,
  };
}

/** Fin de manche : victoire d'office éventuelle, puis forfait tiré. */
function closeSurvivalRound(
  r: Rng,
  input: ReplaySurvivalInput,
  byeTeamId: number | null,
  active: { teamId: number }[],
  round: number,
) {
  if (byeTeamId !== null) {
    input.matches.push({ round, completed: true, winnerTeamId: byeTeamId, loserTeamId: null, isBye: true });
  }
  if (r.chance(0.12) && active.length > 0) input.forfeits.push({ teamId: r.pick(active).teamId, round });
}

function simulatedSurvivalInput(r: Rng, index: number): ReplaySurvivalInput {
  const teams = teamsOf(SIZES[index % SIZES.length]);
  const input: ReplaySurvivalInput = { teams, matches: [], forfeits: [], lastRound: 0, ...survivalSchedule(r) };
  const totalRounds = r.int(1, 14);
  for (let round = 1; round <= totalRounds; round += 1) {
    const active = rankActiveTeams(replaySurvival(input));
    if (active.length <= (input.targetTeams ?? 1)) break;
    const plan = planSurvivalRound(active, { allowBarrage: round <= input.barrageRounds });
    input.lastRound = round;
    const unfinished = round === totalRounds && r.chance(0.3);
    for (const { teamAId, teamBId } of plan.pairings) {
      if (teamBId === null) continue;
      const completed = !(unfinished && r.chance(0.5));
      input.matches.push(playedSurvivalMatch(r, round, completed, teamAId, teamBId));
    }
    closeSurvivalRound(r, input, plan.byeTeamId, active, round);
  }
  return input;
}

// ─── Ronde suisse ────────────────────────────────────────────────────────────

const TIEBREAKER_SETS: (SwissTiebreaker[] | undefined)[] = [
  undefined,
  [],
  ["head-to-head"],
  ["buchholz", "head-to-head"],
  ["opponent-mwp", "sonneborn-berger"],
  ["sonneborn-berger", "buchholz", "opponent-mwp", "head-to-head"],
];

/** Vainqueur tiré : aucun, une équipe errante, ou l'une des deux. */
function randomSwissWinner(r: Rng, kind: number, team1Id: number | null, team2Id: number | null) {
  if (kind === 0) return null;
  if (kind === 1) return 999;
  return r.chance(0.5) ? team1Id : team2Id;
}

/** Match suisse tiré au hasard, équipes errantes et issues incohérentes comprises. */
function randomSwissMatch(r: Rng, round: number, firstId: number, secondId: number): SwissMatchOutcome {
  const team1Id = r.chance(0.03) ? null : r.chance(0.03) ? 999 : firstId;
  const team2Id = r.chance(0.03) ? null : secondId;
  const kind = r.int(0, 9);
  return {
    round,
    completed: !r.chance(0.12),
    team1Id,
    team2Id,
    winnerTeamId: randomSwissWinner(r, kind, team1Id, team2Id),
    loserTeamId: r.chance(0.3) ? null : r.chance(0.5) ? team1Id : team2Id,
    isBye: kind === 2,
    doubleForfeit: kind === 3 ? true : r.pick([undefined, false]),
  };
}

function randomSwissInput(r: Rng, index: number): ReplaySwissInput & { tiebreakers: SwissTiebreaker[] | undefined } {
  const teams = teamsOf(SIZES[index % SIZES.length]);
  const rounds = r.int(0, 7);
  const matches: SwissMatchOutcome[] = [];
  for (let round = r.int(1, 3); round >= 1 && round <= rounds; round += r.pick([1, 1, 2])) {
    const ids = r.chance(0.8) ? [...teams].sort(() => r.next() - 0.5) : teams;
    for (let i = 0; i + 1 < ids.length; i += 2) {
      matches.push(randomSwissMatch(r, round, ids[i].teamId, ids[i + 1].teamId));
    }
    if (ids.length % 2 === 1) {
      const last = ids.at(-1)!.teamId;
      matches.push({ round, completed: true, team1Id: last, team2Id: null, winnerTeamId: r.chance(0.7) ? last : null, loserTeamId: null, isBye: true });
    }
  }
  // Ordre d'arrivée mélangé : le rejeu trie par manche.
  if (r.chance(0.5)) matches.reverse();
  return {
    teams,
    matches,
    forfeits: Array.from({ length: r.int(0, 3) }, () => ({ teamId: teamIdOrStray(r, teams), round: r.int(-1, rounds) })),
    points: r.chance(0.6) ? DEFAULT_SWISS_POINTS : { win: 2, draw: 0.5, loss: r.pick([0, -1]), bye: r.pick([1, 2]) },
    tiebreakers: r.pick(TIEBREAKER_SETS),
  };
}

// ─── Statistiques ────────────────────────────────────────────────────────────

const PLAYED_AT = [
  "2026-09-30T20:00:00.000Z",
  "2026-09-30T20:00:00.000Z",
  "2026-06-12T18:30:00.000Z",
  "2026-01-01T00:00:00.000Z",
  "2025-10-15T12:00:00.000Z",
  "2025-09-01T00:00:00.000Z",
  "2024-03-03T03:03:03.000Z",
  "pas une date",
];

function randomStatsInput(r: Rng, index: number): { matches: StatsMatch[]; tournaments: StatsTournament[] } {
  const count = SIZES[index % SIZES.length] * r.int(1, 3);
  const matches: StatsMatch[] = Array.from({ length: count }, (_, i) => {
    const opponent = r.chance(0.15) ? null : r.int(1, 6);
    return {
      matchId: r.chance(0.2) ? 7 : 1000 + i,
      tournamentId: r.int(1, 5),
      tournamentName: "T",
      game: r.pick(["OW", "MR"] as const),
      format: r.pick(["SINGLE", "DOUBLE", "SWISS", "SURVIVAL", "MULTI", "BG_SURVIE"] as const),
      bracket: r.pick(["UPPER", "LOWER", "GRAND", "THIRD_PLACE"] as const),
      playedAt: r.pick(PLAYED_AT),
      opponentTeamId: opponent,
      opponentName: opponent === null || r.chance(0.2) ? null : r.pick(["Alpha", "Bravo", "alpha", "Écho", "Zulu"]),
      outcome: r.pick(["WIN", "WIN", "LOSS", "LOSS", "DRAW"] as const),
      scoreFor: r.int(0, 3),
      scoreAgainst: r.int(0, 3),
      forfeit: r.pick(["NONE", "NONE", "NONE", "GIVEN", "RECEIVED"] as const),
    };
  });
  const tournaments: StatsTournament[] = Array.from({ length: r.int(0, 8) }, (_, i) => ({
    tournamentId: i + 1,
    tournamentName: "T",
    state: r.pick(["UPCOMING", "REGISTRATION", "RUNNING", "FINISHED", "FINISHED"] as const),
    format: "SINGLE",
    game: "OW",
    finalRank: r.pick([null, 1, 2, 3, 4, 9]),
    playedAt: r.pick(PLAYED_AT),
  }));
  return { matches, tournaments };
}

// ─── Multi-phases ────────────────────────────────────────────────────────────

function randomPhases(r: Rng, valid: boolean): PhaseConfig[] {
  const count = valid ? r.int(2, 8) : r.int(0, 10);
  return Array.from({ length: count }, (_, i) => {
    const weird = !valid && r.chance(0.15);
    return {
      position: weird && r.chance(0.3) ? i + 2 : i + 1,
      format: (weird && r.chance(0.3) ? "MULTI" : r.pick(["SINGLE", "SINGLE", "SWISS", "SURVIVAL", "DOUBLE"])) as PhaseConfig["format"],
      name: null,
      qualifierMode: (weird && r.chance(0.2) ? "OTHER" : r.pick(["COUNT", "PERCENT"])) as PhaseConfig["qualifierMode"],
      qualifierValue: r.pick([0, 1, 2, 3, 4, 6, 8, 12, 16, 33, 50, 75, 99, 100, 120]),
      hasThirdPlaceMatch: r.chance(0.5),
      swissTotalRounds: r.pick([null, 1, 5, 20, 21, 0, "3" as unknown as number]),
      survivalRoundsBeforeFirstCut: r.pick([null, 1, 50, 51, 0, "2" as unknown as number]),
      survivalRoundsPerCut: r.pick([null, 1, 50, 51, 0, "2" as unknown as number]),
    };
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const CASES = 160;

describe("caractérisation du moteur pur", () => {
  it("replayEnduranceDetailed — historiques aléatoires", () => {
    expect(runCases(CASES, randomEnduranceInput, replayEnduranceDetailed)).toMatchSnapshot();
  });

  it("replayEnduranceDetailed — tournois simulés manche par manche", () => {
    expect(runCases(CASES, simulatedEnduranceInput, replayEnduranceDetailed)).toMatchSnapshot();
  });

  it("replaySurvival — historiques aléatoires", () => {
    expect(runCases(CASES, randomSurvivalInput, replaySurvival)).toMatchSnapshot();
  });

  it("replaySurvival — tournois simulés manche par manche", () => {
    expect(runCases(CASES, simulatedSurvivalInput, replaySurvival)).toMatchSnapshot();
  });

  it("replaySwiss, computeTiebreaks et rankSwiss", () => {
    expect(
      runCases(CASES, randomSwissInput, (input) => {
        const standings = replaySwiss(input);
        return {
          standings,
          tiebreaks: computeTiebreaks(standings, input.matches),
          ranked: rankSwiss(standings, input.matches, input.tiebreakers),
        };
      }),
    ).toMatchSnapshot();
  });

  it("computeDeepStats", () => {
    const now = new Date("2026-10-01T09:00:00.000Z");
    expect(
      runCases(CASES, randomStatsInput, ({ matches, tournaments }) => computeDeepStats(matches, tournaments, now)),
    ).toMatchSnapshot();
  });

  it("resolvePhasePlan", () => {
    expect(
      runCases(CASES, (r) => ({ count: r.int(0, 140), phases: randomPhases(r, true) }), ({ count, phases }) =>
        resolvePhasePlan(count, phases),
      ),
    ).toMatchSnapshot();
  });

  it("findPhaseIssue", () => {
    expect(runCases(CASES * 2, (r, i) => randomPhases(r, i % 3 === 0), findPhaseIssue)).toMatchSnapshot();
  });

  it("findPhaseIssue — valeurs non numériques ou non finies refusées", () => {
    // Toute valeur qui n'est pas un nombre fini est refusée : `NaN` (d'une
    // saisie non numérique passée par `Number(...)`), une chaîne, `undefined`
    // et `null` comme les bornes. Avant le correctif `phase-qualifier-nan`,
    // `NaN`, une chaîne ou `undefined` passaient, aucune comparaison ne les
    // jugeant « hors bornes ».
    const plan = (first: Partial<PhaseConfig>): PhaseConfig[] => [
      {
        position: 1,
        format: "SWISS",
        name: null,
        qualifierMode: "COUNT",
        qualifierValue: 4,
        hasThirdPlaceMatch: false,
        swissTotalRounds: 5,
        survivalRoundsBeforeFirstCut: null,
        survivalRoundsPerCut: null,
        ...first,
      },
      {
        position: 2,
        format: "SINGLE",
        name: null,
        qualifierMode: "COUNT",
        qualifierValue: 1,
        hasThirdPlaceMatch: false,
        swissTotalRounds: null,
        survivalRoundsBeforeFirstCut: null,
        survivalRoundsPerCut: null,
      },
    ];
    const odd = (value: unknown): number => value as number;
    const code = (first: Partial<PhaseConfig>): string | null => findPhaseIssue(plan(first))?.code ?? null;

    expect(code({ qualifierValue: Number.NaN })).toBe("INVALID_PHASE_QUALIFIER");
    expect(code({ qualifierValue: odd("abc") })).toBe("INVALID_PHASE_QUALIFIER");
    expect(code({ qualifierValue: odd(undefined) })).toBe("INVALID_PHASE_QUALIFIER");
    expect(code({ qualifierValue: odd(null) })).toBe("INVALID_PHASE_QUALIFIER");
    expect(code({ qualifierMode: "PERCENT", qualifierValue: Number.NaN })).toBe("INVALID_PHASE_QUALIFIER");
    expect(code({ qualifierMode: "PERCENT", qualifierValue: odd("abc") })).toBe("INVALID_PHASE_QUALIFIER");
    expect(code({ swissTotalRounds: Number.NaN })).toBe("INVALID_PHASE_SWISS_ROUNDS");
    expect(code({ swissTotalRounds: odd(undefined) })).toBe("INVALID_PHASE_SWISS_ROUNDS");
    expect(code({ format: "SURVIVAL", survivalRoundsPerCut: Number.NaN })).toBe(
      "INVALID_PHASE_SURVIVAL_ROUNDS",
    );
    expect(code({ format: "SURVIVAL", survivalRoundsBeforeFirstCut: odd("2") })).toBe(
      "INVALID_PHASE_SURVIVAL_ROUNDS",
    );
  });

  it("les générateurs couvrent les cas visés", () => {
    // Garde-fou : une empreinte n'a de valeur que si les cas exercent bien les
    // branches — ces compteurs le vérifient sans figer de valeur.
    let eliminated = 0;
    let outOfContention = 0;
    let forfeited = 0;
    for (let i = 0; i < CASES; i += 1) {
      for (const s of replayEnduranceDetailed(simulatedEnduranceInput(rng(i + 1), i)).standings) {
        if (s.status === "ELIMINATED") eliminated += 1;
        if (s.status === "OUT_OF_CONTENTION") outOfContention += 1;
        if (s.status === "FORFEIT") forfeited += 1;
      }
    }
    expect(eliminated).toBeGreaterThan(0);
    expect(outOfContention).toBeGreaterThan(0);
    expect(forfeited).toBeGreaterThan(0);

    const issues = new Set<string>();
    for (let i = 0; i < CASES * 2; i += 1) issues.add(findPhaseIssue(randomPhases(rng(i + 1), i % 3 === 0))?.code ?? "OK");
    expect(issues.size).toBeGreaterThanOrEqual(7);

    let survivalEliminated = 0;
    for (let i = 0; i < CASES; i += 1) {
      survivalEliminated += replaySurvival(simulatedSurvivalInput(rng(i + 1), i)).filter((s) => s.status === "ELIMINATED").length;
    }
    expect(survivalEliminated).toBeGreaterThan(0);
  });
});
