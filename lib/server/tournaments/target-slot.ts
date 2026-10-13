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
  const before = beforeRows[0];
  if (!before) return;
  const previousTeamId = targetSlot === 1 ? before.team1_id : before.team2_id;
  const column = targetSlot === 1 ? "team1_id" : "team2_id";
  const otherColumn = targetSlot === 1 ? "team2_id" : "team1_id";

  // Remplacer un engagé par un **autre** (correction d'un score amont) fait de
  // cette ligne une autre affiche : l'antenne ouverte sur l'ancienne ne vaut
  // plus, et la laisser ouverte rallumerait le bouton « Regarder le live » de
  // l'accueil vers une chaîne qui ne montre pas cette rencontre.
  // Remplir un créneau encore vide, en revanche, ne fait que matérialiser le
  // match prévu : une diffusion programmée à l'avance doit lui survivre.
  const replacing = previousTeamId !== null && Number(previousTeamId) !== teamId;
  // Une seule écriture : la place, le statut — calculé par la base sur la
  // valeur **actuelle** de l'autre place, pas sur la lecture d'avant, qu'une
  // image figée de la transaction pourrait avoir laissée en arrière — et, sur
  // un remplacement, l'antenne.
  await connection.execute(
    `UPDATE bg_matches
        SET ${column} = ?, status = IF(${otherColumn} IS NULL, 'PENDING', 'READY')${replacing ? ", live_started_at = NULL" : ""}
      WHERE id = ?`,
    [teamId, targetMatchId],
  );

  if (replacing) {
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
}
