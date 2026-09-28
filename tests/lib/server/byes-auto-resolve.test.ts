import { describe, expect, it, jest } from "@jest/globals";

import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/** Ligne de `bg_matches` réduite à ce que lit la résolution des exemptions. */
interface FakeMatch {
  id: number;
  status: "PENDING" | "READY" | "COMPLETED";
  team1_id: number | null;
  team2_id: number | null;
  winner_team_id: number | null;
  team1_score: number | null;
  team2_score: number | null;
  next_winner_match_id: number | null;
  next_winner_slot: number | null;
  next_loser_match_id: number | null;
  next_loser_slot: number | null;
}

function match(id: number, overrides: Partial<FakeMatch> = {}): FakeMatch {
  return {
    id,
    status: "PENDING",
    team1_id: null,
    team2_id: null,
    winner_team_id: null,
    team1_score: null,
    team2_score: null,
    next_winner_match_id: null,
    next_winner_slot: null,
    next_loser_match_id: null,
    next_loser_slot: null,
    ...overrides,
  };
}

/** Un match non terminé envoie-t-il son vainqueur ou son perdant sur cette case ? */
function hasPendingFeeder(matches: FakeMatch[], target: FakeMatch, slot: number | null): boolean {
  return matches.some(
    (f) =>
      f.status !== "COMPLETED" &&
      ((f.next_winner_match_id === target.id && (slot === null || f.next_winner_slot === slot)) ||
        (f.next_loser_match_id === target.id && (slot === null || f.next_loser_slot === slot))),
  );
}

/**
 * Plateau en mémoire qui répond aux requêtes de `byes.ts` comme la base le
 * ferait — y compris la clause `NOT EXISTS` des candidats, évaluée sur l'état
 * **au moment de la lecture**.
 */
function fakeBracket(matches: FakeMatch[]) {
  const byId = (id: unknown) => {
    const found = matches.find((m) => m.id === Number(id));
    if (!found) throw new Error(`match ${String(id)} inconnu`);
    return found;
  };

  const execute = jest.fn<SqlQuery>(async (sql, params) => {
    const values = (params ?? []) as unknown[];
    const q = sql.replace(/\s+/g, " ").trim();

    if (q.startsWith("SELECT m.id, m.team1_id")) {
      const open = matches.filter(
        (m) =>
          m.status !== "COMPLETED" &&
          m.winner_team_id === null &&
          (m.team1_id === null) !== (m.team2_id === null),
      );
      return [
        open.filter((m) => !hasPendingFeeder(matches, m, m.team1_id === null ? 1 : 2)).map((m) => ({ ...m })),
      ];
    }
    if (q.startsWith("SELECT m.id FROM bg_matches m")) {
      return [
        matches
          .filter(
            (m) =>
              m.status !== "COMPLETED" &&
              m.winner_team_id === null &&
              m.team1_id === null &&
              m.team2_id === null &&
              !hasPendingFeeder(matches, m, null),
          )
          .map((m) => ({ id: m.id })),
      ];
    }
    if (q.startsWith("UPDATE bg_matches SET team1_score = ?")) {
      const target = byId(values[4]);
      target.team1_score = values[0] as number;
      target.team2_score = values[1] as number;
      target.winner_team_id = values[2] as number;
      target.status = "COMPLETED";
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith("UPDATE bg_matches SET team1_id = ?")) {
      byId(values[1]).team1_id = values[0] as number;
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith("UPDATE bg_matches SET team2_id = ?")) {
      byId(values[1]).team2_id = values[0] as number;
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith("SELECT team1_id, team2_id")) {
      const target = byId(values[0]);
      return [[{ team1_id: target.team1_id, team2_id: target.team2_id }]];
    }
    if (q.startsWith("UPDATE bg_matches SET status = ? WHERE id = ?")) {
      byId(values[1]).status = values[0] as FakeMatch["status"];
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith("UPDATE bg_matches SET status = 'COMPLETED', team1_score = 0")) {
      for (const id of values) {
        const ghost = byId(id);
        ghost.status = "COMPLETED";
        ghost.team1_score = 0;
        ghost.team2_score = 0;
      }
      return [{ affectedRows: values.length }];
    }
    throw new Error(`requête inattendue : ${q}`);
  });

  return { execute, connection: fakeConnection({ execute }) };
}

function statements(execute: jest.Mock<SqlQuery>): string[] {
  return execute.mock.calls.map(([sql]) => sql.replace(/\s+/g, " ").trim());
}

describe("tryAutoResolveByes", () => {
  it("ne fait qu'une lecture par cas quand rien n'est à résoudre", async () => {
    const { execute, connection } = fakeBracket([match(1, { team1_id: 10, team2_id: 11, status: "READY" })]);

    await tryAutoResolveByes(connection, 7);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map(([, params]) => params)).toEqual([
      [7, 0],
      [7, 0],
    ]);
  });

  it("n'émet plus aucun comptage par match : l'alimentation est dans la requête des candidats", async () => {
    // Quatre exemptions de premier tour : l'ancienne boucle comptait les
    // alimentations de chacune par un `COUNT(*)`.
    const matches = [
      match(1, { team1_id: 10, next_winner_match_id: 5, next_winner_slot: 1 }),
      match(2, { team1_id: 11, next_winner_match_id: 5, next_winner_slot: 2 }),
      match(3, { team2_id: 12, next_winner_match_id: 6, next_winner_slot: 1 }),
      match(4, { team1_id: 13, next_winner_match_id: 6, next_winner_slot: 2 }),
      match(5),
      match(6),
    ];
    const { execute, connection } = fakeBracket(matches);

    await tryAutoResolveByes(connection, 7);

    const sqls = statements(execute);
    expect(sqls.some((q) => q.includes("COUNT("))).toBe(false);
    const candidateQueries = sqls.filter((q) => q.startsWith("SELECT m.id, m.team1_id"));
    // Une lecture par passe : la première résout les quatre exemptions, la
    // seconde constate qu'il n'y a plus rien (5 et 6 sont désormais garnis).
    expect(candidateQueries).toHaveLength(2);
    expect(candidateQueries[0]).toContain("NOT EXISTS");
    expect(candidateQueries[0]).toContain(
      "f.next_winner_slot = CASE WHEN m.team1_id IS NULL THEN 1 ELSE 2 END",
    );
    expect(matches.find((m) => m.id === 5)).toMatchObject({ team1_id: 10, team2_id: 11, status: "READY" });
    expect(matches.find((m) => m.id === 6)).toMatchObject({ team1_id: 12, team2_id: 13, status: "READY" });
  });

  it("tranche l'exemption au profit de l'équipe présente, côté par côté", async () => {
    const matches = [match(1, { team2_id: 20 }), match(2, { team1_id: 21 })];
    const { connection } = fakeBracket(matches);

    await tryAutoResolveByes(connection, 7);

    expect(matches[0]).toMatchObject({
      status: "COMPLETED",
      winner_team_id: 20,
      team1_score: 0,
      team2_score: 1,
    });
    expect(matches[1]).toMatchObject({
      status: "COMPLETED",
      winner_team_id: 21,
      team1_score: 1,
      team2_score: 0,
    });
  });

  it("attend l'alimentation en cours d'une case vide", async () => {
    const matches = [
      match(1, { team1_id: 10, team2_id: 11, status: "READY", next_winner_match_id: 2, next_winner_slot: 2 }),
      match(2, { team1_id: 12 }),
    ];
    const { connection } = fakeBracket(matches);

    await tryAutoResolveByes(connection, 7);

    expect(matches[1]).toMatchObject({ status: "PENDING", winner_team_id: null });
  });

  it("ignore une alimentation qui vise l'autre case", async () => {
    // Le match 1 alimente la case 1 du match 2, déjà garnie : la case 2 vide
    // n'attend personne, l'exemption est acquise.
    const matches = [
      match(1, { team1_id: 10, team2_id: 11, status: "READY", next_winner_match_id: 2, next_winner_slot: 1 }),
      match(2, { team1_id: 12 }),
    ];
    const { connection } = fakeBracket(matches);

    await tryAutoResolveByes(connection, 7);

    expect(matches[1]).toMatchObject({ status: "COMPLETED", winner_team_id: 12 });
  });

  it("ne tranche jamais sur une ligne déjà lue dont la case vide a été garnie dans la passe", async () => {
    // 1 est une exemption qui alimente la case vide de 2. Au moment de la
    // lecture, 1 n'est pas terminé : 2 attend, et reçoit l'équipe 10 au lieu
    // d'être tranché d'office au profit de 12 sur sa ligne périmée.
    const matches = [
      match(1, { team1_id: 10, next_winner_match_id: 2, next_winner_slot: 2 }),
      match(2, { team1_id: 12 }),
    ];
    const { connection } = fakeBracket(matches);

    await tryAutoResolveByes(connection, 7);

    expect(matches[0]).toMatchObject({ status: "COMPLETED", winner_team_id: 10 });
    expect(matches[1]).toMatchObject({ team1_id: 12, team2_id: 10, status: "READY", winner_team_id: null });
  });

  it("clôt les matchs fantômes d'une passe en une seule écriture", async () => {
    const matches = [match(1), match(2), match(3, { team1_id: 10, team2_id: 11, status: "READY" })];
    const { execute, connection } = fakeBracket(matches);

    await tryAutoResolveByes(connection, 7, 3);

    const ghostUpdates = execute.mock.calls.filter(([sql]) => sql.includes("team1_score = 0"));
    expect(ghostUpdates).toHaveLength(1);
    expect(ghostUpdates[0][0]).toContain("WHERE id IN (?, ?)");
    expect(ghostUpdates[0][1]).toEqual([1, 2]);
    expect(matches.slice(0, 2).every((m) => m.status === "COMPLETED")).toBe(true);
    // La phase est transmise aux deux lectures.
    expect(execute.mock.calls[0][1]).toEqual([7, 3]);
  });

  it("enchaîne fantôme puis exemption sur les passes suivantes", async () => {
    // 1 est fantôme et alimente la case 2 du match 2 ; une fois 1 clos, 2
    // n'attend plus rien et devient une exemption, qui monte en 3.
    const matches = [
      match(1, { next_winner_match_id: 2, next_winner_slot: 2 }),
      match(2, { team1_id: 12, next_winner_match_id: 3, next_winner_slot: 1 }),
      match(3, { team2_id: 13 }),
    ];
    const { connection } = fakeBracket(matches);

    await tryAutoResolveByes(connection, 7);

    expect(matches[0].status).toBe("COMPLETED");
    expect(matches[1]).toMatchObject({ status: "COMPLETED", winner_team_id: 12 });
    expect(matches[2]).toMatchObject({ team1_id: 12, team2_id: 13, status: "READY" });
  });

  it("attend qu'un fantôme alimentant un autre fantôme soit clos", async () => {
    const matches = [match(1, { next_loser_match_id: 2, next_loser_slot: 1 }), match(2)];
    const { execute, connection } = fakeBracket(matches);

    await tryAutoResolveByes(connection, 7);

    const ghostUpdates = execute.mock.calls.filter(([sql]) => sql.includes("team1_score = 0"));
    expect(ghostUpdates.map(([, params]) => params)).toEqual([[1], [2]]);
  });
});
