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
import { recruitmentModalOffInBrowser } from "@/lib/shared/recruitment";

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

/**
 * Rattrapage, à chaque page connectée : le cookie du navigateur porte le
 * choix mais le compte ne l'a pas (l'écriture du clic a échoué deux fois,
 * réseau coupé). Sans lui, le compte n'en saurait rien avant la prochaine
 * connexion — jusqu'à trente jours de modale sur les autres appareils. Même
 * règle que le report de `createSession` ; jamais attendu ni bloquant. Une
 * fois posé, le drapeau lu avec la session éteint le rattrapage. Rend `true`
 * si une écriture est partie.
 */
export function healRecruitmentModalOff({
  userId,
  accountOff,
  browserCookie,
}: Readonly<{ userId: number | undefined; accountOff: boolean | undefined; browserCookie: string | undefined }>): boolean {
  if (userId === undefined || accountOff === true || !recruitmentModalOffInBrowser(browserCookie)) return false;
  void recordRecruitmentModalOff(userId).catch((error) =>
    console.error("[recruitment] recruitment modal opt-out catch-up failed:", error),
  );
  return true;
}
