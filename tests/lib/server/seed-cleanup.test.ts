import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  clearDatabase,
  ORPHAN_SWEEP_MAX_PASSES,
  orphanSweepSql,
  sweepOrphans,
  type ForeignKeyRule,
} from "@/lib/server/seed/cleanup";
import { connectionMock, fakeConnection, fakePool } from "../../helpers/sql-double";

const PHASES: ForeignKeyRule = {
  table: "bg_tournament_phases",
  column: "tournament_id",
  parentTable: "bg_tournaments",
  parentColumn: "id",
  deleteRule: "CASCADE",
};
const PHASE_TEAMS: ForeignKeyRule = {
  table: "bg_tournament_phase_teams",
  column: "phase_id",
  parentTable: "bg_tournament_phases",
  parentColumn: "id",
  deleteRule: "CASCADE",
};
const WINNER: ForeignKeyRule = {
  table: "bg_matches",
  column: "winner_team_id",
  parentTable: "bg_teams",
  parentColumn: "id",
  deleteRule: "SET NULL",
};

describe("orphanSweepSql", () => {
  it("efface l'enfant d'une clé en cascade dont le parent a disparu", () => {
    expect(orphanSweepSql(PHASES)).toBe(
      "DELETE c FROM `bg_tournament_phases` c LEFT JOIN `bg_tournaments` p ON p.`id` = c.`tournament_id` WHERE c.`tournament_id` IS NOT NULL AND p.`id` IS NULL",
    );
  });

  it("vide la référence d'une clé SET NULL au lieu d'effacer la ligne", () => {
    expect(orphanSweepSql(WINNER)).toBe(
      "UPDATE `bg_matches` c LEFT JOIN `bg_teams` p ON p.`id` = c.`winner_team_id` SET c.`winner_team_id` = NULL WHERE c.`winner_team_id` IS NOT NULL AND p.`id` IS NULL",
    );
  });

  it("échappe les accents graves d'un identifiant", () => {
    expect(orphanSweepSql({ ...PHASES, table: "a`b" })).toContain("FROM `a``b` c");
  });
});

describe("sweepOrphans", () => {
  it("repasse jusqu'à ce qu'une passe ne touche plus rien (phase, puis ses équipes)", async () => {
    const connection = connectionMock();
    connection.query.mockResolvedValueOnce([[PHASES, PHASE_TEAMS]]);
    connection.execute
      .mockResolvedValueOnce([{ affectedRows: 3 }]) // passe 1 : phases
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // passe 1 : leurs équipes, pas encore orphelines
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // passe 2 : phases
      .mockResolvedValueOnce([{ affectedRows: 12 }]) // passe 2 : équipes des phases effacées
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ affectedRows: 0 }]); // passe 3 : rien, arrêt

    await expect(sweepOrphans(fakeConnection(connection))).resolves.toBe(15);
    expect(connection.execute).toHaveBeenCalledTimes(6);
  });

  it("ne lit que les règles CASCADE et SET NULL de la base courante", async () => {
    const connection = connectionMock();
    connection.query.mockResolvedValueOnce([[]]);

    await expect(sweepOrphans(fakeConnection(connection))).resolves.toBe(0);

    const [sql] = connection.query.mock.calls[0];
    expect(sql).toContain("TABLE_SCHEMA = DATABASE()");
    expect(sql).toContain("DELETE_RULE IN ('CASCADE', 'SET NULL')");
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("s'arrête au plafond de passes", async () => {
    const connection = connectionMock();
    connection.query.mockResolvedValueOnce([[PHASES]]);
    connection.execute.mockResolvedValue([{ affectedRows: 1 }]);

    await expect(sweepOrphans(fakeConnection(connection))).resolves.toBe(ORPHAN_SWEEP_MAX_PASSES);
    expect(connection.execute).toHaveBeenCalledTimes(ORPHAN_SWEEP_MAX_PASSES);
  });
});

describe("clearDatabase", () => {
  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function setup() {
    const connection = connectionMock();
    connection.query.mockResolvedValue([[PHASES]]);
    connection.execute.mockResolvedValue([{ affectedRows: 0 }]);
    const getConnection = jest.fn(async () => fakeConnection(connection));
    const poolExecute = jest.fn();
    return { connection, pool: fakePool({ getConnection, execute: poolExecute }), poolExecute };
  }

  it("coupe et rétablit les clés étrangères sur une seule connexion dédiée, puis la rend", async () => {
    const { connection, pool, poolExecute } = setup();

    await clearDatabase(pool);

    const statements = connection.execute.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toBe("SET FOREIGN_KEY_CHECKS=0");
    expect(statements.at(-1)).toBe("SET FOREIGN_KEY_CHECKS=1");
    expect(poolExecute).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("balaie les orphelins après les suppressions, clés encore coupées", async () => {
    const { connection, pool } = setup();

    await clearDatabase(pool);

    const statements = connection.execute.mock.calls.map(([sql]) => sql);
    const sweep = statements.indexOf(orphanSweepSql(PHASES));
    expect(sweep).toBeGreaterThan(statements.indexOf("DELETE FROM bg_tournaments WHERE name LIKE 'Test -%'"));
    expect(sweep).toBeLessThan(statements.indexOf("SET FOREIGN_KEY_CHECKS=1"));
  });

  it("poursuit malgré l'échec d'une suppression ou du balayage, et rétablit les clés", async () => {
    const { connection, pool } = setup();
    connection.execute.mockImplementation(async (sql) => {
      if (sql.startsWith("DELETE FROM bg_matches")) throw new Error("boom");
      return [{ affectedRows: 0 }];
    });
    connection.query.mockRejectedValueOnce(new Error("schema"));

    await clearDatabase(pool);

    const statements = connection.execute.mock.calls.map(([sql]) => sql);
    expect(statements).toContain("DELETE FROM bg_tournaments WHERE name LIKE 'Test -%'");
    expect(statements.at(-1)).toBe("SET FOREIGN_KEY_CHECKS=1");
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("rend la connexion même si le rétablissement des clés échoue", async () => {
    const { connection, pool } = setup();
    connection.execute.mockImplementation(async (sql) => {
      if (sql === "SET FOREIGN_KEY_CHECKS=1") throw new Error("lost");
      return [{ affectedRows: 0 }];
    });

    await expect(clearDatabase(pool)).rejects.toThrow("lost");
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
});
