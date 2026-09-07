import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/repository");

import {
  applyEndurancePenalty,
  liftEndurancePenalty,
  loadEnduranceMeta,
} from "@/lib/server/tournaments/bg-survie";
import type { PoolConnection } from "mysql2/promise";

type Row = Record<string, unknown>;

function tournamentRow(overrides: Row = {}): Row {
  return {
    format: "BG_SURVIE",
    state: "RUNNING",
    match_format_type: "FT",
    match_format_value: 3,
    endurance_start_points: 9,
    endurance_win_delta: 1,
    endurance_loss_delta: 1,
    endurance_playoff_size: 8,
    endurance_max_rounds: null,
    endurance_current_round: 2,
    endurance_playoffs_started: 0,
    has_third_place_match: 0,
    ...overrides,
  };
}

/**
 * Connexion factice pilotée **par le SQL** et non par une file positionnelle :
 * la sanction déclenche une réconciliation complète derrière elle, dont le
 * nombre de requêtes n'a pas à être compté par ces cas.
 */
function makeConn(options: {
  tournament?: Row | null;
  standingStatus?: string | null;
  penalties?: Row[];
} = {}) {
  const calls: [string, unknown[]][] = [];

  const execute = jest.fn(async (sql: unknown, params: unknown) => {
    const query = String(sql).replace(/\s+/g, " ").trim();
    calls.push([query, (params as unknown[]) ?? []]);

    if (query.includes("FROM bg_tournaments")) {
      const row = options.tournament === undefined ? tournamentRow() : options.tournament;
      return [row === null ? [] : [row], []];
    }
    if (query.startsWith("SELECT team_id, points FROM bg_endurance_penalties")) {
      return [options.penalties ?? [], []];
    }
    if (query.includes("FROM bg_endurance_penalties")) return [[], []];
    if (query.includes("SELECT status FROM bg_endurance_standings")) {
      const status = options.standingStatus === undefined ? "ACTIVE" : options.standingStatus;
      return [status === null ? [] : [{ status }], []];
    }
    // Réconciliation : classement vide, elle sort aussitôt.
    return [[], []];
  });

  const conn = { execute } as never as PoolConnection;
  return { conn, calls, execute };
}

function inserted(calls: [string, unknown[]][]): [string, unknown[]] | undefined {
  return calls.find(([query]) => query.startsWith("INSERT INTO bg_endurance_penalties"));
}

describe("applyEndurancePenalty", () => {
  beforeEach(() => jest.clearAllMocks());

  it("écrit la sanction sur la manche courante, motif normalisé et auteur inclus", async () => {
    const { conn, calls } = makeConn();
    await applyEndurancePenalty(7, 42, 3, "  Retard   au coup d'envoi  ", 9, conn);

    const insert = inserted(calls);
    expect(insert).toBeDefined();
    expect(insert?.[1]).toEqual([7, 42, 2, 3, "Retard au coup d'envoi", 9]);
  });

  it("porte une sanction d'avant la première manche sur la manche 1", async () => {
    // Le rejeu ne connaît pas de manche 0, et la sanction doit peser dès le
    // premier appariement.
    const { conn, calls } = makeConn({
      tournament: tournamentRow({ endurance_current_round: 0 }),
    });
    await applyEndurancePenalty(7, 42, 2, "Forfait d'échauffement", 9, conn);

    expect(inserted(calls)?.[1][2]).toBe(1);
  });

  it("accepte un auteur inconnu (null) sans rien changer d'autre", async () => {
    const { conn, calls } = makeConn();
    await applyEndurancePenalty(7, 42, 1, "Motif", null, conn);

    expect(inserted(calls)?.[1][5]).toBeNull();
  });

  it("refuse un tournoi d'un autre format", async () => {
    const { conn, calls } = makeConn({ tournament: tournamentRow({ format: "SWISS" }) });
    await expect(applyEndurancePenalty(7, 42, 3, "Motif", 9, conn)).rejects.toThrow(
      "NOT_BG_SURVIE",
    );
    expect(inserted(calls)).toBeUndefined();
  });

  it("refuse un tournoi introuvable", async () => {
    const { conn } = makeConn({ tournament: null });
    await expect(applyEndurancePenalty(7, 42, 3, "Motif", 9, conn)).rejects.toThrow(
      "NOT_BG_SURVIE",
    );
  });

  it("refuse une sanction une fois les play-offs lancés", async () => {
    const { conn, calls } = makeConn({
      tournament: tournamentRow({ endurance_playoffs_started: 1 }),
    });
    await expect(applyEndurancePenalty(7, 42, 3, "Motif", 9, conn)).rejects.toThrow(
      "ENDURANCE_PLAYOFFS_STARTED",
    );
    expect(inserted(calls)).toBeUndefined();
  });

  it("refuse une sanction mal formée avant même de lire le classement", async () => {
    const { conn, calls } = makeConn();
    await expect(applyEndurancePenalty(7, 42, 0, "Motif", 9, conn)).rejects.toThrow(
      "INVALID_PENALTY",
    );
    await expect(applyEndurancePenalty(7, 42, 3, "   ", 9, conn)).rejects.toThrow(
      "INVALID_PENALTY",
    );
    expect(inserted(calls)).toBeUndefined();
  });

  it("refuse un engagé absent du tournoi", async () => {
    const { conn } = makeConn({ standingStatus: null });
    await expect(applyEndurancePenalty(7, 42, 3, "Motif", 9, conn)).rejects.toThrow(
      "TEAM_NOT_IN_TOURNAMENT",
    );
  });

  it("refuse un engagé qui n'est plus en lice", async () => {
    for (const status of ["ELIMINATED", "OUT_OF_CONTENTION", "FORFEIT"]) {
      const { conn, calls } = makeConn({ standingStatus: status });
      await expect(applyEndurancePenalty(7, 42, 3, "Motif", 9, conn)).rejects.toThrow(
        "TEAM_ALREADY_OUT",
      );
      expect(inserted(calls)).toBeUndefined();
    }
  });
});

describe("liftEndurancePenalty", () => {
  beforeEach(() => jest.clearAllMocks());

  it("efface la ligne et rend l'engagé et le montant à l'appelant", async () => {
    // Le journal Discord se rédige après le commit, quand la ligne n'existe
    // plus : c'est ici qu'elle doit être relue.
    const { conn, calls } = makeConn({ penalties: [{ team_id: 42, points: 3 }] });
    const lifted = await liftEndurancePenalty(7, 15, conn);

    expect(lifted).toEqual({ teamId: 42, points: 3 });
    const del = calls.find(([query]) => query.startsWith("DELETE FROM bg_endurance_penalties"));
    expect(del?.[1]).toEqual([15, 7]);
  });

  it("relit la sanction par son tournoi, jamais par son seul identifiant", async () => {
    const { conn, calls } = makeConn({ penalties: [{ team_id: 42, points: 3 }] });
    await liftEndurancePenalty(7, 15, conn);

    const select = calls.find(([query]) =>
      query.startsWith("SELECT team_id, points FROM bg_endurance_penalties"),
    );
    expect(select?.[1]).toEqual([15, 7]);
  });

  it("refuse une sanction introuvable", async () => {
    const { conn, calls } = makeConn({ penalties: [] });
    await expect(liftEndurancePenalty(7, 15, conn)).rejects.toThrow("PENALTY_NOT_FOUND");
    expect(
      calls.find(([query]) => query.startsWith("DELETE FROM bg_endurance_penalties")),
    ).toBeUndefined();
  });

  it("refuse le retrait une fois les play-offs lancés", async () => {
    // Rendre ses points ramènerait une équipe « en lice » alors que l'arbre est
    // déjà tiré sans elle.
    const { conn, calls } = makeConn({
      tournament: tournamentRow({ endurance_playoffs_started: 1 }),
      penalties: [{ team_id: 42, points: 3 }],
    });
    await expect(liftEndurancePenalty(7, 15, conn)).rejects.toThrow(
      "ENDURANCE_PLAYOFFS_STARTED",
    );
    expect(
      calls.find(([query]) => query.startsWith("DELETE FROM bg_endurance_penalties")),
    ).toBeUndefined();
  });

  it("refuse un tournoi d'un autre format", async () => {
    const { conn } = makeConn({ tournament: tournamentRow({ format: "SURVIVAL" }) });
    await expect(liftEndurancePenalty(7, 15, conn)).rejects.toThrow("NOT_BG_SURVIE");
  });
});

describe("loadEnduranceMeta — pénalités", () => {
  beforeEach(() => jest.clearAllMocks());

  /** Connexion factice : un classement à deux équipes, une sanction sur la seconde. */
  function metaConnection(): PoolConnection {
    const execute = async (sql: unknown) => {
      const q = String(sql).replace(/\s+/g, " ").trim();

      if (q.includes("FROM bg_tournaments")) return [[tournamentRow()], []];

      if (q.includes("FROM bg_endurance_penalties")) {
        return [
          [
            {
              id: 15,
              team_id: 2,
              team_name: "Bravo",
              round_number: 1,
              points: 3,
              reason: "Retard au coup d'envoi",
              author_pseudo: "Arbitre",
              created_at: "2026-09-07T10:00:00.000Z",
            },
          ],
          [],
        ];
      }

      if (q.includes("FROM bg_endurance_standings")) {
        return [
          [
            {
              team_id: 1,
              team_name: "Alpha",
              logo_url: null,
              seed: 1,
              points: 9,
              wins: 0,
              losses: 0,
              status: "ACTIVE",
              eliminated_round: null,
              rank: 1,
            },
            {
              team_id: 2,
              team_name: "Bravo",
              logo_url: null,
              seed: 2,
              points: 6,
              wins: 0,
              losses: 0,
              status: "ACTIVE",
              eliminated_round: null,
              rank: 2,
            },
          ],
          [],
        ];
      }

      return [[], []];
    };

    return { execute } as never as PoolConnection;
  }

  it("expose les sanctions avec leur motif et leur auteur", async () => {
    const meta = await loadEnduranceMeta(metaConnection(), 7);

    expect(meta?.penalties).toEqual([
      {
        id: 15,
        teamId: 2,
        teamName: "Bravo",
        round: 1,
        points: 3,
        reason: "Retard au coup d'envoi",
        authorPseudo: "Arbitre",
        createdAt: "2026-09-07T10:00:00.000Z",
      },
    ]);
  });

  it("porte le cumul sur la ligne de l'engagé sanctionné, et zéro ailleurs", async () => {
    const meta = await loadEnduranceMeta(metaConnection(), 7);

    expect(meta?.standings.find((s) => s.teamId === 2)?.penaltyPoints).toBe(3);
    expect(meta?.standings.find((s) => s.teamId === 1)?.penaltyPoints).toBe(0);
  });

  it("marque la case de la manche sanctionnée dans le tableau manche par manche", async () => {
    const meta = await loadEnduranceMeta(metaConnection(), 7);
    const cells = meta?.standings.find((s) => s.teamId === 2)?.rounds ?? [];

    expect(cells[0]).toMatchObject({ round: 1, penalty: 3 });
  });
});
