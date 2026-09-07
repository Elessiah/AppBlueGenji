import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/repository");

import {
  pairingsAreStale,
  planNextPlayoffRound,
  planPlayoffFallbackRound,
  planPlayoffFirstRound,
  playoffRoundIsStale,
  DEFAULT_ENDURANCE_CONFIG,
} from "@/lib/shared/bg-survie";
import { reconcileEndurance } from "@/lib/server/tournaments/bg-survie";
import { createMatch } from "@/lib/server/tournaments/repository";

/**
 * **Édition d'un tour amont de l'arbre final** (BlueGenji Survie).
 *
 * `finalizePlayoffsIfDone` ne savait que **poser** le tour suivant : une fois
 * les demi-finales créées, corriger le vainqueur d'un quart de finale n'en
 * changeait plus les participantes — le tour existait déjà, et plus rien ne le
 * relisait. Deux équipes s'y retrouvaient annoncées alors que l'une venait de
 * perdre son quart.
 *
 * La réparation est le pendant exact de `roundPairingsAreStale` en
 * qualification : le premier tour se relit sur le classement, les suivants sur
 * les vainqueurs du tour amont, et un tour périmé est réécrit — jamais un tour
 * déjà entamé.
 */

// ---------------------------------------------------------------------------
// Logique pure
// ---------------------------------------------------------------------------

describe("planPlayoffFallbackRound", () => {
  it("apparie haut contre bas", () => {
    expect(planPlayoffFallbackRound([1, 2, 3, 4])).toEqual([
      { teamAId: 1, teamBId: 4 },
      { teamAId: 2, teamBId: 3 },
    ]);
  });

  it("fait passer le tour à la mieux classée restante sur un effectif impair", () => {
    expect(planPlayoffFallbackRound([1, 2, 3])).toEqual([
      { teamAId: 1, teamBId: 3 },
      { teamAId: 2, teamBId: null },
    ]);
  });

  it("ne pose aucune rencontre pour une seule qualifiée", () => {
    expect(planPlayoffFallbackRound([7])).toEqual([{ teamAId: 7, teamBId: null }]);
  });
});

describe("planPlayoffFirstRound", () => {
  it("applique le tableau imposé 8v4, 6v2, 1v5, 3v7 à huit qualifiées", () => {
    const plan = planPlayoffFirstRound([10, 20, 30, 40, 50, 60, 70, 80], DEFAULT_ENDURANCE_CONFIG);

    expect(plan.map((entry) => entry.bracket)).toEqual(["UPPER", "UPPER", "UPPER", "UPPER"]);
    expect(plan.map((entry) => entry.pairing)).toEqual([
      { teamAId: 80, teamBId: 40 },
      { teamAId: 60, teamBId: 20 },
      { teamAId: 10, teamBId: 50 },
      { teamAId: 30, teamBId: 70 },
    ]);
  });

  it("retombe sur un appariement haut contre bas hors de l'effectif prévu", () => {
    const plan = planPlayoffFirstRound([1, 2, 3, 4, 5, 6], DEFAULT_ENDURANCE_CONFIG);

    expect(plan.map((entry) => entry.pairing)).toEqual([
      { teamAId: 1, teamBId: 6 },
      { teamAId: 2, teamBId: 5 },
      { teamAId: 3, teamBId: 4 },
    ]);
  });

  it("n'applique pas le tableau imposé quand le plateau n'est pas de huit", () => {
    // Quatre qualifiées **et** un plateau réglé sur quatre : l'effectif est bien
    // celui voulu, mais le tableau du règlement ne décrit que huit équipes.
    const plan = planPlayoffFirstRound([1, 2, 3, 4], {
      ...DEFAULT_ENDURANCE_CONFIG,
      playoffSize: 4,
    });

    expect(plan.map((entry) => entry.pairing)).toEqual([
      { teamAId: 1, teamBId: 4 },
      { teamAId: 2, teamBId: 3 },
    ]);
  });
});

describe("planNextPlayoffRound", () => {
  const decisive = (pairs: [number, number][]) =>
    pairs.map(([winnerTeamId, loserTeamId]) => ({ winnerTeamId, loserTeamId }));

  it("apparie les vainqueurs deux à deux dans l'ordre du tour", () => {
    const plan = planNextPlayoffRound(
      decisive([
        [8, 4],
        [6, 2],
        [1, 5],
        [3, 7],
      ]),
    );

    expect(plan).toEqual([
      { bracket: "UPPER", pairing: { teamAId: 8, teamBId: 6 } },
      { bracket: "UPPER", pairing: { teamAId: 1, teamBId: 3 } },
    ]);
  });

  it("ajoute la petite finale aux demi-finales", () => {
    const plan = planNextPlayoffRound(
      decisive([
        [8, 6],
        [1, 3],
      ]),
    );

    expect(plan).toEqual([
      { bracket: "UPPER", pairing: { teamAId: 8, teamBId: 1 } },
      { bracket: "THIRD_PLACE", pairing: { teamAId: 6, teamBId: 3 } },
    ]);
  });

  it("fait passer le tour au dernier vainqueur d'un nombre impair", () => {
    const plan = planNextPlayoffRound(
      decisive([
        [1, 6],
        [2, 5],
        [3, 4],
      ]),
    );

    expect(plan).toEqual([
      { bracket: "UPPER", pairing: { teamAId: 1, teamBId: 2 } },
      { bracket: "UPPER", pairing: { teamAId: 3, teamBId: null } },
    ]);
  });

  it("ne planifie rien après une finale", () => {
    expect(planNextPlayoffRound(decisive([[1, 2]]))).toEqual([]);
  });

  it("ne planifie rien tant qu'un vainqueur manque", () => {
    expect(
      planNextPlayoffRound([
        { winnerTeamId: 1, loserTeamId: 2 },
        { winnerTeamId: null, loserTeamId: null },
      ]),
    ).toEqual([]);
  });

  it("se passe de petite finale quand un perdant manque", () => {
    // Une demi-finale gagnée sur bye n'a pas de perdante : plutôt qu'une petite
    // finale à une engagée, il n'y en a pas.
    const plan = planNextPlayoffRound([
      { winnerTeamId: 1, loserTeamId: null },
      { winnerTeamId: 2, loserTeamId: 3 },
    ]);

    expect(plan).toEqual([{ bracket: "UPPER", pairing: { teamAId: 1, teamBId: 2 } }]);
  });
});

describe("pairingsAreStale", () => {
  it("ne juge rien quand aucune rencontre n'est posée", () => {
    expect(pairingsAreStale([{ teamAId: 1, teamBId: 2 }], [])).toBe(false);
  });

  it("repère un effectif différent", () => {
    expect(
      pairingsAreStale([{ teamAId: 1, teamBId: 2 }], [
        { teamAId: 1, teamBId: 2 },
        { teamAId: 3, teamBId: 4 },
      ]),
    ).toBe(true);
  });

  it("repère un side inversé", () => {
    expect(pairingsAreStale([{ teamAId: 1, teamBId: 2 }], [{ teamAId: 2, teamBId: 1 }])).toBe(true);
  });

  it("accepte un tirage identique", () => {
    expect(
      pairingsAreStale([{ teamAId: 1, teamBId: null }], [{ teamAId: 1, teamBId: null }]),
    ).toBe(false);
  });
});

describe("playoffRoundIsStale", () => {
  const plan = planNextPlayoffRound([
    { winnerTeamId: 8, loserTeamId: 6 },
    { winnerTeamId: 1, loserTeamId: 3 },
  ]);

  it("accepte un tour conforme", () => {
    expect(
      playoffRoundIsStale(plan, [
        { bracket: "UPPER", teamAId: 8, teamBId: 1 },
        { bracket: "THIRD_PLACE", teamAId: 6, teamBId: 3 },
      ]),
    ).toBe(false);
  });

  it("repère une engagée périmée", () => {
    expect(
      playoffRoundIsStale(plan, [
        { bracket: "UPPER", teamAId: 8, teamBId: 5 },
        { bracket: "THIRD_PLACE", teamAId: 6, teamBId: 3 },
      ]),
    ).toBe(true);
  });

  it("repère une petite finale posée à la place d'une finale", () => {
    // Mêmes équipes, mais pas la même rencontre : une petite finale ne décide
    // pas du titre.
    expect(
      playoffRoundIsStale(plan, [
        { bracket: "THIRD_PLACE", teamAId: 8, teamBId: 1 },
        { bracket: "UPPER", teamAId: 6, teamBId: 3 },
      ]),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const TOURNAMENT_ID = 5;

function tournamentRow(overrides: Row = {}): Row {
  return {
    format: "BG_SURVIE",
    state: "RUNNING",
    match_format_type: null,
    match_format_value: null,
    endurance_start_points: 9,
    endurance_win_delta: 1,
    endurance_loss_delta: 1,
    endurance_playoff_size: 8,
    endurance_max_rounds: null,
    endurance_current_round: 3,
    endurance_playoffs_started: 1,
    has_third_place_match: 0,
    ...overrides,
  };
}

function standingRow(teamId: number, rank: number): Row {
  return {
    team_id: teamId,
    seed: rank,
    points: 9,
    wins: 0,
    losses: 0,
    status: "ACTIVE",
    eliminated_round: null,
    rank,
  };
}

type PlayoffMatch = {
  id: number;
  bracket?: string;
  status?: string;
  teams: [number, number | null];
  winner?: number | null;
  loser?: number | null;
};

function matchRow(match: PlayoffMatch): Row {
  const played = match.winner !== undefined && match.winner !== null;
  return {
    id: match.id,
    bracket: match.bracket ?? "UPPER",
    status: match.status ?? (played ? "COMPLETED" : "READY"),
    team1_id: match.teams[0],
    team2_id: match.teams[1],
    team1_score: played ? 3 : null,
    team2_score: played ? 0 : null,
    winner_team_id: match.winner ?? null,
    loser_team_id: match.loser ?? null,
    forfeit_team_id: null,
    is_bye: match.teams[1] === null ? 1 : 0,
  };
}

/**
 * Connexion mockée qui répond **d'après la requête**, `rounds` décrivant l'arbre
 * final tel qu'il est posé en base (numéro de tour → rencontres).
 */
function makeConn(rounds: Record<number, PlayoffMatch[]>, standings: number[]) {
  const execute = jest.fn(async (sql: unknown, params?: unknown) => {
    const query = String(sql);
    const args = (params ?? []) as unknown[];

    if (query.includes("FROM bg_tournaments WHERE id = ?")) return [[tournamentRow()]];
    if (query.includes("status = 'FORFEIT'")) return [[]];
    if (query.includes("FROM bg_endurance_standings")) {
      return [[standings.map((teamId, index) => standingRow(teamId, index + 1))]][0];
    }
    if (query.includes("SELECT round_number, status")) return [[]];
    if (query.includes("SELECT DISTINCT round_number")) {
      return [Object.keys(rounds).map((round) => ({ round_number: Number(round) }))];
    }
    if (query.includes("SELECT id, bracket, status")) {
      return [(rounds[Number(args[1])] ?? []).map(matchRow)];
    }
    return [[]];
  });

  return { execute } as never as Parameters<typeof reconcileEndurance>[1] & {
    execute: jest.Mock;
  };
}

/** Appariements réécrits ou posés par ce `reconcileEndurance`. */
function writes(conn: { execute: jest.Mock }) {
  return conn.execute.mock.calls
    .filter(([sql]) => String(sql).includes("team1_id = ?, team2_id = ?, status = ?"))
    .map(([, params]) => params as unknown[]);
}

/** Les quarts de finale du tableau imposé, pour un classement 1..8. */
const QUARTERS: PlayoffMatch[] = [
  { id: 501, teams: [8, 4], winner: 8, loser: 4 },
  { id: 502, teams: [6, 2], winner: 6, loser: 2 },
  { id: 503, teams: [1, 5], winner: 1, loser: 5 },
  { id: 504, teams: [3, 7], winner: 3, loser: 7 },
];

const RANKING = [1, 2, 3, 4, 5, 6, 7, 8];

describe("reconcileEndurance — réparation de l'arbre final", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createMatch as jest.Mock).mockResolvedValue(900 as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("ne touche pas à un arbre conforme", async () => {
    const conn = makeConn(
      {
        1000: QUARTERS,
        1001: [
          { id: 601, teams: [8, 6] },
          { id: 602, teams: [1, 3] },
        ],
      },
      RANKING,
    );

    await reconcileEndurance(TOURNAMENT_ID, conn);

    expect(writes(conn)).toHaveLength(0);
    expect(createMatch).not.toHaveBeenCalled();
  });

  it("réécrit la demi-finale quand un quart change de vainqueur", async () => {
    // Le quart 8v4 a été rejugé en faveur de 4 : la demie annonçait encore 8.
    const conn = makeConn(
      {
        1000: [{ ...QUARTERS[0], winner: 4, loser: 8 }, ...QUARTERS.slice(1)],
        1001: [
          { id: 601, teams: [8, 6] },
          { id: 602, teams: [1, 3] },
        ],
      },
      RANKING,
    );

    await reconcileEndurance(TOURNAMENT_ID, conn);

    // Réécriture **sur place** : les identifiants de match sont des adresses
    // publiques, on ne les jette pas pour une correction de score.
    expect(createMatch).not.toHaveBeenCalled();
    expect(writes(conn).map((params) => [params[0], params[1], params[7]])).toEqual([
      [4, 6, 601],
      [1, 3, 602],
    ]);
  });

  it("remet la demi-finale réécrite à zéro", async () => {
    const conn = makeConn(
      {
        1000: [{ ...QUARTERS[0], winner: 4, loser: 8 }, ...QUARTERS.slice(1)],
        1001: [
          { id: 601, teams: [8, 6] },
          { id: 602, teams: [1, 3] },
        ],
      },
      RANKING,
    );

    await reconcileEndurance(TOURNAMENT_ID, conn);

    // [team1, team2, status, is_bye, score1, score2, vainqueur, id]
    expect(writes(conn)[0]).toEqual([4, 6, "READY", 0, null, null, null, 601]);
  });

  it("supprime les tours qui descendaient du tour réécrit", async () => {
    const conn = makeConn(
      {
        1000: [{ ...QUARTERS[0], winner: 4, loser: 8 }, ...QUARTERS.slice(1)],
        1001: [
          { id: 601, teams: [8, 6] },
          { id: 602, teams: [1, 3] },
        ],
      },
      RANKING,
    );

    await reconcileEndurance(TOURNAMENT_ID, conn);

    const deletion = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("DELETE FROM bg_matches WHERE tournament_id = ? AND round_number > ?"),
    );
    expect(deletion?.[1]).toEqual([TOURNAMENT_ID, 1001]);
  });

  it("n'efface les rappels que des rencontres dont l'engagée change", async () => {
    // Seule la première demie change d'engagée. Ses rappels partent (ils
    // nommaient 8, qui vient de perdre son quart) ; ceux de la seconde restent
    // — les réannoncer enverrait le même message privé à des joueurs dont rien
    // n'a bougé.
    const conn = makeConn(
      {
        1000: [{ ...QUARTERS[0], winner: 4, loser: 8 }, ...QUARTERS.slice(1)],
        1001: [
          { id: 601, teams: [8, 6] },
          { id: 602, teams: [1, 3] },
        ],
      },
      RANKING,
    );

    await reconcileEndurance(TOURNAMENT_ID, conn);

    const cleanup = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("DELETE FROM bg_match_reminders"),
    );
    expect(cleanup?.[1]).toEqual([601]);
  });

  it("n'efface aucun rappel quand le tour est refait à neuf", async () => {
    // Les anciennes rencontres sont supprimées : leurs rappels partent avec
    // elles (`ON DELETE CASCADE`), il n'y a rien à effacer à part.
    const conn = makeConn(
      { 1000: QUARTERS.map((match) => ({ ...match, winner: null, loser: null })) },
      [1, 2, 3, 4, 5, 6],
    );

    await reconcileEndurance(TOURNAMENT_ID, conn);

    expect(
      conn.execute.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM bg_match_reminders"),
      ),
    ).toBe(false);
  });

  it("réécrit la finale et la petite finale quand une demie change de vainqueur", async () => {
    const conn = makeConn(
      {
        1000: QUARTERS,
        1001: [
          { id: 601, teams: [8, 6], winner: 6, loser: 8 },
          { id: 602, teams: [1, 3], winner: 1, loser: 3 },
        ],
        1002: [
          { id: 701, teams: [8, 1] },
          { id: 702, bracket: "THIRD_PLACE", teams: [6, 3] },
        ],
      },
      RANKING,
    );

    await reconcileEndurance(TOURNAMENT_ID, conn);

    expect(writes(conn).map((params) => [params[0], params[1], params[7]])).toEqual([
      [6, 1, 701],
      [8, 3, 702],
    ]);
  });

  it("ne réécrit jamais un tour déjà entamé", async () => {
    // Cas de sûreté : `checkDownstreamMatchesHaveNoScores` refuse en amont, mais
    // un arbre périmé se corrige, un score attribué à une équipe qui n'a pas
    // joué ne se voit plus.
    const conn = makeConn(
      {
        1000: [{ ...QUARTERS[0], winner: 4, loser: 8 }, ...QUARTERS.slice(1)],
        1001: [
          { id: 601, teams: [8, 6], winner: 8, loser: 6 },
          { id: 602, teams: [1, 3] },
        ],
      },
      RANKING,
    );

    await reconcileEndurance(TOURNAMENT_ID, conn);

    expect(writes(conn)).toHaveLength(0);
    expect(
      conn.execute.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM bg_matches")),
    ).toBe(false);
  });

  it("réapparie le premier tour quand le classement de qualification a changé", async () => {
    // Une correction en manche qualificative a inversé les rangs 1 et 2 : le
    // tableau imposé ne désigne plus les mêmes rencontres. Les quarts n'ont pas
    // encore été joués — c'est la seule fenêtre où ils sont réécrivables, un
    // quart déjà saisi verrouillant la correction en amont.
    const conn = makeConn(
      { 1000: QUARTERS.map((match) => ({ ...match, winner: null, loser: null })) },
      [2, 1, 3, 4, 5, 6, 7, 8],
    );

    await reconcileEndurance(TOURNAMENT_ID, conn);

    expect(writes(conn).map((params) => [params[0], params[1], params[7]])).toEqual([
      [8, 4, 501],
      [6, 1, 502],
      [2, 5, 503],
      [3, 7, 504],
    ]);
  });

  it("refait le tour à neuf quand le plan n'a plus la même forme", async () => {
    // Le classement ne compte plus que six qualifiées : trois rencontres au lieu
    // de quatre, aucune ne se réutilise poste pour poste.
    const conn = makeConn(
      { 1000: QUARTERS.map((match) => ({ ...match, winner: null, loser: null })) },
      [1, 2, 3, 4, 5, 6],
    );

    await reconcileEndurance(TOURNAMENT_ID, conn);

    expect(
      conn.execute.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM bg_matches WHERE tournament_id = ? AND round_number = ?"),
      ),
    ).toBe(true);
    expect(createMatch).toHaveBeenCalledTimes(3);
    expect(writes(conn).map((params) => [params[0], params[1]])).toEqual([
      [1, 6],
      [2, 5],
      [3, 4],
    ]);
  });
});
