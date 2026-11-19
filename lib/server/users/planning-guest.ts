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
import { releaseWithServerLockWait, rollbackKeepingError } from "@/lib/server/tournaments/lock-wait";
import type { StaffActor } from "@/lib/shared/log-privacy";
import { sanitizePlatformRoles, type PlatformRole } from "@/lib/shared/permissions";

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
  const head = saved.changed ? "passé invité (hors planning)" : "déjà invité : sortie du planning rejouée";
  return `🎙️ Compte #${targetUserId} ${head}${detail}.`;
}

/** Les rôles d'un compte qui peut être marqué invité : le drapeau sort un caster ou un prod du planning. */
const GUEST_ELIGIBLE_ROLES: readonly PlatformRole[] = ["CASTER", "PROD"];

/** Le compte tient un rôle de caster ou de prod (rôles cumulables enregistrés). */
export function holdsGuestEligibleRole(rolesJson: unknown): boolean {
  return sanitizePlatformRoles(rolesJson).some((role) => GUEST_ELIGIBLE_ROLES.includes(role));
}

type LockedUserRow = RowDataPacket & {
  id: number;
  is_admin: number | null;
  platform_roles_json: unknown;
  is_guest_staff: number | null;
};

/**
 * Pose (`guest = true`) ou retire le drapeau « invité » d'un compte vivant,
 * par le staff `actorId`. Erreurs par code : `USER_NOT_FOUND` (aucun compte,
 * ou compte supprimé), `NOT_ADMIN` (l'auteur n'est plus administrateur — seul
 * `ADMIN` accorde `roles` — au moment d'écrire : la session lue par la route
 * date d'avant l'`await`), `PLANNING_GUEST_ADMIN` (poser le drapeau sur un
 * administrateur : il garde tous les droits, `planning` compris — la sortie du
 * planning ne ferait qu'effacer ses créneaux), `PLANNING_GUEST_NOT_STAFF`
 * (poser le drapeau sur un compte qui ne tient ni `CASTER` ni `PROD` : la
 * marque ne vise qu'eux, comme le disent `/rgpd` et le registre). Auteur et
 * cible se verrouillent ensemble (`FOR UPDATE`, ordre de la clé primaire, comme
 * `setUserRoles`) : une rétrogradation ou une promotion concurrente attend
 * l'écriture ou la refuse. L'écriture est conditionnelle (`is_guest_staff <>
 * ?`) : deux enregistrements concurrents ne la font qu'une fois. Un drapeau
 * posé — ou reposé à l'identique : la sortie se rejoue, pour reprendre une
 * sortie restée incomplète — libère ensuite ses attributions et
 * disponibilités à venir (`releaseGuestPlanning`, désistement ordinaire),
 * après l'écriture : le remplaçant cherché ne le compte déjà plus parmi les
 * membres.
 */
export async function setPlanningGuest(
  targetUserId: number,
  guest: boolean,
  actorId: number,
  now: number = Date.now(),
): Promise<PlanningGuestSaveResult> {
  const db = await getDatabase();
  // Lus d'abord, sans verrou ni transaction : un identifiant inconnu ne pose aucun verrou d'intervalle.
  // L'auteur est jugé avant la cible : un compte qui n'est plus administrateur
  // reçoit `NOT_ADMIN` pour tout identifiant, sans apprendre lequel existe.
  const [rows] = await db.execute<(RowDataPacket & { id: number; is_admin: number | null })[]>(
    `SELECT id, is_admin FROM bg_users WHERE id IN (?, ?) AND is_deleted = 0`,
    [actorId, targetUserId],
  );
  const actorRow = rows.find((row) => Number(row.id) === actorId);
  if (!actorRow || Number(actorRow.is_admin ?? 0) !== 1) throw new Error("NOT_ADMIN");
  if (!rows.some((row) => Number(row.id) === targetUserId)) throw new Error("USER_NOT_FOUND");
  const flag = guest ? 1 : 0;
  const connection = await db.getConnection();
  let changed = false;
  try {
    await connection.beginTransaction();
    // Première instruction, sans jointure (MariaDB) : l'auteur et la cible, verrouillés ensemble.
    const [locked] = await connection.execute<LockedUserRow[]>(
      `SELECT id, is_admin, platform_roles_json, is_guest_staff FROM bg_users WHERE id IN (?, ?) AND is_deleted = 0 ORDER BY id FOR UPDATE`,
      [actorId, targetUserId],
    );
    const actor = locked.find((row) => Number(row.id) === actorId);
    if (!actor || Number(actor.is_admin ?? 0) !== 1) throw new Error("NOT_ADMIN");
    const target = locked.find((row) => Number(row.id) === targetUserId);
    if (!target) throw new Error("USER_NOT_FOUND");
    const flagged = Number(target.is_guest_staff ?? 0) === 1;
    if (guest && Number(target.is_admin ?? 0) === 1) throw new Error("PLANNING_GUEST_ADMIN");
    // Un drapeau déjà posé se rejoue même si le compte a perdu depuis son rôle de caster ou de prod.
    if (guest && !flagged && !holdsGuestEligibleRole(target.platform_roles_json)) throw new Error("PLANNING_GUEST_NOT_STAFF");
    if (flagged !== guest) {
      const [written] = await connection.execute<ResultSetHeader>(
        `UPDATE bg_users SET is_guest_staff = ? WHERE id = ? AND is_deleted = 0`,
        [flag, targetUserId],
      );
      changed = Number(written.affectedRows ?? 0) > 0;
    }
    await connection.commit();
  } catch (error) {
    await rollbackKeepingError(connection);
    throw error;
  } finally {
    await releaseWithServerLockWait(connection);
  }
  const release = guest ? await releaseGuestPlanning(targetUserId, actorId, now) : null;
  return { guest, changed, release };
}

/** Une sortie rejouée a encore quitté, laissé ou effacé quelque chose. */
function releaseDidSomething(release: GuestRelease | null): boolean {
  return release !== null && release.withdrawn + release.failed + release.availabilityCleared > 0;
}

/** Ligne Discord, anonyme, d'une sortie rejouée (drapeau déjà posé). */
export const PLANNING_GUEST_REPLAY_DISCORD_LINE = "🎙️ Sortie du planning d'un compte invité rejouée par le staff.";

/**
 * Publie le changement au journal du staff : anonyme sur Discord, nominatif
 * dans pm2 (`publishStaffAction`). Un `guest: true` reposé à l'identique est
 * publié s'il a encore quitté, laissé ou effacé quelque chose (sortie
 * rejouée : les désistements ont un auteur à nommer) ; rien pour un
 * enregistrement sans écart ni effet.
 */
export function publishPlanningGuestChange(actor: StaffActor, targetUserId: number, saved: PlanningGuestSaveResult): boolean {
  if (!saved.changed) {
    if (!saved.guest || !releaseDidSomething(saved.release)) return false;
    publishStaffAction(PLANNING_GUEST_REPLAY_DISCORD_LINE, actor, {
      auditLine: planningGuestAuditLine(targetUserId, saved),
      category: "admin",
    });
    return true;
  }
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
