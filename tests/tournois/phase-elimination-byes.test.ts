import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

// Régression : en double élimination, un match d'exemption n'a pas de perdant.
// Le match de lower qu'il alimentait se retrouve avec une seule équipe et plus
// aucun feeder à attendre — il doit être résolu en bye, sans quoi le plateau
// reste bloqué sur des matchs PENDING et la phase n'est jamais complète.
// Le reste du moteur résout les byes sur `phase_id = 0` : en MULTI, seule la
// réconciliation de phase peut le faire sur la bonne phase.
const tryAutoResolveByes = jest.fn<
  (conn: PoolConnection, tournamentId: number, phaseId?: number) => Promise<void>
>();

jest.mock("@/lib/server/tournaments/byes", () => ({
  tryAutoResolveByes: (...args: unknown[]) =>
    (tryAutoResolveByes as unknown as (...a: unknown[]) => Promise<void>)(...args),
}));

import { reconcilePhases } from "@/lib/server/tournaments/phases";

const TOURNAMENT_ID = 42;
const PHASE_ID = 7;

/**
 * Connexion factice : le strict nécessaire pour amener `reconcilePhases`
 * jusqu'au test de complétude d'une phase à élimination.
 */
function fakeConnection(options: { phaseFormat: "SINGLE" | "DOUBLE" | "SWISS"; phaseState?: string }) {
  const order: string[] = [];

  const phaseRow = {
    id: PHASE_ID,
    tournament_id: TOURNAMENT_ID,
    position: 2,
    name: null,
    format: options.phaseFormat,
    qualifier_mode: "COUNT",
    qualifier_value: 1,
    has_third_place_match: 0,
    swiss_total_rounds: null,
    survival_rounds_before_first_cut: null,
    survival_rounds_per_cut: null,
    survival_current_round: 0,
    survival_barrage_rounds: 0,
    state: options.phaseState ?? "RUNNING",
    entrants: 10,
    qualifiers: 1,
    max_rounds: null,
    bracket_size: 16,
    started_at: new Date(),
    finished_at: null,
    created_at: new Date(),
  };

  const conn = {
    execute: async (sql: string) => {
      if (sql.includes("SELECT format, state FROM bg_tournaments")) {
        return [[{ format: "MULTI", state: "RUNNING" }], []];
      }
      if (sql.includes("FROM bg_tournament_phases") && sql.includes("WHERE tournament_id = ?")) {
        return [[phaseRow], []];
      }
      if (sql.includes("FROM bg_tournament_phases")) {
        return [[phaseRow], []];
      }
      if (sql.includes("FROM bg_tournaments")) {
        return [
          [{ id: TOURNAMENT_ID, format: "MULTI", state: "RUNNING", current_phase_id: PHASE_ID }],
          [],
        ];
      }
      if (sql.includes("COUNT(*) AS c FROM bg_matches")) {
        // Une phase incomplète : la réconciliation s'arrête juste après le
        // test de complétude, ce qui suffit à observer l'ordre des appels.
        order.push("isEliminationPhaseComplete");
        return [[{ c: 0 }], []];
      }
      return [[], []];
    },
  } as unknown as PoolConnection;

  return { conn, order };
}

describe("reconcilePhases — byes d'une phase à élimination", () => {
  beforeEach(() => {
    tryAutoResolveByes.mockReset();
    tryAutoResolveByes.mockResolvedValue(undefined);
  });

  it("résout les byes sur la phase courante avant d'évaluer sa complétude", async () => {
    const { conn, order } = fakeConnection({ phaseFormat: "DOUBLE" });
    tryAutoResolveByes.mockImplementation(async () => {
      order.push("tryAutoResolveByes");
    });

    await reconcilePhases(TOURNAMENT_ID, conn);

    expect(tryAutoResolveByes).toHaveBeenCalledWith(conn, TOURNAMENT_ID, PHASE_ID);
    expect(order).toEqual(["tryAutoResolveByes", "isEliminationPhaseComplete"]);
  });

  it("vaut aussi pour une phase à élimination simple", async () => {
    const { conn } = fakeConnection({ phaseFormat: "SINGLE" });

    await reconcilePhases(TOURNAMENT_ID, conn);

    expect(tryAutoResolveByes).toHaveBeenCalledWith(conn, TOURNAMENT_ID, PHASE_ID);
  });

  it("ne touche pas aux byes d'une phase qui n'est pas un plateau", async () => {
    const { conn } = fakeConnection({ phaseFormat: "SWISS" });

    await reconcilePhases(TOURNAMENT_ID, conn);

    expect(tryAutoResolveByes).not.toHaveBeenCalled();
  });

  it("ne fait rien tant que la phase courante n'est pas lancée", async () => {
    const { conn } = fakeConnection({ phaseFormat: "DOUBLE", phaseState: "PENDING" });

    await reconcilePhases(TOURNAMENT_ID, conn);

    expect(tryAutoResolveByes).not.toHaveBeenCalled();
  });
});
