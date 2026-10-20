import { describe, expect, it, jest } from "@jest/globals";
import type { Pool } from "mysql2/promise";
import { applyRecentSchemaChanges } from "@/lib/server/database/recent-schema-changes";
import { SCORE_AUTO_VALIDATE_MINUTES } from "@/lib/shared/constants";
import type { SqlQuery } from "../../helpers/sql-double";

/**
 * Rattrapage des échéances (PR #453, `docs/features/SCORE_DISPUTE_LOCK.md`) : un
 * report seul déposé sous l'ancienne règle (fin de série + 10 min) ne peut pas
 * être validé d'office moins de deux heures après sa saisie.
 */
async function catchUpStatement(): Promise<string> {
  const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);
  await applyRecentSchemaChanges({ execute } as unknown as Pool);
  const statements = execute.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " ").trim());
  const statement = statements.find((sql) => sql.startsWith("UPDATE bg_matches m SET m.score_deadline_at"));
  if (!statement) throw new Error("rattrapage absent");
  return statement;
}

describe("rattrapage des échéances de validation d'office", () => {
  it("repousse l'échéance à la saisie + deux heures", async () => {
    const sql = await catchUpStatement();
    expect(sql).toContain(
      `SET m.score_deadline_at = DATE_ADD( COALESCE(m.team1_reported_at, m.team2_reported_at), INTERVAL ${SCORE_AUTO_VALIDATE_MINUTES} MINUTE)`,
    );
  });

  it("ne touche qu'un report seul en attente, dont l'échéance est plus proche", async () => {
    const sql = await catchUpStatement();
    expect(sql).toContain("m.status = 'AWAITING_CONFIRMATION'");
    expect(sql).toContain("m.winner_team_id IS NULL");
    expect(sql).toContain("m.score_deadline_at IS NOT NULL");
    // Un report seul : un litige garde l'échéance de son escalade.
    expect(sql).toContain(" <> ");
    expect(sql).toContain(
      `m.score_deadline_at < DATE_ADD( COALESCE(m.team1_reported_at, m.team2_reported_at), INTERVAL ${SCORE_AUTO_VALIDATE_MINUTES} MINUTE)`,
    );
  });

  it("est sans jointure ni verrou (MariaDB) et rejouable à chaque démarrage", async () => {
    const sql = await catchUpStatement();
    expect(sql).not.toMatch(/JOIN|FOR UPDATE|FOR SHARE/);
    // Ne repousse jamais au-delà de la règle : rejoué, il ne trouve plus rien.
    expect(sql).not.toMatch(/NOW\(\)/);
  });
});
