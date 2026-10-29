import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { normalizePseudo, parseRoles } from "@/lib/server/serialization";
import { closeUserStreams } from "@/lib/server/session-streams";
import { publishStaffAction } from "@/lib/server/staff-audit";
import type { StaffActor } from "@/lib/shared/log-privacy";
import { ROLE_LABELS, type PlatformRole, sanitizePlatformRoles } from "@/lib/shared/permissions";
import type { TeamRole } from "@/lib/shared/types";

/**
 * Remplace l'intégralité des rôles de permission d'un utilisateur.
 * Le rôle `ADMIN` est persisté via la colonne `is_admin` ; les autres rôles
 * cumulables (ARBITRE, COMMUNITY_MANAGER, RECRUTEUR) dans `platform_roles_json`.
 * Réservé aux administrateurs (contrôle d'accès effectué côté route API).
 *
 * @returns la liste normalisée des rôles effectivement enregistrés.
 */
export async function setUserRoles(
  targetUserId: number,
  roles: PlatformRole[],
  actorUserId: number,
): Promise<PlatformRole[]> {
  const sanitized = sanitizePlatformRoles(roles);
  const isAdmin = sanitized.includes("ADMIN");
  // Ne persister en JSON que les rôles cumulables non-ADMIN (ADMIN ⇔ is_admin).
  const nonAdminRoles = sanitized.filter((role) => role !== "ADMIN");

  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    // L'**auteur** doit être encore administrateur au moment d'écrire : la
    // session lue par la route date d'avant l'`await`, et deux administrateurs
    // qui se retiraient l'administration l'un l'autre au même instant passaient
    // tous deux — plus aucun administrateur, plateforme fermée.
    //
    // Les deux lignes (auteur et cible) se verrouillent donc **ensemble**, en
    // première instruction de la transaction, par une requête sans jointure
    // (MariaDB, production : ni `FOR UPDATE OF`, ni lecture non verrouillée
    // d'une table jointe à un `UPDATE`). InnoDB les prend dans l'ordre de la
    // clé primaire : deux administrateurs qui se modifient l'un l'autre
    // s'attendent au lieu de s'interbloquer, et le second relit l'état validé
    // par le premier (lecture verrouillée, aucune vue figée avant elle — rien
    // pour `innodb_snapshot_isolation` à refuser).
    //
    // Une ligne morte n'est pas rendue : un rôle de plateforme posé sur une
    // ligne anonymisée — invisible de `getCurrentUser`, mais listé à l'écran
    // des rôles, qui rend les comptes supprimés — se refuse en `USER_NOT_FOUND`,
    // et un auteur supprimé ou rétrogradé en `NOT_ADMIN`.
    const [rows] = await connection.execute<(RowDataPacket & { id: number; is_admin: number })[]>(
      `SELECT id, is_admin FROM bg_users WHERE id IN (?, ?) AND is_deleted = 0 ORDER BY id FOR UPDATE`,
      [actorUserId, targetUserId],
    );
    const actor = rows.find((row) => Number(row.id) === actorUserId);
    if (!actor || Number(actor.is_admin) !== 1) throw new Error("NOT_ADMIN");
    if (!rows.some((row) => Number(row.id) === targetUserId)) throw new Error("USER_NOT_FOUND");

    await connection.execute<ResultSetHeader>(
      `UPDATE bg_users SET is_admin = ?, platform_roles_json = ? WHERE id = ? AND is_deleted = 0`,
      [isAdmin ? 1 : 0, JSON.stringify(nonAdminRoles), targetUserId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }

  // Un flux SSE de tournoi ne lit les droits qu'à son ouverture : il gardait
  // le palier, l'aperçu du plateau et l'accès aux tournois non publiés d'un
  // rôle retiré tant que l'onglet restait ouvert. Le fermer fait reconnecter
  // le client, et la route recalcule le contexte du lecteur sur les rôles
  // enregistrés — retrait comme ajout (`session-streams.ts`).
  closeUserStreams(targetUserId);

  return sanitized;
}

/**
 * Un administrateur règle **ses propres** rôles de plateforme (ADMIN-SELF-ROLES).
 *
 * Seuls les rôles cumulables (`platform_roles_json`) changent : `ADMIN` doit
 * figurer dans la sélection (`CANNOT_REMOVE_OWN_ADMIN` sinon) et la colonne
 * `is_admin` n'est **jamais écrite** ici. Se retirer l'administration reste le
 * geste d'un autre administrateur — sans quoi le dernier d'entre eux pourrait
 * fermer la plateforme à tout le monde, lui compris.
 *
 * La condition `is_admin = 1` tranche la **course** avec une rétrogradation
 * concurrente : la route a lu le droit dans la session, un autre administrateur
 * peut le retirer avant cette écriture. Réécrire `is_admin = 1` ici aurait
 * annulé sa décision ; la condition fait échouer l'écriture à la place
 * (`NOT_ADMIN`, que la route rend en `403 FORBIDDEN`). Zéro ligne appariée
 * veut dire « l'état a changé entre les deux », jamais « rien à modifier »
 * (mysql2 pose `FOUND_ROWS`). Une seule ligne, la sienne, verrouillée par une
 * instruction seule : rien à ordonner avec {@link setUserRoles}.
 *
 * @returns la liste normalisée des rôles enregistrés, `ADMIN` en tête.
 */
export async function setOwnPlatformRoles(
  adminUserId: number,
  roles: PlatformRole[],
): Promise<PlatformRole[]> {
  const sanitized = sanitizePlatformRoles(roles);
  if (!sanitized.includes("ADMIN")) throw new Error("CANNOT_REMOVE_OWN_ADMIN");
  const scopedRoles = sanitized.filter((role) => role !== "ADMIN");

  const db = await getDatabase();
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE bg_users SET platform_roles_json = ? WHERE id = ? AND is_deleted = 0 AND is_admin = 1`,
    [JSON.stringify(scopedRoles), adminUserId],
  );
  if (result.affectedRows === 0) throw new Error("NOT_ADMIN");

  // Mêmes flux à fermer que pour un autre compte : un rôle d'arbitre retiré
  // ne doit pas survivre dans un onglet de tournoi resté ouvert.
  closeUserStreams(adminUserId);

  return sanitized;
}

/** La ligne du journal du staff sur Discord : aucun compte nommé, ni l'auteur. */
export const ROLES_CHANGE_DISCORD_LINE = "🛡️ Rôles de plateforme d'un compte modifiés par le staff.";

/**
 * La ligne des journaux du serveur (pm2) : le compte visé par son seul
 * identifiant, les rôles enregistrés, et — ajouté par `staffAuditLine` —
 * l'auteur. Un administrateur qui règle les siens est dit tel.
 */
export function rolesChangeAuditLine(targetUserId: number, roles: readonly PlatformRole[], self: boolean): string {
  const target = self ? `de son propre compte (#${targetUserId})` : `du compte #${targetUserId}`;
  const saved = roles.length > 0 ? roles.map((role) => ROLE_LABELS[role]).join(", ") : "aucun";
  return `🛡️ Rôles de plateforme ${target} enregistrés : ${saved}.`;
}

/**
 * Publie l'enregistrement des rôles d'un compte : anonyme sur Discord, nominatif
 * dans pm2 (`publishStaffAction`). Appelé après l'écriture seulement — un refus
 * ne laisse aucune trace.
 */
export function publishRolesChange(
  actor: StaffActor,
  targetUserId: number,
  roles: readonly PlatformRole[],
): void {
  publishStaffAction(
    ROLES_CHANGE_DISCORD_LINE,
    actor,
    rolesChangeAuditLine(targetUserId, roles, targetUserId === actor.id),
  );
}

/**
 * Résout un pseudo vers le compte **vivant** qui le porte.
 *
 * Ses deux appelants nomment un joueur pour l'**attacher à une équipe** —
 * `inviteToTeam` et la reprise d'une équipe fantôme, qui en fait un `OWNER`. Un
 * compte anonymisé garde une ligne et donc un pseudo (d'emprunt) :
 * sans la condition, il restait invitable, et une demande d'adhésion déposée
 * avant la suppression le faisait même **rejoindre** le roster séance tenante —
 * soit rattacher à une équipe vivante un compte dont on vient de promettre
 * qu'il ne servirait plus à rien. Pire côté fantôme : il en devenait
 * propriétaire, sans personne pour ouvrir la session qui l'administre.
 *
 * Le filtre est posé ici et pas chez les appelants parce que c'est **l'unique**
 * traduction « pseudo → compte à rattacher », et que les deux traitent déjà le
 * `null` en `USER_NOT_FOUND` — ce qui est exactement ce qu'un compte supprimé
 * doit être pour eux.
 */
export async function getUserIdByPseudo(pseudo: string): Promise<number | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE pseudo = ? AND is_deleted = 0 LIMIT 1`,
    [normalizePseudo(pseudo)],
  );

  return rows.length === 0 ? null : Number(rows[0].id);
}

/**
 * Ne garde d'une liste de rôles d'équipe que les valeurs connues, dédupliquées.
 *
 * **Aucun repli** : une entrée vide ou entièrement invalide rend une liste
 * vide, et c'est à l'appelant de dire ce qu'il en fait — `MISSING_ROLE` quand
 * on modifie un membre existant, `DPS` quand on en accueille un nouveau. La
 * fonction repliait jusqu'ici sur `["OWNER"]`, ce que ses appelants
 * annulaient aussitôt en filtrant ce rôle : le repli n'a donc jamais rien
 * accordé, mais il attendait le premier appelant qui oublierait le filtre pour
 * faire d'un corps de requête vide une prise de propriété.
 */
export function sanitizeRoles(roles: TeamRole[]): TeamRole[] {
  return Array.from(new Set(parseRoles(roles)));
}
