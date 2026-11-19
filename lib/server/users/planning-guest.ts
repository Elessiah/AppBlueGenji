/**
 * Casters et prods **invités** (`docs/features/CAST_PLANNING.md` § Invités) :
 * le drapeau `bg_users.is_guest_staff`, posé par le staff qui tient la
 * permission `roles` depuis la fiche du joueur. Un invité garde ses rôles et
 * leurs droits (aperçu, antenne, cast d'un match) mais perd la permission
 * `planning` (`can()`), sauf s'il est administrateur : il n'est plus membre du
 * planning, ni proposé, ni prévenu, ni lecteur de `/planning`.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { failureReason } from "@/lib/server/failure-reason";
import { releaseGuestPlanning, type GuestRelease } from "@/lib/server/planning/withdrawal";
import { publishStaffAction } from "@/lib/server/staff-audit";
import type { StaffActor } from "@/lib/shared/log-privacy";

/** Ce que l'enregistrement a fait. */
export type PlanningGuestSaveResult = {
  guest: boolean;
  /** Le drapeau a réellement changé (un enregistrement identique n'écrit rien). */
  changed: boolean;
  /** Avec un drapeau posé : la sortie du planning à venir (`releaseGuestPlanning`) ; `null` sinon. */
  release: GuestRelease | null;
};

/** Lignes Discord, anonymes : ni le compte visé, ni l'auteur. */
export const PLANNING_GUEST_ON_DISCORD_LINE = "🎙️ Un compte passe invité (hors planning) par le staff.";
export const PLANNING_GUEST_OFF_DISCORD_LINE = "🎙️ Un compte invité rejoint le planning par le staff.";

/** Ligne pm2 : le compte visé par son identifiant (l'auteur est ajouté par `staffAuditLine`). */
export function planningGuestAuditLine(targetUserId: number, saved: PlanningGuestSaveResult): string {
  if (!saved.guest) return `🎙️ Compte #${targetUserId} retiré des invités : de nouveau membre du planning.`;
  const release = saved.release;
  const detail = release
    ? ` — attributions à venir quittées : ${release.withdrawn}, laissées en place : ${release.failed}, disponibilités effacées : ${release.availabilityCleared}`
    : "";
  return `🎙️ Compte #${targetUserId} passé invité (hors planning)${detail}.`;
}

/**
 * Pose (`guest = true`) ou retire le drapeau « invité » d'un compte vivant.
 * Erreur par code : `USER_NOT_FOUND` (aucun compte, ou compte supprimé).
 * L'écriture est conditionnelle (`is_guest_staff <> ?`) : deux enregistrements
 * concurrents ne sortent le compte du planning qu'une fois. Un drapeau posé
 * libère ensuite ses attributions et disponibilités à venir
 * (`releaseGuestPlanning`, désistement ordinaire), après l'écriture — le
 * remplaçant cherché ne le compte déjà plus parmi les membres.
 */
export async function setPlanningGuest(targetUserId: number, guest: boolean, now: number = Date.now()): Promise<PlanningGuestSaveResult> {
  const db = await getDatabase();
  // Lu d'abord, sans verrou ni transaction : un identifiant inconnu ne pose aucun verrou d'intervalle.
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE id = ? AND is_deleted = 0 LIMIT 1`,
    [targetUserId],
  );
  if (rows.length === 0) throw new Error("USER_NOT_FOUND");
  const flag = guest ? 1 : 0;
  const [written] = await db.execute<ResultSetHeader>(
    `UPDATE bg_users SET is_guest_staff = ? WHERE id = ? AND is_deleted = 0 AND is_guest_staff <> ?`,
    [flag, targetUserId, flag],
  );
  const changed = Number(written.affectedRows ?? 0) > 0;
  const release = changed && guest ? await releaseGuestPlanning(targetUserId, now) : null;
  return { guest, changed, release };
}

/**
 * Publie le changement au journal du staff : anonyme sur Discord, nominatif
 * dans pm2 (`publishStaffAction`). Rien pour un enregistrement sans écart.
 */
export function publishPlanningGuestChange(actor: StaffActor, targetUserId: number, saved: PlanningGuestSaveResult): boolean {
  if (!saved.changed) return false;
  publishStaffAction(saved.guest ? PLANNING_GUEST_ON_DISCORD_LINE : PLANNING_GUEST_OFF_DISCORD_LINE, actor, {
    auditLine: planningGuestAuditLine(targetUserId, saved),
    category: "admin",
  });
  return true;
}

/**
 * Le drapeau d'un compte, pour la fiche lue par le staff `roles`. `null` si la
 * lecture échoue (colonne absente, panne) : la fiche n'offre alors pas la case,
 * plutôt que d'afficher un état faux.
 */
export async function readPlanningGuest(userId: number): Promise<boolean | null> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<(RowDataPacket & { is_guest_staff: number | null })[]>(
      `SELECT is_guest_staff FROM bg_users WHERE id = ? LIMIT 1`,
      [userId],
    );
    return Number(rows[0]?.is_guest_staff ?? 0) === 1;
  } catch (error) {
    console.error("[planning-guest] lecture du drapeau impossible", failureReason(error));
    return null;
  }
}
