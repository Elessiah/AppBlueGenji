import { describe, expect, it } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";
import { finalizeUnderfilledTournament } from "@/lib/server/tournaments/finalization";

type Call = { sql: string; params: unknown[] };

/**
 * Connexion factice : rend les inscriptions demandées à la lecture, enregistre
 * les écritures. Les requêtes sont normalisées (espaces repliés) pour que les
 * assertions portent sur le sens, pas sur l'indentation.
 */
function fakeConnection(teamIds: number[]) {
  const calls: Call[] = [];
  const connection = {
    execute: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      if (sql.includes("SELECT team_id FROM bg_tournament_registrations")) {
        return [teamIds.map((team_id) => ({ team_id })), []];
      }
      return [{ affectedRows: 1 }, []];
    },
  } as unknown as PoolConnection;

  return { connection, calls, writes: () => calls.slice(1) };
}

describe("finalizeUnderfilledTournament", () => {
  it("clôt un tournoi sans aucune engagée", async () => {
    const { connection, writes } = fakeConnection([]);

    expect(await finalizeUnderfilledTournament(connection, 42)).toBe(true);

    // Personne à classer : la seule écriture est la clôture.
    expect(writes()).toHaveLength(1);
    expect(writes()[0].sql).toContain("state = 'FINISHED'");
    expect(writes()[0].params).toEqual([0, 42]);
  });

  it("déclare première l'unique engagée, puis clôt", async () => {
    const { connection, writes } = fakeConnection([9]);

    expect(await finalizeUnderfilledTournament(connection, 42)).toBe(true);

    expect(writes()[0].sql).toContain("SET final_rank = 1");
    expect(writes()[0].params).toEqual([42, 9]);
    expect(writes()[1].sql).toContain("state = 'FINISHED'");
    // `bracket_size` reçoit l'effectif retenu : laissé à NULL, il redemanderait
    // une synchronisation à chaque lecture.
    expect(writes()[1].params).toEqual([1, 42]);
  });

  it("ne touche à rien dès deux engagées", async () => {
    const { connection, writes } = fakeConnection([9, 10]);

    expect(await finalizeUnderfilledTournament(connection, 42)).toBe(false);
    expect(writes()).toHaveLength(0);
  });

  it("ne lit que ce qu'il faut pour trancher", async () => {
    // `LIMIT 2` : seule la distinction « moins de deux » compte — un tournoi à
    // 128 engagées ne doit pas les charger toutes à chaque synchronisation.
    const { connection, calls } = fakeConnection([9, 10]);

    await finalizeUnderfilledTournament(connection, 42);

    expect(calls[0].sql).toContain("LIMIT 2");
    expect(calls[0].params).toEqual([42]);
  });
});
