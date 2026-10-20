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
 *
 * Trois valeurs : `0` jamais choisi (défaut), `1` « Ne plus afficher », `2`
 * réaffichée depuis « Mon profil » (`DELETE /api/recruitment/modal-dismiss`).
 * Seul un compte à `0` reçoit le choix d'un cookie (report à la connexion,
 * rattrapage de la mise en page) : un autre navigateur qui garde un vieux
 * cookie ne recouvre pas un « réafficher » fait ailleurs — il ne tait la
 * modale que chez lui.
 */
import { getDatabase } from "@/lib/server/database";
import { isUnknownColumnError } from "@/lib/server/mysql-errors";
import { recruitmentModalOffInBrowser } from "@/lib/shared/recruitment";

/** Jamais choisi : la modale s'ouvre, un cookie « Ne plus afficher » peut être reporté. */
export const RECRUITMENT_MODAL_DEFAULT = 0;
/** « Ne plus afficher ». */
export const RECRUITMENT_MODAL_OFF = 1;
/** Réaffichée depuis « Mon profil » : plus aucun cookie n'est reporté sur le compte. */
export const RECRUITMENT_MODAL_BACK_ON = 2;

/** « Ne plus afficher » est-il posé sur le compte ? Absente : non (défaut). */
export function recruitmentModalOff(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return Number(value) === RECRUITMENT_MODAL_OFF;
}

/** La modale a-t-elle été réaffichée depuis « Mon profil » ? */
export function recruitmentModalBackOn(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return Number(value) === RECRUITMENT_MODAL_BACK_ON;
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
 * Réaffiche la modale (« Mon profil ») : le compte passe à
 * {@link RECRUITMENT_MODAL_BACK_ON}, qui ne reçoit plus le cookie d'aucun
 * navigateur. Une seule instruction ; rend `true` si une ligne vivante le porte.
 */
export async function recordRecruitmentModalBackOn(userId: number): Promise<boolean> {
  if (!Number.isInteger(userId) || userId <= 0) return false;
  const db = await getDatabase();
  const [result] = await db.execute(
    `UPDATE bg_users SET recruitment_modal_off = ${RECRUITMENT_MODAL_BACK_ON} WHERE id = ? AND is_deleted = 0`,
    [userId],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/**
 * Reporte sur le compte le « Ne plus afficher » d'un cookie (connexion,
 * rattrapage) — seulement s'il n'a **jamais** été choisi : condition dans
 * l'instruction même, pour qu'un « réafficher » écrit entre la lecture de la
 * session et ce report ne soit pas recouvert.
 */
export async function carryRecruitmentModalOffFromBrowser(userId: number): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) return;
  const db = await getDatabase();
  await db.execute(
    `UPDATE bg_users SET recruitment_modal_off = ${RECRUITMENT_MODAL_OFF}
     WHERE id = ? AND is_deleted = 0 AND recruitment_modal_off = ${RECRUITMENT_MODAL_DEFAULT}`,
    [userId],
  );
}

/**
 * Fenêtre pendant laquelle un même compte n'est rattrapé qu'une fois par
 * processus : tant que l'écriture échoue (verrou, base en lecture seule),
 * chaque chargement complet — et chaque onglet restauré au démarrage du
 * navigateur — en relancerait une, avec son erreur au journal.
 */
export const RECRUITMENT_MODAL_HEAL_WINDOW_MS = 10 * 60 * 1000;

/**
 * Plafond de la mémoire des tentatives : atteint avec des tentatives toutes
 * récentes, le rattrapage attend qu'une sorte de la fenêtre (rien n'est perdu,
 * le cookie reste et le compte est rattrapé plus tard).
 */
export const RECRUITMENT_MODAL_HEAL_MAX_TRACKED = 5000;

/**
 * Dernière tentative de rattrapage, par compte (ce processus seulement), dans
 * l'ordre des tentatives : une entrée est retirée avant d'être reposée, si bien
 * que les plus anciennes sont en tête et que l'élagage s'arrête à la première
 * encore dans la fenêtre.
 */
const healAttempts = new Map<number, number>();

/**
 * Colonne absente (son `ALTER` a échoué au démarrage) : chaque rattrapage
 * échouerait à coup sûr. Éteint jusqu'au redémarrage, qui rejoue l'`ALTER`.
 */
let healColumnMissing = false;

function healAttemptedRecently(userId: number, now: number): boolean {
  const last = healAttempts.get(userId);
  if (last !== undefined && now - last < RECRUITMENT_MODAL_HEAL_WINDOW_MS) return true;
  healAttempts.delete(userId);
  for (const [id, at] of healAttempts) {
    if (now - at < RECRUITMENT_MODAL_HEAL_WINDOW_MS) break;
    healAttempts.delete(id);
  }
  if (healAttempts.size >= RECRUITMENT_MODAL_HEAL_MAX_TRACKED) return true;
  healAttempts.set(userId, now);
  return false;
}

/**
 * Rattrapage, à chaque chargement complet d'une page connectée (la mise en
 * page racine ne se rend pas à la navigation client) : le cookie porte le
 * choix mais le compte ne l'a pas (l'écriture du clic, tentée une fois, a échoué :
 * réseau coupé). Sans lui, le compte n'en saurait rien avant la prochaine
 * connexion — jusqu'à trente jours de modale sur les autres appareils. Même
 * règle que le report de `createSession` (compte jamais décidé seulement) ;
 * jamais attendu ni bloquant. Une fois posé — ou la modale réaffichée depuis
 * « Mon profil » —, l'état lu avec la session éteint le rattrapage ; d'ici là,
 * au plus une tentative par compte et par
 * {@link RECRUITMENT_MODAL_HEAL_WINDOW_MS} (mémoire bornée à
 * {@link RECRUITMENT_MODAL_HEAL_MAX_TRACKED} comptes), et plus aucune si la
 * colonne manque. Rend `true` si une écriture est partie.
 */
export function healRecruitmentModalOff(
  {
    userId,
    accountOff,
    accountBackOn,
    browserCookie,
  }: Readonly<{
    userId: number | undefined;
    accountOff: boolean | undefined;
    accountBackOn: boolean | undefined;
    browserCookie: string | undefined;
  }>,
  // Horloge monotone : un recul de l'heure système (NTP, reprise de VM) ne
  // fige pas la fenêtre ni l'élagage.
  now: number = performance.now(),
): boolean {
  if (healColumnMissing) return false;
  if (userId === undefined || accountOff === true || accountBackOn === true) return false;
  if (!recruitmentModalOffInBrowser(browserCookie)) return false;
  if (healAttemptedRecently(userId, now)) return false;
  void carryRecruitmentModalOffFromBrowser(userId).catch((error) => {
    if (isUnknownColumnError(error)) {
      healColumnMissing = true;
      return;
    }
    console.error("[recruitment] recruitment modal opt-out catch-up failed:", error);
  });
  return true;
}
