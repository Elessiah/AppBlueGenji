/**
 * BlueGenji Survie — tours de l'arbre final tels qu'ils sont posés en base :
 * lecture, et écriture conforme à un plan du module pur (`docs/features/BG_SURVIE_MODE.md`).
 */

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { ignoreMissingTable } from "@/lib/server/mysql-errors";
import type { PlayoffRoundPlan } from "@/lib/shared/bg-survie/playoffs";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";
import { createMatch } from "../repository";

/** Une rencontre d'arbre final telle qu'elle est posée en base. */
type PlayoffMatchRow = {
  id: number;
  bracket: string;
  status: string;
  teamAId: number | null;
  teamBId: number | null;
  winnerTeamId: number | null;
  loserTeamId: number | null;
  /** Rencontre close sur un double forfait : elle ne qualifie personne. */
  doubleForfeit: boolean;
  hasScoreInput: boolean;
};

/** Numéros des tours d'arbre final déjà posés, du premier au dernier. */
export async function loadPlayoffRoundNumbers(
  conn: PoolConnection,
  tournamentId: number,
): Promise<number[]> {
  const [rows] = await conn.execute<(RowDataPacket & { round_number: number })[]>(
    `SELECT DISTINCT round_number FROM bg_matches
     WHERE tournament_id = ? AND round_number >= ?
     ORDER BY round_number ASC`,
    [tournamentId, PLAYOFF_ROUND_OFFSET],
  );
  return rows.map((row) => Number(row.round_number));
}

/**
 * Rencontres d'un tour d'arbre final, dans l'ordre d'affichage.
 *
 * `hasScoreInput` reprend mot pour mot la règle de `lib/shared/match-lock.ts` :
 * un score (même nul), un vainqueur, un forfait ou un report en attente. C'est
 * lui qui interdit de réécrire un tour déjà entamé — et il ignore les byes,
 * dont le 1-0 est posé par le moteur et non saisi par une équipe.
 */
export async function loadPlayoffRoundMatches(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
): Promise<PlayoffMatchRow[]> {
  const [rows] = await conn.execute<
    (RowDataPacket & {
      id: number;
      bracket: string;
      status: string;
      team1_id: number | null;
      team2_id: number | null;
      team1_score: number | null;
      team2_score: number | null;
      winner_team_id: number | null;
      loser_team_id: number | null;
      forfeit_team_id: number | null;
      double_forfeit: number | null;
      is_bye: number | null;
    })[]
  >(
    `SELECT id, bracket, status, team1_id, team2_id, team1_score, team2_score,
            winner_team_id, loser_team_id, forfeit_team_id, double_forfeit, is_bye
     FROM bg_matches
     WHERE tournament_id = ? AND round_number = ?
     ORDER BY match_number ASC`,
    [tournamentId, round],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    bracket: String(row.bracket),
    status: String(row.status),
    teamAId: row.team1_id === null ? null : Number(row.team1_id),
    teamBId: row.team2_id === null ? null : Number(row.team2_id),
    winnerTeamId: row.winner_team_id === null ? null : Number(row.winner_team_id),
    loserTeamId: row.loser_team_id === null ? null : Number(row.loser_team_id),
    doubleForfeit: String(row.status) === "COMPLETED" && Number(row.double_forfeit ?? 0) === 1,
    hasScoreInput:
      Number(row.is_bye ?? 0) !== 1 &&
      row.team1_id !== null &&
      row.team2_id !== null &&
      (row.team1_score !== null ||
        row.team2_score !== null ||
        row.winner_team_id !== null ||
        row.forfeit_team_id != null ||
        Number(row.double_forfeit ?? 0) === 1 ||
        String(row.status) === "AWAITING_CONFIRMATION"),
  }));
}

/**
 * Pose un tour d'arbre final conformément au plan.
 *
 * Les rencontres déjà en place sont réécrites **sur place** quand le plan a la
 * même forme : leur identifiant est une adresse publique (lien profond vers un
 * match, diffusion, horaire annoncé), et la perdre pour un changement d'engagée
 * serait payer cher une correction de score. Sinon — le plan n'a plus le même
 * nombre de rencontres, ou plus les mêmes natures — le tour est refait à neuf.
 */
export async function writePlayoffRound(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
  plan: PlayoffRoundPlan,
  existing: PlayoffMatchRow[],
): Promise<void> {
  const sameShape =
    existing.length === plan.length &&
    plan.every((entry, index) => entry.bracket === existing[index].bracket);

  let reusable = existing;
  if (!sameShape) {
    if (existing.length > 0) {
      await conn.execute(`DELETE FROM bg_matches WHERE tournament_id = ? AND round_number = ?`, [
        tournamentId,
        round,
      ]);
    }
    reusable = [];
  }

  for (let index = 0; index < plan.length; index += 1) {
    const { bracket, pairing } = plan[index];
    const matchId =
      reusable[index]?.id ?? (await createMatch(conn, tournamentId, bracket, round, index + 1, 0));
    await writePlayoffPairing(conn, matchId, pairing);
  }

  await clearRewrittenReminders(conn, rewrittenPlayoffMatchIds(reusable, plan));
}

/**
 * Pose les engagées d'une rencontre d'arbre final.
 *
 * Le résultat est remis à zéro en même temps que les engagées : un tour
 * réécrit n'a pas été joué, et laisser un vainqueur derrière ferait avancer
 * l'arbre sur une rencontre qui n'existe plus.
 */
async function writePlayoffPairing(
  conn: PoolConnection,
  matchId: number,
  pairing: PlayoffRoundPlan[number]["pairing"],
): Promise<void> {
  const isBye = pairing.teamBId === null;
  await conn.execute(
    `UPDATE bg_matches SET
        team1_id = ?, team2_id = ?, status = ?, is_bye = ?,
        team1_score = ?, team2_score = ?,
        winner_team_id = ?, loser_team_id = NULL, forfeit_team_id = NULL,
        double_forfeit = 0
       WHERE id = ?`,
    [
      pairing.teamAId,
      pairing.teamBId,
      isBye ? "COMPLETED" : "READY",
      isBye ? 1 : 0,
      isBye ? 1 : null,
      isBye ? 0 : null,
      isBye ? pairing.teamAId : null,
      matchId,
    ],
  );
}

/**
 * Rencontres réutilisées dont le couple d'engagées **change**.
 *
 * Les rappels déjà partis nommaient les anciennes engagées : les effacer fait
 * repartir le cycle (`lib/server/tournaments/match-reminders.ts`), donc
 * réannoncer la rencontre à celles qui la disputent réellement — même
 * raisonnement qu'une manche reprogrammée.
 *
 * Seules les rencontres dont le couple **change** sont concernées. Un tour
 * périmé n'en compte souvent qu'une : effacer les rappels du tour entier
 * renverrait le même message privé aux joueurs d'une demi-finale que la
 * correction n'a pas touchée.
 */
function rewrittenPlayoffMatchIds(reusable: PlayoffMatchRow[], plan: PlayoffRoundPlan): number[] {
  return reusable
    .filter(
      (match, index) =>
        index < plan.length &&
        (match.teamAId !== plan[index].pairing.teamAId ||
          match.teamBId !== plan[index].pairing.teamBId),
    )
    .map((match) => match.id);
}

/**
 * Efface les rappels des rencontres réécrites.
 *
 * Sous `ignoreMissingTable` : la création de la table est avalée par un
 * `catch` dans `database/schema/standings.ts`, et une base à qui elle manque n'a aucun rappel
 * à effacer — ce n'est pas une raison de laisser l'arbre sur un tour périmé.
 */
async function clearRewrittenReminders(conn: PoolConnection, rewritten: number[]): Promise<void> {
  if (rewritten.length > 0) {
    await ignoreMissingTable(
      conn.execute(
        `DELETE FROM bg_match_reminders WHERE match_id IN (${rewritten.map(() => "?").join(", ")})`,
        rewritten,
      ),
    );
  }
}
