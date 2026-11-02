/**
 * « Qui joue ce match ? » — une seule écriture de la règle : membre **actif**
 * (`left_at IS NULL`) d'une des deux engagées, ou titulaire de l'entrée solo
 * (`bg_teams.solo_user_id`). Trois lecteurs la posaient chacun à sa façon — le
 * verrou du lancement (`resolveTeamParty`, qui lit en plus les rôles d'équipe),
 * l'instantané (`referee_plays_match`) et la fenêtre « Arbitrage » — : une
 * évolution d'une seule (remplaçants, départs) les aurait désaccordés.
 *
 * Serveur seulement.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

/** Condition d'appartenance en cours d'un membre d'équipe (`bg_team_members`, alias `alias`). */
export function activeMemberSql(alias: string): string {
  return `${alias}.left_at IS NULL`;
}

/**
 * Clause SQL vraie quand `userExpr` joue le match dont les engagées sont
 * `team1Expr` / `team2Expr` (expressions SQL, jamais une entrée). Préfixe
 * `prefix` pour les alias des sous-requêtes.
 */
export function playsMatchSql(userExpr: string, team1Expr: string, team2Expr: string, prefix = "pm"): string {
  return `(EXISTS (SELECT 1 FROM bg_team_members ${prefix}tm
                 WHERE ${prefix}tm.user_id = ${userExpr} AND ${activeMemberSql(`${prefix}tm`)}
                   AND ${prefix}tm.team_id IN (${team1Expr}, ${team2Expr}))
        OR EXISTS (SELECT 1 FROM bg_teams ${prefix}st
                    WHERE ${prefix}st.solo_user_id = ${userExpr} AND ${prefix}st.id IN (${team1Expr}, ${team2Expr})))`;
}

/** Comptes qui jouent le match : membres actifs des deux engagées, ou l'engagé solo. */
export async function loadMatchPlayerIds(
  connection: Pick<PoolConnection, "execute">,
  match: { team1_id: number | null; team2_id: number | null },
): Promise<Set<number>> {
  const teamIds = [match.team1_id, match.team2_id].filter((id): id is number => id !== null).map(Number);
  if (teamIds.length === 0) return new Set();
  const placeholders = teamIds.map(() => "?").join(", ");
  const [rows] = await connection.execute<(RowDataPacket & { user_id: number })[]>(
    `SELECT user_id FROM bg_team_members tm WHERE ${activeMemberSql("tm")} AND team_id IN (${placeholders})
     UNION
     SELECT solo_user_id AS user_id FROM bg_teams WHERE solo_user_id IS NOT NULL AND id IN (${placeholders})`,
    [...teamIds, ...teamIds],
  );
  return new Set(rows.map((row) => Number(row.user_id)));
}
