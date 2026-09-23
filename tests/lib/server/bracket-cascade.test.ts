import { describe, expect, it } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";
import { detachDownstreamOutcome } from "@/lib/server/tournaments/bracket-cascade";

/**
 * Effets en cascade d'une correction dans un tableau à élimination : ce que
 * l'ancien résultat avait fait descendre (une équipe, ou une exemption close
 * d'office faute d'équipe) doit être défait avant que le nouveau ne soit
 * propagé.
 *
 * Le plateau est tenu en mémoire ; le faux ne comprend que les trois
 * instructions que le module écrit.
 */
type Row = {
  id: number;
  status: string;
  is_bye: number;
  team1_id: number | null;
  team2_id: number | null;
  team1_score: number | null;
  team2_score: number | null;
  winner_team_id: number | null;
  loser_team_id: number | null;
  forfeit_team_id: number | null;
  double_forfeit: number;
  team1_reported_at: Date | null;
  team2_reported_at: Date | null;
  next_winner_match_id: number | null;
  next_winner_slot: number | null;
  next_loser_match_id: number | null;
  next_loser_slot: number | null;
  live_started_at: string | null;
};

function row(overrides: Partial<Row> & { id: number }): Row {
  return {
    status: "PENDING",
    is_bye: 0,
    team1_id: null,
    team2_id: null,
    team1_score: null,
    team2_score: null,
    winner_team_id: null,
    loser_team_id: null,
    forfeit_team_id: null,
    double_forfeit: 0,
    team1_reported_at: null,
    team2_reported_at: null,
    next_winner_match_id: null,
    next_winner_slot: null,
    next_loser_match_id: null,
    next_loser_slot: null,
    live_started_at: null,
    ...overrides,
  };
}

function board(rows: Row[]): { conn: PoolConnection; get: (id: number) => Row } {
  const table = new Map(rows.map((r) => [r.id, { ...r }]));

  const conn = {
    execute: async (sql: string, params: unknown[]) => {
      const q = sql.replace(/\s+/g, " ").trim();
      const id = Number(params[params.length - 1]);
      const target = table.get(id);

      if (q.startsWith("SELECT")) return [target ? [{ ...target }] : [], []];
      if (!target) return [{ affectedRows: 0 }, []];

      if (q.includes("SET team1_score = NULL")) {
        Object.assign(target, {
          team1_score: null,
          team2_score: null,
          winner_team_id: null,
          loser_team_id: null,
          forfeit_team_id: null,
          double_forfeit: 0,
        });
      } else if (q.startsWith("UPDATE bg_matches SET team1_id = NULL")) {
        target.team1_id = null;
        target.status = String(params[0]);
        if (q.includes("live_started_at = NULL")) target.live_started_at = null;
      } else if (q.startsWith("UPDATE bg_matches SET team2_id = NULL")) {
        target.team2_id = null;
        target.status = String(params[0]);
        if (q.includes("live_started_at = NULL")) target.live_started_at = null;
      } else {
        throw new Error(`Instruction inattendue : ${q}`);
      }
      return [{ affectedRows: 1 }, []];
    },
  } as unknown as PoolConnection;

  return { conn, get: (matchId) => table.get(matchId)! };
}

const links = (winnerTarget: number | null, slot: number | null = 1) => ({
  next_winner_match_id: winnerTarget,
  next_winner_slot: slot,
  next_loser_match_id: null,
  next_loser_slot: null,
});

describe("detachDownstreamOutcome — double forfait corrigé en résultat", () => {
  // A (id 1) était un double forfait : M (id 2) a été close d'office en
  // exemption pour X (10), qui a été posée en demi-finale N (id 3).
  function afterDoubleForfeit() {
    return board([
      row({
        id: 2,
        status: "COMPLETED",
        team1_id: null,
        team2_id: 10,
        team1_score: 0,
        team2_score: 1,
        winner_team_id: 10,
        next_winner_match_id: 3,
        next_winner_slot: 1,
      }),
      row({ id: 3, status: "PENDING", team1_id: 10, team2_id: null, live_started_at: "2026-09-23" }),
    ]);
  }

  it("rouvre l'exemption et fait redescendre son bénéficiaire", async () => {
    const { conn, get } = afterDoubleForfeit();

    await detachDownstreamOutcome(conn, links(2, 1), { winnerTeamId: 7, loserTeamId: 8 });

    expect(get(2)).toMatchObject({
      status: "PENDING",
      team1_id: null,
      team2_id: 10,
      winner_team_id: null,
      team1_score: null,
      team2_score: null,
    });
    // X n'a plus rien gagné : son créneau en demi-finale est vidé, et l'antenne
    // ouverte sur l'ancienne affiche est refermée.
    expect(get(3)).toMatchObject({ team1_id: null, status: "PENDING", live_started_at: null });
  });

  it("défait une chaîne de deux exemptions (match fantôme puis exemption)", async () => {
    // Deux doubles forfaits voisins : M (2) est un match fantôme clos 0-0, et
    // N (3), privée d'un camp, a été close en exemption pour Y (20), montée en
    // finale F (4).
    const { conn, get } = board([
      row({
        id: 2,
        status: "COMPLETED",
        team1_score: 0,
        team2_score: 0,
        next_winner_match_id: 3,
        next_winner_slot: 1,
      }),
      row({
        id: 3,
        status: "COMPLETED",
        team1_id: null,
        team2_id: 20,
        team1_score: 0,
        team2_score: 1,
        winner_team_id: 20,
        next_winner_match_id: 4,
        next_winner_slot: 2,
      }),
      row({ id: 4, status: "PENDING", team1_id: 30, team2_id: 20 }),
    ]);

    await detachDownstreamOutcome(conn, links(2, 1), { winnerTeamId: 7, loserTeamId: 8 });

    expect(get(2)).toMatchObject({ status: "PENDING", team1_score: null, team2_score: null });
    expect(get(3)).toMatchObject({ status: "PENDING", winner_team_id: null, team2_id: 20 });
    expect(get(4)).toMatchObject({ team1_id: 30, team2_id: null, status: "PENDING" });
  });
});

describe("detachDownstreamOutcome — résultat corrigé en double forfait", () => {
  it("vide le créneau d'aval, que `pushTeamToTarget` ne saurait pas vider", async () => {
    const { conn, get } = board([
      row({ id: 2, status: "READY", team1_id: 7, team2_id: 10, live_started_at: "2026-09-23" }),
    ]);

    await detachDownstreamOutcome(conn, links(2, 1), { winnerTeamId: null, loserTeamId: null });

    expect(get(2)).toMatchObject({ team1_id: null, team2_id: 10, status: "PENDING" });
    expect(get(2).live_started_at).toBeNull();
  });

  it("vide aussi le créneau de perdant d'une double élimination", async () => {
    const { conn, get } = board([
      row({ id: 2, status: "READY", team1_id: 7, team2_id: 10 }),
      row({ id: 5, status: "READY", team1_id: 8, team2_id: 11 }),
    ]);

    await detachDownstreamOutcome(
      conn,
      { next_winner_match_id: 2, next_winner_slot: 1, next_loser_match_id: 5, next_loser_slot: 1 },
      { winnerTeamId: null, loserTeamId: null },
    );

    expect(get(2).team1_id).toBeNull();
    expect(get(5).team1_id).toBeNull();
    expect(get(5).status).toBe("PENDING");
  });
});

describe("detachDownstreamOutcome — rien à défaire", () => {
  it("laisse la cible en place quand la même équipe y retourne", async () => {
    const { conn, get } = board([
      row({ id: 2, status: "READY", team1_id: 7, team2_id: 10, live_started_at: "2026-09-23" }),
    ]);

    await detachDownstreamOutcome(conn, links(2, 1), { winnerTeamId: 7, loserTeamId: 8 });

    expect(get(2)).toMatchObject({ team1_id: 7, status: "READY", live_started_at: "2026-09-23" });
  });

  it("ne touche à rien sans lien d'aval (formats à classement)", async () => {
    const { conn } = board([]);
    await expect(
      detachDownstreamOutcome(conn, links(null, null), { winnerTeamId: null, loserTeamId: null }),
    ).resolves.toBeUndefined();
  });

  it("refuse d'effacer une rencontre réellement disputée en aval", async () => {
    // Le verrou aurait dû refuser la correction : c'est le dernier rempart.
    const { conn, get } = board([
      row({
        id: 2,
        status: "COMPLETED",
        team1_id: 7,
        team2_id: 10,
        team1_score: 2,
        team2_score: 0,
        winner_team_id: 7,
      }),
    ]);

    await expect(
      detachDownstreamOutcome(conn, links(2, 1), { winnerTeamId: null, loserTeamId: null }),
    ).rejects.toThrow("CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES");
    expect(get(2).winner_team_id).toBe(7);
  });
});
