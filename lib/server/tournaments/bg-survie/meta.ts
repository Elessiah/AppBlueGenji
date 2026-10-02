/**
 * BlueGenji Survie — métadonnées d'affichage : barème, manche courante,
 * classement complet, historique manche par manche et journal des sanctions
 * (`docs/features/BG_SURVIE_MODE.md`).
 */

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { rowsOrEmptyIfMissingTable } from "@/lib/server/mysql-errors";
import { toIso } from "@/lib/server/serialization";
import { replayEnduranceDetailed } from "@/lib/shared/bg-survie/replay";
import type { EnduranceStatus } from "@/lib/shared/bg-survie/standings";
import { forfeitMapCount } from "@/lib/shared/match-format";
import { localUploadUrl } from "@/lib/shared/uploads";
import { loadQualificationOutcomes } from "./replay-inputs";
import { lastRoundWithScoreInput } from "./round-progress";
import { configOf, loadTournament, matchFormatOf } from "./tournament-row";

/**
 * Pénalités du tournoi telles qu'elles s'affichent : avec leur motif, l'engagé
 * visé et l'auteur de la sanction.
 *
 * L'auteur est nommé parce qu'une sanction se conteste : « −3 » sans arbitre
 * derrière n'est adressable à personne. Un compte effacé laisse la ligne en
 * place (`created_by` passe à `NULL`) — la pénalité reste due.
 */
async function loadPenaltyRows(conn: PoolConnection, tournamentId: number) {
  // Borne du retrait, relue une fois pour tout le tableau : une sanction de la
  // manche N ne se retire plus dès qu'une manche postérieure a été entamée
  // (même règle que `liftEndurancePenalty`, même prédicat).
  const lockRound = await lastRoundWithScoreInput(conn, tournamentId);

  // Même tolérance que `loadPenalties` : sans la table, le classement
  // s'affiche sans journal des sanctions plutôt que pas du tout.
  const rows = await rowsOrEmptyIfMissingTable(
    conn.execute<
      (RowDataPacket & {
        id: number;
        team_id: number;
        team_name: string;
        round_number: number;
        points: number;
        reason: string;
        author_pseudo: string | null;
        created_at: Date | string;
      })[]
    >(
      `SELECT p.id, p.team_id, p.round_number, p.points, p.reason, p.created_at,
              t.name AS team_name, u.pseudo AS author_pseudo
       FROM bg_endurance_penalties p
       JOIN bg_teams t ON t.id = p.team_id
       LEFT JOIN bg_users u ON u.id = p.created_by
       WHERE p.tournament_id = ?
       ORDER BY p.round_number ASC, p.id ASC`,
      [tournamentId],
    ),
  );

  return rows.map((row) => ({
    id: Number(row.id),
    teamId: Number(row.team_id),
    teamName: row.team_name,
    round: Number(row.round_number),
    points: Number(row.points),
    reason: row.reason,
    authorPseudo: row.author_pseudo,
    createdAt: toIso(row.created_at),
    // `>=` et non `>` : la manche de la sanction elle-même peut être entamée,
    // la pénalité tombe de toute façon après ses matchs.
    removable: Number(row.round_number) >= lockRound,
  }));
}

/** Métadonnées d'affichage : barème, manche courante, classement complet. */
export async function loadEnduranceMeta(conn: PoolConnection, tournamentId: number) {
  const tournament = await loadTournament(conn, tournamentId);
  if (tournament?.format !== "BG_SURVIE") return null;

  const config = configOf(tournament);

  const [rows] = await conn.execute<
    (RowDataPacket & {
      team_id: number;
      team_name: string;
      logo_url: string | null;
      seed: number;
      points: number;
      wins: number;
      losses: number;
      draws: number | null;
      status: EnduranceStatus;
      eliminated_round: number | null;
      rank: number;
    })[]
  >(
    `SELECT s.team_id, s.seed, s.points, s.wins, s.losses, s.draws, s.status, s.eliminated_round, s.\`rank\`,
            t.name AS team_name, t.logo_url
     FROM bg_endurance_standings s
     JOIN bg_teams t ON t.id = s.team_id
     WHERE s.tournament_id = ?
     ORDER BY s.\`rank\` ASC, s.seed ASC`,
    [tournamentId],
  );

  // Historique manche par manche — la lecture « feuille de calcul » du mode.
  // Il n'est **pas** stocké : le même rejeu qui produit le classement le
  // produit, si bien qu'une correction de score le refait sans migration ni
  // colonne à tenir à jour. Les abandons se relisent ici depuis les lignes déjà
  // chargées, plutôt que par une seconde requête sur la même table.
  const penalties = await loadPenaltyRows(conn, tournamentId);

  const detailed = replayEnduranceDetailed({
    teams: rows.map((row) => ({ teamId: Number(row.team_id), seed: Number(row.seed) })),
    matches: await loadQualificationOutcomes(conn, tournamentId),
    forfeits: rows
      .filter((row) => row.status === "FORFEIT")
      .map((row) => ({
        teamId: Number(row.team_id),
        round: Number(row.eliminated_round ?? 1),
      })),
    // Les mêmes lignes que le rejeu de `reconcileEndurance`, relues ici avec
    // leur motif : deux requêtes diraient la même chose, une seule évite qu'un
    // tableau et son classement divergent.
    penalties: penalties.map((penalty) => ({
      teamId: penalty.teamId,
      round: penalty.round,
      points: penalty.points,
    })),
    config,
    lastRound: Number(tournament.endurance_current_round),
    matchFormat: matchFormatOf(tournament),
  });

  return {
    startPoints: config.startPoints,
    winDelta: config.winDelta,
    lossDelta: config.lossDelta,
    forfeitMaps: forfeitMapCount(matchFormatOf(tournament)),
    playoffSize: config.playoffSize,
    maxRounds: config.maxRounds,
    currentRound: Number(tournament.endurance_current_round),
    playoffsStarted: Number(tournament.endurance_playoffs_started) === 1,
    rounds: detailed.rounds,
    penalties,
    standings: rows.map((row) => ({
      teamId: Number(row.team_id),
      teamName: row.team_name,
      logoUrl: localUploadUrl(row.logo_url),
      seed: Number(row.seed),
      points: Number(row.points),
      wins: Number(row.wins),
      losses: Number(row.losses),
      draws: Number(row.draws ?? 0),
      status: row.status,
      eliminatedRound: row.eliminated_round === null ? null : Number(row.eliminated_round),
      rank: Number(row.rank),
      // Le cumul vient du **rejeu**, pas d'une somme des lignes : une sanction
      // visant une équipe déjà sortie n'a rien retiré, et l'annoncer au
      // classement ferait mentir la colonne d'endurance.
      penaltyPoints: detailed.penaltyTotals.get(Number(row.team_id)) ?? 0,
      rounds: detailed.history.get(Number(row.team_id)) ?? [],
    })),
  };
}

export type EnduranceMeta = NonNullable<Awaited<ReturnType<typeof loadEnduranceMeta>>>;
