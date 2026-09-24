/**
 * Rediffusion d'un match : écriture du lien YouTube.
 *
 * La règle vit dans le module pur `lib/shared/match-replay.ts` ; ce fichier ne
 * fait que l'appliquer à la base et publier l'événement qui réveille les pages
 * ouvertes — le lien voyage ensuite dans l'instantané du flux SSE, comme le
 * reste du plateau.
 *
 * Réservé à la permission `live` (admin, arbitre, caster) : c'est la suite
 * naturelle du cast, que pose déjà ce même public.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { canHaveReplay, normalizeReplayUrl } from "@/lib/shared/match-replay";
import type { MatchStatus } from "@/lib/shared/types";
import { publishUpdatedEvent } from "./notifications";

type MatchReplayRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  status: MatchStatus;
  team1_id: number | null;
  team2_id: number | null;
  forfeit_team_id: number | null;
  double_forfeit: number | null;
};

/**
 * Pose (ou efface) le lien de rediff d'un match.
 *
 * `null` ou chaîne vide valent effacement, et l'effacement est **toujours**
 * permis — y compris sur un match rouvert par un retour en arrière : retirer un
 * lien posé par erreur ne doit dépendre d'aucun état. Poser un lien exige en
 * revanche une rencontre réellement disputée (`canHaveReplay`), sans quoi le
 * bandeau annoncerait la rediff d'un match qui n'a pas eu lieu.
 *
 * @returns le lien normalisé, ou `null` s'il a été effacé.
 * @throws `INVALID_REPLAY_URL` | `MATCH_NOT_FOUND` | `MATCH_NOT_REPLAYABLE`
 */
export async function setMatchReplayUrl(
  matchId: number,
  rawUrl: string | null,
): Promise<string | null> {
  const blank = rawUrl === null || rawUrl.trim() === "";
  const replayUrl = blank ? null : normalizeReplayUrl(rawUrl);
  if (!blank && replayUrl === null) throw new Error("INVALID_REPLAY_URL");

  const db = await getDatabase();
  const [rows] = await db.execute<MatchReplayRow[]>(
    `SELECT id, tournament_id, status, team1_id, team2_id, forfeit_team_id, double_forfeit
       FROM bg_matches WHERE id = ? LIMIT 1`,
    [matchId],
  );
  if (rows.length === 0) throw new Error("MATCH_NOT_FOUND");
  const row = rows[0];

  if (replayUrl !== null) {
    const replayable = canHaveReplay({
      status: row.status,
      team1Id: row.team1_id === null ? null : Number(row.team1_id),
      team2Id: row.team2_id === null ? null : Number(row.team2_id),
      forfeitTeamId: row.forfeit_team_id === null ? null : Number(row.forfeit_team_id),
      doubleForfeit: Number(row.double_forfeit ?? 0) === 1,
    });
    if (!replayable) throw new Error("MATCH_NOT_REPLAYABLE");
  }

  // Le statut est relu dans la condition : un retour en arrière passé entre la
  // lecture et l'écriture rouvrirait le match, et le lien s'y poserait quand
  // même. L'effacement, lui, n'a aucune condition d'état.
  const [result] = await db.execute(
    replayUrl === null
      ? `UPDATE bg_matches SET replay_url = NULL WHERE id = ?`
      : `UPDATE bg_matches SET replay_url = ? WHERE id = ? AND status = 'COMPLETED'`,
    replayUrl === null ? [matchId] : [replayUrl, matchId],
  );
  if (replayUrl !== null && Number((result as { affectedRows?: number }).affectedRows ?? 0) === 0) {
    throw new Error("MATCH_NOT_REPLAYABLE");
  }

  publishUpdatedEvent(Number(row.tournament_id));
  return replayUrl;
}
