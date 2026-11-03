import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { soloEntryNeverPlayedSql } from "@/lib/server/users/deleted-solo-entries";
import { adminResolveMatch } from "./admin";
import { lockTournamentRow } from "./registration";

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

  const [entries] = await connection.execute<(RowDataPacket & { is_deleted: number })[]>(
    `SELECT u.is_deleted
       FROM bg_teams s
       JOIN bg_users u ON u.id = s.solo_user_id
      WHERE s.id = ?
        AND ${soloEntryNeverPlayedSql("?", "?")}
      LIMIT 1`,
    [teamId, tournamentId, teamId, teamId],
  );
  if (Number(entries[0]?.is_deleted ?? 0) !== 1) return null;

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
