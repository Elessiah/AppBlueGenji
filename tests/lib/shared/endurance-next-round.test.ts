import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_ENDURANCE_CONFIG,
  enduranceMatchOutcome,
  PLAYOFF_ROUND_OFFSET,
  planEnduranceRound,
  planPlayoffFirstRound,
  qualificationComplete,
  rankActiveTeams,
  replayEndurance,
  roundLimitReached,
  selectQualifiedTeamIds,
  type EnduranceConfig,
  type EndurancePenalty,
} from "@/lib/shared/bg-survie";
import {
  analyseEnduranceRound,
  pendingMatchDeltas,
  previewEnduranceNextRound,
  type EnduranceNextRoundInput,
  type EnduranceNextRoundMatchRecord,
} from "@/lib/shared/endurance-next-round";
import { checkMatchScores, matchWinsRequired, type MatchFormat } from "@/lib/shared/match-format";

const FT3: MatchFormat = { type: "FT", value: 3 };
const FT2: MatchFormat = { type: "FT", value: 2 };
const BO3: MatchFormat = { type: "BO", value: 3 };
const FT2_DRAWS: MatchFormat = { type: "FT", value: 2, maxMaps: 2, drawsAllowed: true };

function teams(count: number) {
  return Array.from({ length: count }, (_, index) => ({ teamId: index + 1, seed: index + 1 }));
}

function record(
  round: number,
  matchNumber: number,
  team1Id: number,
  team2Id: number | null,
  overrides: Partial<EnduranceNextRoundMatchRecord> = {},
): EnduranceNextRoundMatchRecord {
  return {
    round,
    matchNumber,
    bracket: "UPPER",
    status: "READY",
    team1Id,
    team2Id,
    team1Score: null,
    team2Score: null,
    winnerTeamId: null,
    loserTeamId: null,
    forfeitTeamId: null,
    doubleForfeit: false,
    ...overrides,
  };
}

/** Match joué avec son score : vainqueur déduit du plus haut, nul à égalité. */
function played(
  round: number,
  matchNumber: number,
  team1Id: number,
  team2Id: number,
  score1: number,
  score2: number,
): EnduranceNextRoundMatchRecord {
  const winner = score1 > score2 ? team1Id : score2 > score1 ? team2Id : null;
  const loser = winner === null ? null : winner === team1Id ? team2Id : team1Id;
  return record(round, matchNumber, team1Id, team2Id, {
    status: "COMPLETED",
    team1Score: score1,
    team2Score: score2,
    winnerTeamId: winner,
    loserTeamId: loser,
  });
}

function input(overrides: Partial<EnduranceNextRoundInput>): EnduranceNextRoundInput {
  return {
    config: DEFAULT_ENDURANCE_CONFIG,
    format: FT3,
    currentRound: 1,
    playoffsStarted: false,
    teams: teams(8),
    forfeits: [],
    penalties: [],
    matches: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Vérification par force brute
// ---------------------------------------------------------------------------

/** Générateur reproductible (même LCG que le seed du projet). */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Tous les scores qu'un match peut enregistrer dans ce format. */
function finalScores(format: MatchFormat): [number, number][] {
  const wins = matchWinsRequired(format);
  const scores: [number, number][] = [];
  for (let a = 0; a <= wins; a += 1) {
    for (let b = 0; b <= wins; b += 1) {
      if (checkMatchScores(format, a, b, { decisive: true }) === null) scores.push([a, b]);
    }
  }
  return scores;
}

type Scenario = { input: EnduranceNextRoundInput; pending: EnduranceNextRoundMatchRecord[] };

/**
 * Tournoi joué par les fonctions du moteur jusqu'à la manche `rounds`, dont les
 * `pendingCount` derniers matchs restent ouverts. `null` si la qualification
 * s'est achevée avant.
 */
function simulate(
  seed: number,
  options: {
    teamCount: number;
    rounds: number;
    pendingCount: number;
    format: MatchFormat;
    config: EnduranceConfig;
    penalize?: boolean;
  },
): Scenario | null {
  const random = lcg(seed);
  const scores = finalScores(options.format);
  const roster = teams(options.teamCount);
  const records: EnduranceNextRoundMatchRecord[] = [];
  const penalties: EndurancePenalty[] = [];
  let pending: EnduranceNextRoundMatchRecord[] = [];

  for (let round = 1; round <= options.rounds; round += 1) {
    const standings = replayEndurance({
      teams: roster,
      matches: records.map(enduranceMatchOutcome),
      forfeits: [],
      penalties,
      config: options.config,
      lastRound: round - 1,
      matchFormat: options.format,
    });
    const active = rankActiveTeams(standings);
    if (
      active.length < 2 ||
      qualificationComplete(active.length, options.config) ||
      roundLimitReached(options.config, round - 1)
    ) {
      return null;
    }

    const pairings = planEnduranceRound(standings).filter((pairing) => pairing.teamBId !== null);
    pairings.forEach((pairing, index) => {
      const open = round === options.rounds && index >= pairings.length - options.pendingCount;
      if (open) {
        const match = record(round, index + 1, pairing.teamAId, pairing.teamBId);
        records.push(match);
        pending.push(match);
        return;
      }
      const [a, b] = scores[Math.floor(random() * scores.length)];
      records.push(played(round, index + 1, pairing.teamAId, pairing.teamBId as number, a, b));
    });

    if (options.penalize && round === options.rounds) {
      const target = active[Math.floor(random() * active.length)];
      penalties.push({ teamId: target.teamId, round, points: 1 + Math.floor(random() * 2) });
    }
  }

  pending = pending.filter((match) => match.round === options.rounds);
  if (pending.length === 0) return null;

  return {
    input: {
      config: options.config,
      format: options.format,
      currentRound: options.rounds,
      playoffsStarted: false,
      teams: roster,
      forfeits: [],
      penalties,
      matches: records,
    },
    pending,
  };
}

type World = {
  standings: ReturnType<typeof replayEndurance>;
  /** Couples de l'étape suivante, tels que le moteur les poserait. */
  next: { teamAId: number; teamBId: number | null }[];
  stage: "QUALIFICATION" | "PLAYOFFS";
};

/** Tous les déroulés possibles des matchs restants, rejoués par le moteur. */
function worlds(scenario: Scenario): World[] {
  const { input: base, pending } = scenario;
  const scores = finalScores(base.format as MatchFormat);
  const result: World[] = [];

  const explore = (index: number, chosen: EnduranceNextRoundMatchRecord[]) => {
    if (index === pending.length) {
      const replaced = new Map(chosen.map((match) => [`${match.round}:${match.matchNumber}`, match]));
      const matches = base.matches.map(
        (match) => replaced.get(`${match.round}:${match.matchNumber}`) ?? match,
      );
      const standings = replayEndurance({
        teams: base.teams,
        matches: matches.map(enduranceMatchOutcome),
        forfeits: base.forfeits,
        penalties: base.penalties,
        config: base.config,
        lastRound: base.currentRound,
        matchFormat: base.format,
      });
      const active = rankActiveTeams(standings);
      const toPlayoffs =
        qualificationComplete(active.length, base.config) ||
        roundLimitReached(base.config, base.currentRound);
      result.push(
        toPlayoffs
          ? {
              standings,
              stage: "PLAYOFFS",
              next: planPlayoffFirstRound(selectQualifiedTeamIds(standings, base.config), base.config).map(
                (entry) => entry.pairing,
              ),
            }
          : { standings, stage: "QUALIFICATION", next: planEnduranceRound(standings) },
      );
      return;
    }
    const match = pending[index];
    for (const [a, b] of scores) {
      explore(index + 1, [
        ...chosen,
        played(match.round, match.matchNumber, match.team1Id as number, match.team2Id as number, a, b),
      ]);
    }
  };

  explore(0, []);
  return result;
}

/** Chaque rencontre annoncée figure dans chaque déroulé, côtés compris s'ils sont annoncés. */
function expectSound(scenario: Scenario) {
  const preview = previewEnduranceNextRound(scenario.input);
  expect(preview).not.toBeNull();
  const all = worlds(scenario);

  for (const world of all) {
    if (preview!.stageCertain) expect(world.stage).toBe(preview!.stage);
    if (world.stage !== preview!.stage) continue;

    for (const match of preview!.matches) {
      const found = world.next.find(
        (pairing) =>
          (pairing.teamAId === match.teamAId && pairing.teamBId === match.teamBId) ||
          (!match.sidesKnown &&
            pairing.teamAId === match.teamBId &&
            pairing.teamBId === match.teamAId),
      );
      expect(found).toBeDefined();
    }
  }
  return { preview: preview!, worlds: all };
}

describe("previewEnduranceNextRound — force brute", () => {
  const cases = [
    { teamCount: 12, rounds: 1, pendingCount: 2, format: FT2 },
    { teamCount: 12, rounds: 2, pendingCount: 3, format: FT2 },
    { teamCount: 11, rounds: 2, pendingCount: 2, format: BO3 },
    { teamCount: 14, rounds: 3, pendingCount: 2, format: FT2_DRAWS },
    { teamCount: 13, rounds: 2, pendingCount: 3, format: FT2_DRAWS },
    { teamCount: 16, rounds: 3, pendingCount: 2, format: FT3 },
  ];

  it.each(cases)(
    "n'annonce que des rencontres sûres, aux places exactes ($teamCount équipes, manche $rounds, $pendingCount ouverts)",
    ({ teamCount, rounds, pendingCount, format }) => {
      let checked = 0;
      for (let seed = 1; seed <= 12; seed += 1) {
        const config = { ...DEFAULT_ENDURANCE_CONFIG, startPoints: 3 + (seed % 3), playoffSize: 4 };
        const scenario = simulate(seed * 7919 + teamCount, {
          teamCount,
          rounds,
          pendingCount,
          format,
          config,
          penalize: seed % 2 === 0,
        });
        if (!scenario) continue;
        checked += 1;

        const { worlds: all } = expectSound(scenario);

        // Exactitude des places : hors plafond de manches, les bornes calculées
        // sont exactement celles des déroulés.
        const analysis = analyseEnduranceRound(scenario.input)!;
        const observed = new Map<number, { best: number; worst: number; present: number }>();
        for (const world of all) {
          rankActiveTeams(world.standings).forEach((standing, index) => {
            const entry = observed.get(standing.teamId) ?? {
              best: Number.POSITIVE_INFINITY,
              worst: 0,
              present: 0,
            };
            observed.set(standing.teamId, {
              best: Math.min(entry.best, index + 1),
              worst: Math.max(entry.worst, index + 1),
              present: entry.present + 1,
            });
          });
        }
        for (const [teamId, position] of analysis.positions) {
          const seen = observed.get(teamId);
          expect(seen).toBeDefined();
          expect(position.best).toBe(seen!.best);
          expect(position.worst).toBe(seen!.worst);
          expect(position.presence === "ALWAYS").toBe(seen!.present === all.length);
        }
        expect([...observed.keys()].sort()).toEqual([...analysis.positions.keys()].sort());

        const counts = all.map((world) => rankActiveTeams(world.standings).length);
        expect(analysis.minActive).toBe(Math.min(...counts));
        expect(analysis.maxActive).toBe(Math.max(...counts));
      }
      expect(checked).toBeGreaterThan(0);
    },
  );

  it("n'annonce que des rencontres sûres sous plafond de manches (coupe approchée)", () => {
    let checked = 0;
    for (let seed = 1; seed <= 24; seed += 1) {
      const rounds = 1 + (seed % 3);
      const config = {
        ...DEFAULT_ENDURANCE_CONFIG,
        startPoints: 4,
        playoffSize: 4,
        maxRounds: rounds + (seed % 2),
      };
      const scenario = simulate(seed * 104729, {
        teamCount: 12,
        rounds,
        pendingCount: 2,
        format: FT2,
        config,
        penalize: seed % 3 === 0,
      });
      if (!scenario) continue;
      checked += 1;
      expectSound(scenario);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("annonce bien des rencontres quand le plateau est tranché", () => {
    // Somme sur tous les scénarios : l'aperçu n'est pas vide par construction.
    let announced = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const scenario = simulate(seed, {
        teamCount: 16,
        rounds: 3,
        pendingCount: 1,
        format: FT2,
        config: { ...DEFAULT_ENDURANCE_CONFIG, startPoints: 5, playoffSize: 4 },
      });
      if (!scenario) continue;
      announced += expectSound(scenario).preview.matches.length;
    }
    expect(announced).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Cas écrits à la main
// ---------------------------------------------------------------------------

describe("previewEnduranceNextRound — manche qualificative", () => {
  it("annonce les couples déjà écrits pendant qu'un match reste à jouer", () => {
    // Huit équipes à 9, manche 1 : 1-2, 3-4, 5-6, 7-8. Trois matchs joués,
    // le dernier (7-8) ouvert. En FT3, 7 et 8 finissent entre 6 et 12 —
    // l'une monte, l'autre descend, jamais les deux au même capital.
    const matches = [
      played(1, 1, 1, 2, 3, 0), // 1 → 12, 2 → 6
      played(1, 2, 3, 4, 3, 0), // 3 → 12, 4 → 6
      played(1, 3, 5, 6, 3, 2), // 5 → 10, 6 → 8
      record(1, 4, 7, 8),
    ];
    const preview = previewEnduranceNextRound(
      input({ matches, config: { ...DEFAULT_ENDURANCE_CONFIG, playoffSize: 4 } }),
    );

    expect(preview).not.toBeNull();
    expect(preview!.stage).toBe("QUALIFICATION");
    expect(preview!.round).toBe(2);
    expect(preview!.pendingMatches).toBe(1);
    expect(preview!.stageCertain).toBe(true);
    expect(preview!.expectedMatches).toBe(4);
    // 1 et 3 finissent à 12, devant tout le monde (7 ou 8 plafonnent à 12
    // mais sont classées derrière à égalité) : leur couple est écrit, côtés
    // compris.
    expect(preview!.matches).toContainEqual({
      teamAId: 1,
      teamBId: 3,
      sidesKnown: true,
      bracket: "UPPER",
    });
    // 7 ou 8 peut s'intercaler n'importe où plus bas : rien d'autre n'est sûr.
    expect(preview!.matches).toHaveLength(1);
  });

  it("dit l'effectif quand il est acquis", () => {
    // Sept équipes : la 7ᵉ chôme la manche 1. 1-2 et 3-4 joués largement,
    // 5-6 ouvert. Personne ne peut tomber à 0 en une manche depuis 9.
    const matches = [
      played(1, 1, 1, 2, 3, 0), // 1 → 12, 2 → 6
      played(1, 2, 3, 4, 3, 0), // 3 → 12, 4 → 6
      record(1, 3, 5, 6),
    ];
    const preview = previewEnduranceNextRound(
      input({ teams: teams(7), matches, config: { ...DEFAULT_ENDURANCE_CONFIG, playoffSize: 4 } }),
    )!;
    expect(preview.expectedMatches).toBe(3);
    expect(preview.matches).toContainEqual({ teamAId: 1, teamBId: 3, sidesKnown: true, bracket: "UPPER" });
  });

  it("annonce une exemption connue", () => {
    // Cinq équipes à 20, FT1, cible 2. 1-2 joué (1 → 21, 2 → 19), 3-4 ouvert
    // (21/19 dans un sens ou dans l'autre), 5 chôme puis prend 15 points de
    // pénalité : elle finit 5ᵉ quoi qu'il arrive, sur un effectif impair acquis.
    const preview = previewEnduranceNextRound(
      input({
        teams: teams(5),
        format: { type: "FT", value: 1 },
        config: { ...DEFAULT_ENDURANCE_CONFIG, startPoints: 20, playoffSize: 2 },
        penalties: [{ teamId: 5, round: 1, points: 15 }],
        matches: [played(1, 1, 1, 2, 1, 0), record(1, 2, 3, 4)],
      }),
    )!;
    // 1 est première, 2 troisième — mais leurs adversaires dépendent de 3-4.
    expect(preview.matches).toEqual([
      { teamAId: 5, teamBId: null, sidesKnown: true, bracket: "UPPER" },
    ]);
    expect(preview.expectedMatches).toBe(2);
  });

  it("n'annonce rien en tête quand une équipe jouée peut s'y intercaler", () => {
    // 1-2 ouvert à 20 points ; 3, 5 et 7 ont gagné 3-0 (23) : chacune peut
    // finir devant, derrière ou entre 1 et 2.
    const matches = [
      record(1, 1, 1, 2),
      played(1, 2, 3, 4, 3, 0),
      played(1, 3, 5, 6, 3, 0),
      played(1, 4, 7, 8, 3, 0),
    ];
    const preview = previewEnduranceNextRound(
      input({ matches, config: { ...DEFAULT_ENDURANCE_CONFIG, startPoints: 20, playoffSize: 4 } }),
    )!;
    expect(preview.matches.some((match) => match.teamAId === 1 || match.teamBId === 1)).toBe(false);
  });

  it("repère un couple aux côtés indécis", () => {
    // Quatre équipes à 20, cible 2, FT1 : 1-2 ouvert, 3-4 joué puis lourdement
    // sanctionné. 1 et 2 finissent à 21/19 dans un ordre que seul leur match
    // décide : elles occupent les places 1 et 2, côtés inconnus.
    const preview = previewEnduranceNextRound(
      input({
        teams: teams(4),
        format: { type: "FT", value: 1 },
        config: { ...DEFAULT_ENDURANCE_CONFIG, startPoints: 20, playoffSize: 2 },
        penalties: [
          { teamId: 3, round: 1, points: 15 },
          { teamId: 4, round: 1, points: 15 },
        ],
        matches: [
          record(1, 1, 1, 2),
          played(1, 2, 3, 4, 1, 0), // 3 → 21 − 15 = 6, 4 → 19 − 15 = 4
        ],
      }),
    )!;
    expect(preview.stage).toBe("QUALIFICATION");
    expect(preview.stageCertain).toBe(true);
    expect(preview.matches).toEqual([
      { teamAId: 1, teamBId: 2, sidesKnown: false, bracket: "UPPER" },
      { teamAId: 3, teamBId: 4, sidesKnown: true, bracket: "UPPER" },
    ]);
  });

  it("garde les côtés quand l'ordre précédent départage l'égalité possible", () => {
    // Même plateau une manche plus loin : 1 (21) et 2 (19) rejouent en FT1.
    // Une victoire de 2 les met à égalité à 20 — et l'ordre précédent garde 1
    // devant. Les côtés sont donc acquis.
    const preview = previewEnduranceNextRound(
      input({
        teams: teams(4),
        currentRound: 2,
        format: { type: "FT", value: 1 },
        config: { ...DEFAULT_ENDURANCE_CONFIG, startPoints: 20, playoffSize: 2 },
        penalties: [
          { teamId: 3, round: 1, points: 15 },
          { teamId: 4, round: 1, points: 15 },
        ],
        matches: [
          played(1, 1, 1, 2, 1, 0),
          played(1, 2, 3, 4, 1, 0),
          record(2, 1, 1, 2),
          played(2, 2, 3, 4, 1, 0),
        ],
      }),
    )!;
    expect(preview.matches[0]).toEqual({ teamAId: 1, teamBId: 2, sidesKnown: true, bracket: "UPPER" });
  });

  it("tient compte d'une pénalité de la manche en cours, appliquée après le match", () => {
    // Capital 3. 2 prend une pénalité de 3 en manche 1 : elle ne tombe que si
    // son match ne lui a rien rapporté — une victoire 1-0 (FT1) la sauve.
    const base = input({
      teams: teams(4),
      format: { type: "FT", value: 1 },
      config: { ...DEFAULT_ENDURANCE_CONFIG, startPoints: 3, playoffSize: 2 },
      penalties: [{ teamId: 2, round: 1, points: 3 }],
      matches: [record(1, 1, 1, 2), played(1, 2, 3, 4, 1, 0)],
    });
    const analysis = analyseEnduranceRound(base)!;
    // 2 gagne 1-0 → 4 − 3 = 1 : présente. 2 perd → 2 − 3 : sortie.
    expect(analysis.positions.get(2)?.presence).toBe("SOMETIMES");
    expect(analysis.minActive).toBe(3);
    expect(analysis.maxActive).toBe(4);
  });

  it("exclut une équipe qui a abandonné pendant la manche", () => {
    const analysis = analyseEnduranceRound(
      input({
        teams: teams(6),
        forfeits: [{ teamId: 5, round: 1 }],
        matches: [record(1, 1, 1, 2), played(1, 2, 3, 4, 3, 0), played(1, 3, 5, 6, 3, 0)],
      }),
    )!;
    expect(analysis.positions.has(5)).toBe(false);
    expect(analysis.maxActive).toBe(5);
  });

  it("ne prévoit rien en saisie libre, et le dit", () => {
    const preview = previewEnduranceNextRound(
      input({ format: null, matches: [record(1, 1, 1, 2), played(1, 2, 3, 4, 3, 0)] }),
    )!;
    expect(preview.freeScore).toBe(true);
    expect(preview.matches).toEqual([]);
    expect(preview.expectedMatches).toBeNull();
    expect(analyseEnduranceRound(input({ format: null, matches: [record(1, 1, 1, 2)] }))).toBeNull();
  });

  it("rend null sans manche posée ou sur une manche close", () => {
    expect(previewEnduranceNextRound(input({ currentRound: 0 }))).toBeNull();
    expect(
      previewEnduranceNextRound(input({ matches: [played(1, 1, 1, 2, 3, 0)] })),
    ).toBeNull();
    expect(previewEnduranceNextRound(input({ format: null, currentRound: 0 }))).toBeNull();
  });

  it("ne marque pas l'étape acquise quand la qualification peut s'achever sur la manche", () => {
    // Capital 1 : chaque perdant d'une manche tombe à 0. Six équipes, cible 4 :
    // 1-2 joué (2 sort), 3-4 et 5-6 ouverts. En FT1, les deux perdants
    // sortent, trois restent… mais un nul est impossible, donc exactement
    // trois : la qualification s'achève. Avec FT2 et un 2-1, le perdant garde
    // 1 − 2 + 1 = 0 → sort aussi. Toujours trois en lice : arbre acquis.
    const preview = previewEnduranceNextRound(
      input({
        teams: teams(6),
        format: { type: "FT", value: 1 },
        config: { ...DEFAULT_ENDURANCE_CONFIG, startPoints: 1, playoffSize: 4 },
        matches: [played(1, 1, 1, 2, 1, 0), record(1, 2, 3, 4), record(1, 3, 5, 6)],
      }),
    )!;
    expect(preview.stage).toBe("PLAYOFFS");
    expect(preview.round).toBe(PLAYOFF_ROUND_OFFSET);
    expect(preview.stageCertain).toBe(true);
    expect(preview.expectedMatches).toBe(1);
  });
});

describe("previewEnduranceNextRound — premier tour de l'arbre", () => {
  it("annonce les quarts acquis à la dernière manche d'un plafond", () => {
    // Dix équipes, plafond 1 manche, cible 8 : la manche 1 est la dernière.
    const config = { ...DEFAULT_ENDURANCE_CONFIG, maxRounds: 1, playoffSize: 8 };
    const matches = [
      played(1, 1, 1, 2, 3, 0), // 1 → 12, 2 → 6
      played(1, 2, 3, 4, 3, 0), // 3 → 12, 4 → 6
      played(1, 3, 5, 6, 3, 0), // 5 → 12, 6 → 6
      played(1, 4, 7, 8, 3, 0), // 7 → 12, 8 → 6
      record(1, 5, 9, 10),
    ];
    const preview = previewEnduranceNextRound(input({ teams: teams(10), config, matches }))!;
    expect(preview.stage).toBe("PLAYOFFS");
    expect(preview.stageCertain).toBe(true);
    expect(preview.expectedMatches).toBe(4);
    // 9 ou 10 peut finir à 12 : les quatre premières places ne sont pas
    // acquises nommément… 1, 3, 5, 7 finissent à 12 devant 9/10 (ordre
    // précédent) : places 1 à 4 fixées. 1v5 : places 1 et 5 — la 5ᵉ se
    // dispute entre 9/10 et 2/4/6/8. Seules les rencontres entre places fixes
    // sont annoncées.
    for (const match of preview.matches) {
      expect(match.sidesKnown).toBe(true);
    }
  });

  it("n'annonce rien tant que l'effectif qualifié n'est pas acquis", () => {
    // Capital 1, cible 4, six équipes, pas de plafond : les perdants tombent.
    // 1-2 joué, 3-4 ouvert, 5 et 6 chôment → après la manche : 1, 3|4, 5, 6
    // (2 sort) = 4 → arbre. Effectif acquis : 4.
    const preview = previewEnduranceNextRound(
      input({
        teams: teams(5),
        format: { type: "FT", value: 1 },
        config: { ...DEFAULT_ENDURANCE_CONFIG, startPoints: 1, playoffSize: 3 },
        matches: [played(1, 1, 1, 2, 1, 0), record(1, 2, 3, 4)],
      }),
    )!;
    expect(preview.stage).toBe("PLAYOFFS");
    expect(preview.expectedMatches).toBe(1);
  });
});

describe("previewEnduranceNextRound — play-offs en cours", () => {
  function playoff(
    matchNumber: number,
    team1Id: number,
    team2Id: number,
    winner: number | null,
    bracket = "UPPER",
    round = PLAYOFF_ROUND_OFFSET,
  ): EnduranceNextRoundMatchRecord {
    return record(round, matchNumber, team1Id, team2Id, {
      bracket,
      status: winner === null ? "READY" : "COMPLETED",
      winnerTeamId: winner,
      loserTeamId: winner === null ? null : winner === team1Id ? team2Id : team1Id,
    });
  }

  it("annonce la demi-finale dont les deux quarts sont joués", () => {
    const preview = previewEnduranceNextRound(
      input({
        playoffsStarted: true,
        matches: [
          playoff(1, 8, 4, 8),
          playoff(2, 6, 2, 2),
          playoff(3, 1, 5, null),
          playoff(4, 3, 7, 3),
        ],
      }),
    )!;
    expect(preview.stage).toBe("PLAYOFFS");
    expect(preview.round).toBe(PLAYOFF_ROUND_OFFSET + 1);
    expect(preview.pendingMatches).toBe(1);
    expect(preview.expectedMatches).toBe(2);
    expect(preview.matches).toEqual([
      { teamAId: 8, teamBId: 2, sidesKnown: true, bracket: "UPPER" },
    ]);
  });

  it("annonce la petite finale seulement quand les deux demies sont jouées", () => {
    const semis = (second: number | null) =>
      previewEnduranceNextRound(
        input({
          playoffsStarted: true,
          matches: [
            playoff(1, 8, 2, 8, "UPPER", PLAYOFF_ROUND_OFFSET + 1),
            playoff(2, 1, 3, second, "UPPER", PLAYOFF_ROUND_OFFSET + 1),
            playoff(1, 8, 4, 8),
          ],
        }),
      );
    // Une demi ouverte : ni finale ni petite finale acquises, mais deux
    // rencontres à venir.
    expect(semis(null)!.matches).toEqual([]);
    expect(semis(null)!.expectedMatches).toBe(2);
    // Les deux jouées : le moteur a déjà posé la suite, rien à prévoir.
    expect(semis(1)).toBeNull();
  });

  it("rend null sur une finale en cours", () => {
    expect(
      previewEnduranceNextRound(
        input({
          playoffsStarted: true,
          matches: [playoff(1, 1, 2, null, "UPPER", PLAYOFF_ROUND_OFFSET + 2)],
        }),
      ),
    ).toBeNull();
    expect(previewEnduranceNextRound(input({ playoffsStarted: true }))).toBeNull();
  });

  it("garde l'exemption née d'un double forfait", () => {
    const preview = previewEnduranceNextRound(
      input({
        playoffsStarted: true,
        matches: [
          record(PLAYOFF_ROUND_OFFSET, 1, 8, 4, {
            status: "COMPLETED",
            doubleForfeit: true,
          }),
          playoff(2, 6, 2, 2),
          playoff(3, 1, 5, null),
          playoff(4, 3, 7, null),
        ],
      }),
    )!;
    expect(preview.matches).toEqual([
      { teamAId: 2, teamBId: null, sidesKnown: true, bracket: "UPPER" },
    ]);
    expect(preview.expectedMatches).toBe(1);
  });
});

describe("previewEnduranceNextRound — coût", () => {
  it("reste instantané sur un plateau de 128 équipes, 64 matchs ouverts en BO15", () => {
    // Le calcul tourne sur le fil principal, à chaque score reçu : son coût ne
    // doit pas dépendre du produit des résultats possibles de chaque match.
    const matches = Array.from({ length: 64 }, (_, index) =>
      record(1, index + 1, 2 * index + 1, 2 * index + 2),
    );
    const started = Date.now();
    const preview = previewEnduranceNextRound(
      input({
        teams: teams(128),
        format: { type: "BO", value: 15 },
        config: { ...DEFAULT_ENDURANCE_CONFIG, maxRounds: 5 },
        matches,
      }),
    );
    expect(preview).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("pendingMatchDeltas", () => {
  it("couvre tous les scores enregistrables et le forfait", () => {
    const deltas = pendingMatchDeltas(FT3, DEFAULT_ENDURANCE_CONFIG);
    const values = deltas.map(([a]) => a).sort((x, y) => x - y);
    expect(values).toEqual([-3, -2, -1, 1, 2, 3]);
    for (const [a, b] of deltas) expect(a + b).toBe(0);
  });

  it("inclut les nuls quand le format les autorise", () => {
    const deltas = pendingMatchDeltas(FT2_DRAWS, DEFAULT_ENDURANCE_CONFIG);
    expect(deltas).toContainEqual([0, 0]);
  });

  it("suit un barème asymétrique map par map", () => {
    const deltas = pendingMatchDeltas(FT2, { ...DEFAULT_ENDURANCE_CONFIG, winDelta: 2, lossDelta: 1 });
    // 2-1 : vainqueur 4 − 1 = 3, perdant 2 − 2 = 0.
    expect(deltas).toContainEqual([3, 0]);
    expect(deltas).toContainEqual([4, -2]);
  });
});

describe("enduranceMatchOutcome", () => {
  it("réordonne les scores par vainqueur", () => {
    expect(enduranceMatchOutcome(played(2, 1, 3, 4, 1, 3))).toMatchObject({
      round: 2,
      completed: true,
      winnerTeamId: 4,
      loserTeamId: 3,
      winnerMaps: 3,
      loserMaps: 1,
      isForfeit: false,
      drawTeamIds: null,
      doubleForfeitTeamIds: null,
    });
  });

  it("reconnaît un nul et un double forfait", () => {
    expect(enduranceMatchOutcome(played(1, 1, 3, 4, 2, 2))).toMatchObject({
      drawTeamIds: [3, 4],
      drawMaps: 2,
    });
    expect(
      enduranceMatchOutcome(record(1, 1, 3, 4, { status: "COMPLETED", doubleForfeit: true })),
    ).toMatchObject({ doubleForfeitTeamIds: [3, 4], drawTeamIds: null });
    // Un drapeau resté sur une ligne rouverte ne compte pas.
    expect(enduranceMatchOutcome(record(1, 1, 3, 4, { doubleForfeit: true })).doubleForfeitTeamIds).toBeNull();
  });

  it("n'appelle pas nul un match clos sans score ni vainqueur, ni un forfait", () => {
    expect(enduranceMatchOutcome(record(1, 1, 3, 4, { status: "COMPLETED" })).drawTeamIds).toBeNull();
    expect(
      enduranceMatchOutcome(
        record(1, 1, 3, 4, { status: "COMPLETED", forfeitTeamId: 3, team1Score: 0, team2Score: 0 }),
      ),
    ).toMatchObject({ isForfeit: true, drawTeamIds: null });
  });
});
