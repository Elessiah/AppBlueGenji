import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/repository");

import {
  liftEndurancePenalty,
  loadEnduranceMeta,
  reconcileEndurance,
} from "@/lib/server/tournaments/bg-survie";
import type { PoolConnection } from "mysql2/promise";

/**
 * `bg_endurance_penalties` est l'une des trois tables dont `database.ts` avale
 * l'échec de création. Une base qui en manque doit continuer de jouer ses
 * tournois BG Survie : aucune sanction n'a pu y être posée, la lire vide est
 * exact — et un report de score en erreur pour une table de sanctions est
 * l'inverse du contrat.
 */

function mysqlError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

const TOURNAMENT = {
  format: "BG_SURVIE",
  state: "RUNNING",
  match_format_type: "FT",
  match_format_value: 3,
  endurance_start_points: 9,
  endurance_win_delta: 1,
  endurance_loss_delta: 1,
  endurance_playoff_size: 8,
  endurance_max_rounds: null,
  endurance_current_round: 1,
  endurance_playoffs_started: 0,
  has_third_place_match: 0,
};

const STANDINGS = [
  {
    team_id: 1,
    team_name: "Alpha",
    logo_url: null,
    seed: 1,
    points: 9,
    wins: 0,
    losses: 0,
    draws: 0,
    status: "ACTIVE",
    eliminated_round: null,
    rank: 1,
  },
  {
    team_id: 2,
    team_name: "Bravo",
    logo_url: null,
    seed: 2,
    points: 9,
    wins: 0,
    losses: 0,
    draws: 0,
    status: "ACTIVE",
    eliminated_round: null,
    rank: 2,
  },
];

/** Connexion factice dont la table des sanctions n'existe pas (ou lève `failure`). */
function makeConn(failure = "ER_NO_SUCH_TABLE") {
  const calls: string[] = [];
  const execute = jest.fn(async (sql: unknown) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    calls.push(q);
    if (q.includes("bg_endurance_penalties")) throw mysqlError(failure);
    if (q.includes("FROM bg_tournaments")) return [[TOURNAMENT], []];
    if (q.includes("MAX(round_number) AS last_round")) return [[{ last_round: 1 }], []];
    if (q.includes("FROM bg_endurance_standings")) return [STANDINGS, []];
    return [[], []];
  });
  return { conn: { execute } as never as PoolConnection, calls };
}

describe("BG Survie sans table de sanctions", () => {
  it("réconcilie le tournoi comme s'il n'y avait aucune sanction", async () => {
    const { conn, calls } = makeConn();
    await expect(reconcileEndurance(7, conn)).resolves.toBeUndefined();
    // Le classement est bien réécrit : la lecture des sanctions n'a rien arrêté.
    expect(calls.some((q) => q.startsWith("INSERT INTO bg_endurance_standings"))).toBe(true);
  });

  it("affiche le classement avec un journal des sanctions vide", async () => {
    const { conn } = makeConn();
    const meta = await loadEnduranceMeta(conn, 7);

    expect(meta?.penalties).toEqual([]);
    expect(meta?.standings.map((s) => s.teamId)).toEqual([1, 2]);
    expect(meta?.standings.every((s) => s.penaltyPoints === 0)).toBe(true);
  });

  it("répond « sanction introuvable » au retrait, jamais une panne", async () => {
    const { conn, calls } = makeConn();
    await expect(liftEndurancePenalty(7, 15, conn)).rejects.toThrow("PENALTY_NOT_FOUND");
    expect(calls.some((q) => q.startsWith("DELETE FROM bg_endurance_penalties"))).toBe(false);
  });

  it("laisse remonter toute autre erreur de la table", async () => {
    // Un interblocage a déjà défait la transaction : poursuivre commiterait
    // un classement sur une écriture qui n'existe plus.
    const { conn } = makeConn("ER_LOCK_DEADLOCK");
    await expect(reconcileEndurance(7, conn)).rejects.toThrow("ER_LOCK_DEADLOCK");
    await expect(loadEnduranceMeta(conn, 7)).rejects.toThrow("ER_LOCK_DEADLOCK");
    await expect(liftEndurancePenalty(7, 15, conn)).rejects.toThrow("ER_LOCK_DEADLOCK");
  });
});
