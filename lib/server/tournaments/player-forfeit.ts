import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { isMatchPlayed } from "@/lib/shared/match-outcome";
import type { MatchStatus } from "@/lib/shared/types";
import { adminResolveMatch } from "./admin";
import { resolveUserEntrant } from "./registration";
import { syncTournamentState } from "./state";

/**
 * Forfait d'un engagé **sur une manche**, déclaré par lui-même.
 *
 * Le pendant joueur du forfait d'arbitrage (`adminResolveMatch`, avec
 * `forfeitTeamId`) — et non de l'abandon (`forfeitTournamentTeam`), qui retire
 * l'engagé de **tout le reste** du tournoi. Ici, seule la rencontre est perdue,
 * au score plein du format (FT3 → 0-3) ; en BG Survie l'équipe reste en lice.
 *
 * Trois règles, tenues ici et non par l'appelant :
 * · **on ne déclare que son propre forfait.** Accuser l'adversaire de ne pas
 *   s'être présenté est une contestation, et une contestation se porte à
 *   l'arbitrage (signalement d'un problème) ;
 * · **il faut la charge de l'équipe** (`OWNER` / `MANAGER`, ou le joueur en
 *   individuel) : perdre une manche sans la jouer engage l'équipe entière, au
 *   même titre que l'inscrire ou l'abandonner (`NOT_TEAM_MANAGER`) ;
 * · **pas besoin que le match soit lancé** : c'est l'équipe qui ne pourra pas se
 *   présenter qui a besoin de ce geste, et elle le sait avant le coup d'envoi.
 *
 * L'écriture passe ensuite par `adminResolveMatch`, seul chemin qui sache
 * trancher un forfait (score plein, propagation dans le plateau, journal) : une
 * seconde implémentation aurait divergé au premier format ajouté.
 */
export async function forfeitOwnMatch(
  connection: PoolConnection,
  tournamentId: number,
  matchId: number,
  userId: number,
): Promise<{ forfeitTeamId: number }> {
  const { row: tournament } = await syncTournamentState(connection, tournamentId);
  if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
  if (tournament.state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");

  const entrant = await resolveUserEntrant(connection, tournament, userId);
  if (entrant.teamId === null) throw new Error("NO_ACTIVE_TEAM");
  if (!entrant.canActForEntrant) throw new Error("NOT_TEAM_MANAGER");

  // Verrou de la ligne, table seule et sans jointure (MariaDB) : deux reports ou
  // un report et un forfait simultanés ne doivent pas trancher deux fois.
  const [rows] = await connection.execute<
    (RowDataPacket & { team1_id: number | null; team2_id: number | null; status: MatchStatus })[]
  >(
    `SELECT team1_id, team2_id, status
     FROM bg_matches
     WHERE id = ? AND tournament_id = ?
     LIMIT 1
     FOR UPDATE`,
    [matchId, tournamentId],
  );
  const match = rows[0];
  if (!match) throw new Error("MATCH_NOT_FOUND");
  if (isMatchPlayed({ status: match.status })) throw new Error("MATCH_ALREADY_COMPLETED");
  if (match.team1_id === null || match.team2_id === null) throw new Error("MATCH_NOT_READY");

  const teamId = entrant.teamId;
  if (Number(match.team1_id) !== teamId && Number(match.team2_id) !== teamId) {
    throw new Error("NOT_IN_MATCH");
  }

  await adminResolveMatch(connection, matchId, { forfeitTeamId: teamId });
  return { forfeitTeamId: teamId };
}
