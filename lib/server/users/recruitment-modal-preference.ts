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
 * Fenêtre pendant laquelle un même compte n'est rattrapé qu'une fois par
 * processus : tant que l'écriture échoue (verrou, base en lecture seule),
 * chaque chargement complet — et chaque onglet restauré au démarrage du
 * navigateur — en relancerait une, avec son erreur au journal.
 */
export const RECRUITMENT_MODAL_HEAL_WINDOW_MS = 10 * 60 * 1000;

/** Au-delà, les tentatives échues sont oubliées (mémoire bornée). */
const HEAL_ATTEMPTS_PRUNE_AT = 5000;

/** Dernière tentative de rattrapage, par compte (ce processus seulement). */
const healAttempts = new Map<number, number>();

function healAttemptedRecently(userId: number, now: number): boolean {
  const last = healAttempts.get(userId);
  if (last !== undefined && now - last < RECRUITMENT_MODAL_HEAL_WINDOW_MS) return true;
  if (healAttempts.size >= HEAL_ATTEMPTS_PRUNE_AT) {
    for (const [id, at] of healAttempts) {
      if (now - at >= RECRUITMENT_MODAL_HEAL_WINDOW_MS) healAttempts.delete(id);
    }
  }
  healAttempts.set(userId, now);
  return false;
}

/**
 * Rattrapage, à chaque chargement complet d'une page connectée (la mise en
 * page racine ne se rend pas à la navigation client) : le cookie porte le
 * choix mais le compte ne l'a pas (l'écriture du clic, tentée une fois, a échoué :
 * réseau coupé). Sans lui, le compte n'en saurait rien avant la prochaine
 * connexion — jusqu'à trente jours de modale sur les autres appareils. Même
 * règle que le report de `createSession` ; jamais attendu ni bloquant. Une
 * fois posé, le drapeau lu avec la session éteint le rattrapage ; d'ici là,
 * au plus une tentative par compte et par
 * {@link RECRUITMENT_MODAL_HEAL_WINDOW_MS}. Rend `true` si une écriture est
 * partie.
 */
export function healRecruitmentModalOff(
  {
    userId,
    accountOff,
    browserCookie,
  }: Readonly<{ userId: number | undefined; accountOff: boolean | undefined; browserCookie: string | undefined }>,
  now: number = Date.now(),
): boolean {
  if (userId === undefined || accountOff === true || !recruitmentModalOffInBrowser(browserCookie)) return false;
  if (healAttemptedRecently(userId, now)) return false;
  void recordRecruitmentModalOff(userId).catch((error) =>
    console.error("[recruitment] recruitment modal opt-out catch-up failed:", error),
  );
  return true;
}
