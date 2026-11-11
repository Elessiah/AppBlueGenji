import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { soloEntryNeverPlayedSql } from "@/lib/server/users/deleted-solo-entries";
import { adminResolveMatch } from "./admin";
import { lockTournamentRow } from "./registration";

/**
 * Le tournoi est toujours en cours, l'entrée solo appartient toujours à un
 * compte en suppression et n'a toujours pas joué dans ce tournoi — relu sur la transaction du forfait, après le
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
  // Tournoi toujours en cours : un abandon après la clôture n'a plus de sens.
  const [tournaments] = await connection.execute<(RowDataPacket & { state: string })[]>(
    `SELECT state FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );
  if (tournaments[0]?.state !== "RUNNING") return false;
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

/** Le prochain match à jouer de l'entrée : à planifier ou planifié, ses deux engagées connues. */
const OPEN_ENTRY_MATCH_WHERE = `tournament_id = ?
        AND status IN ('PENDING', 'READY')
        AND team1_id IS NOT NULL AND team2_id IS NOT NULL
        AND (team1_id = ? OR team2_id = ?)`;

/**
 * Relevé **sans verrou** : l'entrée a-t-elle encore un match ouvert ? Évite au
 * passage horaire une transaction complète qui ne trouverait rien ; un « oui »
 * se relit sous verrou (`forfeitDeletedEntryNextMatch`).
 */
export async function hasOpenDeletedEntryMatch(
  runner: Pick<PoolConnection, "execute">,
  tournamentId: number,
  teamId: number,
): Promise<boolean> {
  const [rows] = await runner.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_matches WHERE ${OPEN_ENTRY_MATCH_WHERE} LIMIT 1`,
    [tournamentId, teamId, teamId],
  );
  return rows.length > 0;
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
  if (!(await lockDeletedSoloEntryStillForfeitable(connection, tournamentId, teamId))) return null;

  // Table seule, sans jointure (MariaDB) : le verrou ne porte que sur le match.
  const [matches] = await connection.execute<(RowDataPacket & { id: number; team1_id: number; team2_id: number })[]>(
    `SELECT id, team1_id, team2_id FROM bg_matches
      WHERE ${OPEN_ENTRY_MATCH_WHERE}
      ORDER BY id
      LIMIT 1
      FOR UPDATE`,
    [tournamentId, teamId, teamId],
  );
  if (matches.length === 0) return null;
  const match = matches[0];
  const matchId = Number(match.id);
  const opponentId = Number(match.team1_id) === teamId ? Number(match.team2_id) : Number(match.team1_id);
  // Deux entrées en suppression qui se rencontrent : double forfait. Sinon la
  // première traitée perdait et l'autre montait — une victoire au palmarès
  // d'un compte supprimé, qui ne joue de toute façon plus.
  const opponentAlsoDeleted = await lockDeletedSoloEntryStillForfeitable(connection, tournamentId, opponentId);
  await adminResolveMatch(
    connection,
    matchId,
    opponentAlsoDeleted ? { doubleForfeit: true } : { forfeitTeamId: teamId },
  );
  return matchId;
}
