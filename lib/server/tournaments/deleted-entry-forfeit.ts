import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { soloEntryNeverPlayedSql } from "@/lib/server/users/deleted-solo-entries";
import { adminResolveMatch } from "./admin";
import { lockTournamentRow } from "./registration";

/**
 * L'entrée solo appartient toujours à un compte en suppression et n'a toujours
 * pas joué dans ce tournoi — relu sur la transaction du forfait, après le
 * verrou du tournoi, la ligne du compte **verrouillée** (`FOR UPDATE`, table
 * seule) : une réactivation commitée avant est vue, une réactivation qui
 * arrive pendant attend le commit du forfait, au lieu qu'un compte réactivé
 * perde son tournoi sur un relevé périmé.
 */
export async function lockDeletedSoloEntryStillForfeitable(
  connection: Pick<PoolConnection, "execute">,
  tournamentId: number,
  teamId: number,
): Promise<boolean> {
  const [entries] = await connection.execute<(RowDataPacket & { solo_user_id: number | null })[]>(
    `SELECT s.solo_user_id
       FROM bg_teams s
      WHERE s.id = ?
        AND ${soloEntryNeverPlayedSql("?", "?")}
      LIMIT 1`,
    [teamId, tournamentId, teamId, teamId],
  );
  const soloUserId = entries[0]?.solo_user_id ?? null;
  if (soloUserId === null) return false;
  const [users] = await connection.execute<(RowDataPacket & { is_deleted: number })[]>(
    `SELECT is_deleted FROM bg_users WHERE id = ? FOR UPDATE`,
    [soloUserId],
  );
  return Number(users[0]?.is_deleted ?? 0) === 1;
}

/**
 * Forfait du prochain match à jouer de l'entrée solo d'un compte en
 * suppression (E1, `docs/features/ACCOUNT_DELETION.md`), sur la transaction de
 * l'appelant (`forfeitDeletedEntryMatchPublic`, qui enchaîne réconciliations et
 * clôture).
 *
 * Tout se relit **sous verrou**, le tournoi d'abord (`lockTournamentRow`) puis
 * la ligne du match : un relevé hors transaction pouvait désigner un match
 * qu'un arbitre venait de trancher, et `adminResolveMatch` l'aurait traité en
 * correction — le vrai résultat défait au profit d'un forfait. D'où quatre
 * conditions relues ici : tournoi en cours, compte toujours en suppression,
 * entrée jamais jouée dans ce tournoi, match encore « à planifier » ou
 * « planifié » avec ses deux engagées.
 *
 * Rend l'id du match forfaité, `null` s'il n'y a rien (ou plus rien) à faire.
 */
export async function forfeitDeletedEntryNextMatch(
  connection: PoolConnection,
  tournamentId: number,
  teamId: number,
): Promise<number | null> {
  await lockTournamentRow(connection, tournamentId);
  const [tournaments] = await connection.execute<(RowDataPacket & { state: string })[]>(
    `SELECT state FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );
  if (tournaments[0]?.state !== "RUNNING") return null;

  if (!(await lockDeletedSoloEntryStillForfeitable(connection, tournamentId, teamId))) return null;

  // Table seule, sans jointure (MariaDB) : le verrou ne porte que sur le match.
  const [matches] = await connection.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_matches
      WHERE tournament_id = ?
        AND status IN ('PENDING', 'READY')
        AND team1_id IS NOT NULL AND team2_id IS NOT NULL
        AND (team1_id = ? OR team2_id = ?)
      ORDER BY id
      LIMIT 1
      FOR UPDATE`,
    [tournamentId, teamId, teamId],
  );
  if (matches.length === 0) return null;
  const matchId = Number(matches[0].id);
  await adminResolveMatch(connection, matchId, { forfeitTeamId: teamId });
  return matchId;
}
