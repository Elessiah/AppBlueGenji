import { describe, expect, it } from "@jest/globals";
import type {
  BracketMatch,
  MatchStatus,
  TournamentCard,
  TournamentPhase,
} from "@/lib/shared/types";
import {
  TOURNAMENT_STAGE_ORDER,
  computeRunningRatio,
  computeTournamentProgress,
  formatStageCountdown,
} from "@/lib/shared/tournament-progress";

const DAY = 24 * 60 * 60 * 1000;

/** Calendrier de référence : un jalon par jour, du 1er au 4 juin. */
const VISIBLE_AT = "2026-06-01T12:00:00Z";
const OPEN_AT = "2026-06-02T12:00:00Z";
const CLOSE_AT = "2026-06-03T12:00:00Z";
const START_AT = "2026-06-04T12:00:00Z";

const card = (overrides: Partial<TournamentCard> = {}): TournamentCard =>
  ({
    id: 1,
    name: "Tournoi",
    description: null,
    format: "SINGLE",
    game: "OW2",
    participantType: "TEAM",
    maxTeams: 8,
    registeredTeams: 0,
    state: "UPCOMING",
    startVisibilityAt: VISIBLE_AT,
    registrationOpenAt: OPEN_AT,
    registrationCloseAt: CLOSE_AT,
    startAt: START_AT,
    hasThirdPlaceMatch: false,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    phases: null,
    matchFormat: null,
    ...overrides,
  }) as TournamentCard;

const at = (iso: string, offsetMs = 0) => Date.parse(iso) + offsetMs;

const match = (overrides: Partial<BracketMatch> = {}): BracketMatch =>
  ({
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
    updatedAt: VISIBLE_AT,
    phaseId: 0,
    phasePosition: null,
    ...overrides,
  }) as BracketMatch;

const matches = (statuses: MatchStatus[], overrides: Partial<BracketMatch> = {}) =>
  statuses.map((status, index) => match({ id: index + 1, status, ...overrides }));

const phase = (overrides: Partial<TournamentPhase> = {}): TournamentPhase =>
  ({
    id: 1,
    position: 1,
    name: null,
    format: "SWISS",
    qualifierMode: "COUNT",
    qualifierValue: 8,
    hasThirdPlaceMatch: false,
    swissTotalRounds: null,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    state: "PENDING",
    entrants: null,
    qualifiers: null,
    maxRounds: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }) as TournamentPhase;

describe("computeTournamentProgress — étape courante", () => {
  it("place avant la date de visibilité un tournoi encore masqué", () => {
    const progress = computeTournamentProgress(card(), {
      now: at(VISIBLE_AT, -DAY),
    });

    expect(progress.current).toBe("HIDDEN");
    expect(progress.currentIndex).toBe(0);
    expect(progress.ratio).toBe(0);
  });

  it("passe à « annoncé » dès la visibilité ouverte, avant les inscriptions", () => {
    const progress = computeTournamentProgress(card(), { now: at(VISIBLE_AT) });
    expect(progress.current).toBe("ANNOUNCED");
  });

  it("distingue les deux versants de UPCOMING que l'état stocké confond", () => {
    const before = computeTournamentProgress(card({ state: "UPCOMING" }), {
      now: at(OPEN_AT, -1),
    });
    const after = computeTournamentProgress(card({ state: "UPCOMING" }), {
      now: at(CLOSE_AT, 1),
    });

    expect(before.current).toBe("ANNOUNCED");
    expect(after.current).toBe("LOCKED");
  });

  it("compte la borne de clôture comme encore ouverte aux inscriptions", () => {
    const progress = computeTournamentProgress(card(), { now: at(CLOSE_AT) });
    expect(progress.current).toBe("REGISTRATION");
  });

  it("suit l'état stocké quand le tournoi est clos avant l'heure", () => {
    const progress = computeTournamentProgress(card({ state: "FINISHED" }), {
      now: at(OPEN_AT),
    });

    expect(progress.current).toBe("FINISHED");
    expect(progress.ratio).toBe(1);
    expect(progress.next).toBeNull();
  });

  it("suit l'état stocké quand le tournoi tourne encore après l'heure", () => {
    const progress = computeTournamentProgress(card({ state: "RUNNING" }), {
      now: at(START_AT, 10 * DAY),
    });

    expect(progress.current).toBe("RUNNING");
  });

  it("ne laisse pas l'état REGISTRATION faire reculer une clôture déjà passée", () => {
    const progress = computeTournamentProgress(card({ state: "REGISTRATION" }), {
      now: at(CLOSE_AT, DAY / 2),
    });

    expect(progress.current).toBe("LOCKED");
  });

  it("garde « masqué » sur un tournoi que l'état dit seulement à venir", () => {
    const progress = computeTournamentProgress(card({ state: "UPCOMING" }), {
      now: at(VISIBLE_AT, -1),
    });

    expect(progress.current).toBe("HIDDEN");
  });
});

describe("computeTournamentProgress — étapes rendues", () => {
  it("qualifie chaque étape par rapport à la courante", () => {
    const progress = computeTournamentProgress(card(), { now: at(CLOSE_AT, -1) });

    expect(progress.stages.map((stage) => stage.status)).toEqual([
      "DONE",
      "DONE",
      "CURRENT",
      "TODO",
      "TODO",
      "TODO",
    ]);
  });

  it("rend les six étapes dans l'ordre, avec leur date d'entrée", () => {
    const progress = computeTournamentProgress(card(), { now: at(VISIBLE_AT) });

    expect(progress.stages.map((stage) => stage.key)).toEqual(TOURNAMENT_STAGE_ORDER);
    expect(progress.stages.map((stage) => stage.at)).toEqual([
      null,
      VISIBLE_AT,
      OPEN_AT,
      CLOSE_AT,
      START_AT,
      null,
    ]);
  });

  it("annonce le jalon suivant avec sa date", () => {
    const progress = computeTournamentProgress(card(), { now: at(OPEN_AT) });

    expect(progress.next).toEqual({ key: "LOCKED", label: "Clôture", at: CLOSE_AT });
  });
});

describe("computeTournamentProgress — remplissage", () => {
  it("découpe la barre en sixièmes plutôt qu'au prorata du temps", () => {
    // Une étape courte et une étape longue pèsent le même sixième.
    const progress = computeTournamentProgress(
      card({ registrationCloseAt: "2026-09-02T12:00:00Z", startAt: "2026-09-03T12:00:00Z" }),
      { now: at(OPEN_AT) },
    );

    expect(progress.ratio).toBeCloseTo(2 / 5, 5);
  });

  it("avance à l'intérieur de l'étape courante au fil du temps", () => {
    const progress = computeTournamentProgress(card(), { now: at(OPEN_AT, DAY / 2) });

    // Mi-parcours des inscriptions : deux étapes franchies + une demie.
    expect(progress.ratio).toBeCloseTo(2.5 / 5, 5);
  });

  it("laisse l'étape masquée à zéro, faute de début connu", () => {
    const progress = computeTournamentProgress(card(), { now: at(VISIBLE_AT, -10 * DAY) });
    expect(progress.ratio).toBe(0);
  });

  it("stagne au seuil « en cours » sans avancement de matchs fourni", () => {
    const progress = computeTournamentProgress(card({ state: "RUNNING" }), {
      now: at(START_AT),
    });

    expect(progress.ratio).toBeCloseTo(4 / 5, 5);
  });

  it("consomme l'avancement des matchs sur le segment « en cours »", () => {
    const progress = computeTournamentProgress(card({ state: "RUNNING" }), {
      now: at(START_AT),
      playedRatio: 0.5,
    });

    expect(progress.ratio).toBeCloseTo(4.5 / 5, 5);
  });

  it("borne un avancement de matchs aberrant", () => {
    const over = computeTournamentProgress(card({ state: "RUNNING" }), {
      now: at(START_AT),
      playedRatio: 4,
    });
    const under = computeTournamentProgress(card({ state: "RUNNING" }), {
      now: at(START_AT),
      playedRatio: -2,
    });

    expect(over.ratio).toBe(1);
    expect(under.ratio).toBeCloseTo(4 / 5, 5);
  });

  it("remplit la barre entièrement sur un tournoi terminé", () => {
    const progress = computeTournamentProgress(card({ state: "FINISHED" }), {
      now: at(START_AT, DAY),
    });

    expect(progress.ratio).toBe(1);
  });
});

describe("computeTournamentProgress — dates douteuses", () => {
  it("n'inverse pas la frise quand la clôture est placée après le départ", () => {
    const progress = computeTournamentProgress(
      card({ registrationCloseAt: "2026-06-10T12:00:00Z", startAt: START_AT }),
      { now: at(START_AT) },
    );

    // La clôture, ramenée au plus tôt à la date du départ, laisse les
    // inscriptions ouvertes plutôt que de faire reculer la jauge.
    expect(progress.current).toBe("REGISTRATION");
    expect(progress.ratio).toBeGreaterThanOrEqual(0);
    expect(progress.ratio).toBeLessThanOrEqual(1);
  });

  it("emprunte le jalon précédent quand une date est illisible", () => {
    const progress = computeTournamentProgress(
      card({ registrationOpenAt: "pas une date" }),
      { now: at(VISIBLE_AT, 1) },
    );

    // Ouverture ramenée sur la visibilité : l'étape « annoncé » est franchie.
    expect(progress.current).toBe("REGISTRATION");
  });

  it("ne casse pas quand toutes les dates sont illisibles", () => {
    const progress = computeTournamentProgress(
      card({
        startVisibilityAt: "?",
        registrationOpenAt: "?",
        registrationCloseAt: "?",
        startAt: "?",
      }),
      { now: at(VISIBLE_AT) },
    );

    expect(Number.isFinite(progress.ratio)).toBe(true);
    expect(TOURNAMENT_STAGE_ORDER).toContain(progress.current);
  });
});

describe("computeRunningRatio", () => {
  it("compte les matchs joués en élimination, où le plateau est connu d'avance", () => {
    const ratio = computeRunningRatio({
      format: "SINGLE",
      matches: matches(["COMPLETED", "COMPLETED", "READY", "PENDING"]),
    });

    expect(ratio).toBe(0.5);
  });

  it("ne renvoie rien sans le moindre match", () => {
    expect(computeRunningRatio({ format: "DOUBLE", matches: [] })).toBeNull();
  });

  it("compte les rondes en suisse, dont une seule est générée à la fois", () => {
    const ratio = computeRunningRatio({
      format: "SWISS",
      swiss: { totalRounds: 4, currentRound: 3 },
      matches: [
        ...matches(["COMPLETED", "COMPLETED"], { roundNumber: 1 }),
        ...matches(["COMPLETED", "COMPLETED"], { roundNumber: 2 }),
        ...matches(["COMPLETED", "PENDING"], { roundNumber: 3 }),
      ],
    });

    // Deux rondes closes + la moitié de la troisième, sur quatre.
    expect(ratio).toBeCloseTo(2.5 / 4, 5);
  });

  it("ne prend pas une survie pour terminée dès sa première manche jouée", () => {
    const asSwiss = computeRunningRatio({
      format: "SINGLE",
      matches: matches(["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED"]),
    });
    const asSurvival = computeRunningRatio({
      format: "SURVIVAL",
      matches: matches(["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED"]),
      survivalStandings: [
        { status: "ACTIVE" },
        { status: "ACTIVE" },
        { status: "ACTIVE" },
        { status: "ACTIVE" },
        { status: "ACTIVE" },
        { status: "ACTIVE" },
        { status: "ELIMINATED" },
        { status: "ELIMINATED" },
      ],
    });

    expect(asSwiss).toBe(1);
    expect(asSurvival).toBeCloseTo(2 / 7, 5);
  });

  it("compte un forfait comme une sortie en survie", () => {
    const ratio = computeRunningRatio({
      format: "SURVIVAL",
      matches: [],
      survivalStandings: [{ status: "ACTIVE" }, { status: "FORFEIT" }, { status: "ACTIVE" }],
    });

    expect(ratio).toBeCloseTo(0.5, 5);
  });

  it("mesure aussi la BlueGenji Survie à ses éliminations", () => {
    const ratio = computeRunningRatio({
      format: "BG_SURVIE",
      matches: matches(["COMPLETED"]),
      enduranceStandings: [
        { status: "ACTIVE" },
        { status: "ELIMINATED" },
        { status: "ELIMINATED" },
      ],
    });

    expect(ratio).toBe(1);
  });

  it("ne renvoie rien pour une survie à un seul engagé", () => {
    expect(
      computeRunningRatio({
        format: "SURVIVAL",
        matches: [],
        survivalStandings: [{ status: "ACTIVE" }],
      }),
    ).toBeNull();
  });

  it("compte les phases réglées, affinées par la phase en cours", () => {
    const ratio = computeRunningRatio({
      format: "MULTI",
      phases: [
        phase({ id: 10, state: "FINISHED" }),
        phase({ id: 11, state: "RUNNING" }),
        phase({ id: 12, state: "PENDING" }),
      ],
      currentPhaseId: 11,
      matches: [
        ...matches(["COMPLETED", "COMPLETED"], { phaseId: 10 }),
        ...matches(["COMPLETED", "PENDING", "PENDING", "PENDING"], { phaseId: 11 }),
      ],
    });

    // Une phase close + un quart de la suivante, sur trois.
    expect(ratio).toBeCloseTo(1.25 / 3, 5);
  });

  it("compte une phase sautée comme franchie", () => {
    const ratio = computeRunningRatio({
      format: "MULTI",
      phases: [phase({ id: 10, state: "SKIPPED" }), phase({ id: 11, state: "PENDING" })],
      currentPhaseId: null,
      matches: [],
    });

    expect(ratio).toBe(0.5);
  });

  it("ne renvoie rien pour un multi-phases sans plan", () => {
    expect(
      computeRunningRatio({ format: "MULTI", phases: [], matches: matches(["COMPLETED"]) }),
    ).toBeNull();
  });
});

describe("formatStageCountdown", () => {
  const now = at(VISIBLE_AT);

  it("s'arrête à deux unités", () => {
    expect(formatStageCountdown(now, now + 3 * DAY + 4 * 3600_000 + 12 * 60_000)).toBe(
      "dans 3 j 4 h",
    );
  });

  it("omet l'unité nulle", () => {
    expect(formatStageCountdown(now, now + 3 * DAY)).toBe("dans 3 j");
    expect(formatStageCountdown(now, now + 5 * 3600_000)).toBe("dans 5 h");
  });

  it("descend aux minutes sous l'heure", () => {
    expect(formatStageCountdown(now, now + 90 * 60_000)).toBe("dans 1 h 30 min");
    expect(formatStageCountdown(now, now + 7 * 60_000)).toBe("dans 7 min");
  });

  it("annonce l'imminence plutôt qu'un « dans 0 min »", () => {
    expect(formatStageCountdown(now, now + 20_000)).toBe("dans moins d'une minute");
  });

  it("se tait sur un jalon déjà passé", () => {
    expect(formatStageCountdown(now, now)).toBeNull();
    expect(formatStageCountdown(now, now - DAY)).toBeNull();
    expect(formatStageCountdown(now, Number.NaN)).toBeNull();
  });
});
