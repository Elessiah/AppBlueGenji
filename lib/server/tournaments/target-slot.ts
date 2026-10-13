import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { noteDepartedEntrants } from "./departed-notices";
import { forgetMatchReminders } from "./reminder-marks";

/**
 * Pose une équipe dans le créneau qu'un résultat lui ouvre en aval.
 *
 * Seule implémentation : le report de score (`./scoring.ts`), les exemptions
 * (`./byes.ts`) et le retour en arrière (`./rollback.ts`, qui doit
 * **re-remplir** un plateau détaché) y passent tous — une seconde copie y
 * perdrait la règle d'antenne et celle des marques de rappel ci-dessous, et le
 * recalcul du statut avec elles.
 */
export async function pushTeamToTarget(
  connection: PoolConnection,
  targetMatchId: number | null,
  targetSlot: number | null,
  teamId: number | null,
): Promise<void> {
  if (!targetMatchId || !targetSlot || !teamId) return;

  const [beforeRows] = await connection.execute<
    (RowDataPacket & { team1_id: number | null; team2_id: number | null })[]
  >(
    `SELECT team1_id, team2_id FROM bg_matches WHERE id = ? LIMIT 1`,
    [targetMatchId],
  );
  const previousTeamId =
    targetSlot === 1 ? beforeRows[0]?.team1_id ?? null : beforeRows[0]?.team2_id ?? null;

  if (targetSlot === 1) {
    await connection.execute(`UPDATE bg_matches SET team1_id = ? WHERE id = ?`, [
      teamId,
      targetMatchId,
    ]);
  } else {
    await connection.execute(`UPDATE bg_matches SET team2_id = ? WHERE id = ?`, [
      teamId,
      targetMatchId,
    ]);
  }

  // Remplacer un engagé par un **autre** (correction d'un score amont) fait de
  // cette ligne une autre affiche : l'antenne ouverte sur l'ancienne ne vaut
  // plus, et la laisser ouverte rallumerait le bouton « Regarder le live » de
  // l'accueil vers une chaîne qui ne montre pas cette rencontre.
  // Remplir un créneau encore vide, en revanche, ne fait que matérialiser le
  // match prévu : une diffusion programmée à l'avance doit lui survivre.
  if (previousTeamId !== null && Number(previousTeamId) !== teamId) {
    await connection.execute(`UPDATE bg_matches SET live_started_at = NULL WHERE id = ?`, [
      targetMatchId,
    ]);
    // Les marques de rappel appartenaient aussi à l'ancienne affiche : la
    // nouvelle engagée n'a reçu aucun horaire (« reprogrammé, au lieu du … »
    // lui mentirait) et doit recevoir l'annonce — comme après un retour en
    // arrière (`./reminder-marks.ts`). L'engagée remplacée apprend, après le
    // commit, que l'horaire qu'elle avait reçu ne la concerne plus
    // (`./departed-notices`) — lu avant l'effacement.
    await noteDepartedEntrants(connection, [
      { matchId: targetMatchId, teamId: Number(previousTeamId), slot: targetSlot === 1 ? 1 : 2 },
    ]);
    await forgetMatchReminders(connection, [targetMatchId]);
  }

  const [rows] = await connection.execute<
    (RowDataPacket & { team1_id: number | null; team2_id: number | null })[]
  >(
    `SELECT team1_id, team2_id FROM bg_matches WHERE id = ? LIMIT 1`,
    [targetMatchId],
  );

  const row = rows[0];
  const nextStatus =
    row.team1_id !== null && row.team2_id !== null ? "READY" : "PENDING";

  await connection.execute(`UPDATE bg_matches SET status = ? WHERE id = ?`, [
    nextStatus,
    targetMatchId,
  ]);
}
