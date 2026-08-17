import { describe, expect, it } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";
import { generateFirstRound, generateNextRound } from "@/lib/server/tournaments/swiss";

/**
 * Régression : `bg_swiss_standings.opponent_ids_json` est une colonne JSON, que
 * mysql2 renvoie **déjà désérialisée** (tableau JS). L'orchestration faisait un
 * `JSON.parse()` aveugle dessus, qui échouait (`String([])` vaut ""), rendant
 * impossible la génération de la moindre ronde suisse en base réelle. Les tests
 * existants ne couvraient que les helpers d'appariement purs, d'où l'angle mort.
 */

interface FakeQuery {
  sql: string;
  params: unknown[];
}

// Connexion factice : route chaque requête sur des lignes canned et enregistre
// tout ce qui a été exécuté, pour pouvoir vérifier les matchs créés.
function fakeConnection(options: {
  opponentIds: string | number[];
  teamCount: number;
  currentRound?: number;
  totalRounds?: number;
}): { conn: PoolConnection; queries: FakeQuery[] } {
  const queries: FakeQuery[] = [];
  let insertId = 100;

  const standings = Array.from({ length: options.teamCount }, (_, i) => ({
    team_id: i + 1,
    points: 0,
    byes: 0,
    opponent_ids_json: options.opponentIds,
  }));

  const conn = {
    execute: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });

      if (sql.includes("FROM bg_tournaments")) {
        return [
          [
            {
              format: "SWISS",
              swiss_current_round: options.currentRound ?? 0,
              swiss_total_rounds: options.totalRounds ?? 4,
            },
          ],
          [],
        ];
      }
      if (sql.includes("FROM bg_swiss_standings")) {
        return [standings, []];
      }
      if (sql.includes("SELECT COUNT(*) as count FROM bg_matches")) {
        return [[{ count: 0 }], []];
      }
      if (sql.trimStart().startsWith("INSERT INTO bg_matches")) {
        insertId += 1;
        return [{ insertId }, []];
      }
      return [[], []];
    },
  } as unknown as PoolConnection;

  return { conn, queries };
}

function createdMatchCount(queries: FakeQuery[]): number {
  return queries.filter((q) => q.sql.trimStart().startsWith("INSERT INTO bg_matches")).length;
}

describe("swiss — opponent_ids_json renvoyé par mysql2", () => {
  it("accepte un tableau déjà désérialisé (comportement réel de la colonne JSON)", async () => {
    const { conn, queries } = fakeConnection({ opponentIds: [], teamCount: 8 });

    await expect(generateFirstRound(1, conn)).resolves.toBeUndefined();
    expect(createdMatchCount(queries)).toBe(4);
  });

  it("accepte encore la forme chaîne (dump SQL, driver alternatif)", async () => {
    const { conn, queries } = fakeConnection({ opponentIds: "[]", teamCount: 8 });

    await generateFirstRound(1, conn);
    expect(createdMatchCount(queries)).toBe(4);
  });

  it("crée un appariement de plus quand l'effectif est impair (bye)", async () => {
    const { conn, queries } = fakeConnection({ opponentIds: [], teamCount: 7 });

    await generateFirstRound(1, conn);
    // 3 matchs + 1 bye
    expect(createdMatchCount(queries)).toBe(4);
  });

  it("génère la ronde suivante avec des adversaires déjà rencontrés", async () => {
    const { conn, queries } = fakeConnection({
      opponentIds: [2],
      teamCount: 4,
      currentRound: 1,
      totalRounds: 3,
    });

    // `generateNextRound` renvoie désormais `{ done }` : l'orchestrateur multi-phases
    // a besoin de savoir si la ronde suisse est terminée sans relire la base.
    // Ici la ronde suivante vient d'être générée, la phase continue donc.
    await expect(generateNextRound(1, conn)).resolves.toEqual({ done: false });
    expect(createdMatchCount(queries)).toBeGreaterThan(0);
  });

  it("clôt le tournoi une fois la dernière ronde jouée", async () => {
    const { conn, queries } = fakeConnection({
      opponentIds: [],
      teamCount: 4,
      currentRound: 3,
      totalRounds: 3,
    });

    await generateNextRound(1, conn);

    expect(createdMatchCount(queries)).toBe(0);
    expect(
      queries.some((q) => q.sql.includes("state = 'FINISHED'")),
    ).toBe(true);
  });
});
