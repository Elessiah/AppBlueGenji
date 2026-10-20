/**
 * « Ne plus afficher » sur la modale d'arrivée du recrutement, gardé sur le
 * compte (`bg_users.recruitment_modal_off`, `docs/features/RECRUITMENT.md`
 * § Ne plus afficher).
 *
 * Lu avec la session (`getCurrentUser`, aucune requête de plus par page),
 * posé par `POST /api/recruitment/modal-dismiss` ou, à la connexion, reporté
 * depuis le cookie du navigateur (`createSession`). Une préférence
 * d'affichage, sans autre usage ; remise au défaut à l'anonymisation,
 * rendue dans l'export des données.
 */
import { getDatabase } from "@/lib/server/database";

/** Une valeur lue en base ramenée à un booléen ; absente : la modale s'ouvre (défaut). */
export function recruitmentModalOff(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return Number(value) !== 0;
}

/**
 * Pose le choix sur le compte. Une seule instruction, sans lecture préalable ;
 * un compte supprimé n'est jamais touché. Rend `true` si une ligne vivante le
 * porte désormais — déjà posé compris (`affectedRows` compte les lignes
 * trouvées, comme pour `recordMatchDmPreference`).
 */
export async function recordRecruitmentModalOff(userId: number): Promise<boolean> {
  if (!Number.isInteger(userId) || userId <= 0) return false;
  const db = await getDatabase();
  const [result] = await db.execute(
    `UPDATE bg_users SET recruitment_modal_off = 1 WHERE id = ? AND is_deleted = 0`,
    [userId],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}
