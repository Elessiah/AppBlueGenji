import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { resolveRoles } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import { normalizePseudo, parseRoles } from "@/lib/server/serialization";
import { closeUserStreams } from "@/lib/server/session-streams";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { releaseWithServerLockWait, rollbackKeepingError } from "@/lib/server/tournaments/lock-wait";
import type { StaffActor } from "@/lib/shared/log-privacy";
import {
  ROLE_LABELS,
  diffPlatformRoles,
  roleChangeNeedsConfirmation,
  sanitizePlatformRoles,
  type PlatformRole,
  type PlatformRoleChange,
} from "@/lib/shared/permissions";
import type { TeamRole } from "@/lib/shared/types";

/** Ce qu'un enregistrement de rôles a fait : les rôles lus sous le verrou, puis ceux enregistrés. */
export interface RolesSaveResult {
  /** Les rôles enregistrés, normalisés. */
  roles: PlatformRole[];
  /** Les rôles du compte juste avant l'écriture, lus sous le verrou de la ligne. */
  previous: PlatformRole[];
}

/**
 * Les rôles d'une ligne `bg_users`, lus comme la session et la fiche les lisent
 * (`resolveRoles`) : la comparaison à `expected` porte sur ce que l'écran a montré.
 */
function storedRoles(row: { is_admin: unknown; platform_roles_json: unknown }): PlatformRole[] {
  return resolveRoles(Number(row.is_admin) === 1, row.platform_roles_json);
}

/** Vrai quand deux listes portent les mêmes rôles, sans égard à l'ordre ni aux doublons. */
function sameRoles(a: readonly PlatformRole[], b: readonly PlatformRole[]): boolean {
  return !roleChangeNeedsConfirmation(diffPlatformRoles(a, b));
}

/**
 * Refuse en `ROLES_CHANGED` un enregistrement préparé sur des rôles qui ne
 * sont plus ceux du compte : sans ce contrôle, la dernière écriture gagnait —
 * un administrateur qui enregistrait depuis une fiche ouverte avant qu'un
 * autre réglage n'aboutisse l'effaçait sans le savoir. `expected` absent : pas
 * de contrôle (appel qui ne connaît pas l'état lu).
 */
function assertExpectedRoles(expected: readonly PlatformRole[] | undefined, previous: readonly PlatformRole[]): void {
  if (expected !== undefined && !sameRoles(sanitizePlatformRoles(expected), previous)) throw new Error("ROLES_CHANGED");
}

/**
 * Remplace l'intégralité des rôles de permission d'un utilisateur.
 * Le rôle `ADMIN` est persisté via la colonne `is_admin` ; les autres rôles
 * cumulables (ARBITRE, COMMUNITY_MANAGER, RECRUTEUR) dans `platform_roles_json`.
 * Réservé aux administrateurs (contrôle d'accès effectué côté route API).
 *
 * `expected` : les rôles affichés quand l'auteur a ouvert la fiche ; s'ils ne
 * sont plus ceux lus sous le verrou, rien n'est écrit (`ROLES_CHANGED`).
 *
 * @returns les rôles enregistrés (normalisés) et ceux qu'ils remplacent.
 */
export async function setUserRoles(
  targetUserId: number,
  roles: PlatformRole[],
  actorUserId: number,
  expected?: readonly PlatformRole[],
): Promise<RolesSaveResult> {
  const sanitized = sanitizePlatformRoles(roles);
  const isAdmin = sanitized.includes("ADMIN");
  // Ne persister en JSON que les rôles cumulables non-ADMIN (ADMIN ⇔ is_admin).
  const nonAdminRoles = sanitized.filter((role) => role !== "ADMIN");

  const db = await getDatabase();
  // Cible lue **avant** la transaction, sans verrou : un identifiant qui ne
  // désigne aucune ligne (au-delà du plus grand) poserait, sous REPEATABLE
  // READ, un verrou d'intervalle en fin d'index qui retiendrait les
  // inscriptions le temps de la transaction. Seules des lignes existantes se
  // verrouillent ensuite (verrous d'enregistrement, par la clé primaire).
  const [target] = await db.execute<RowDataPacket[]>(`SELECT id FROM bg_users WHERE id = ? LIMIT 1`, [targetUserId]);
  if (target.length === 0) throw new Error("USER_NOT_FOUND");
  const connection = await db.getConnection();
  let previous: PlatformRole[];
  let unchanged = false;
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
    const [rows] = await connection.execute<
      (RowDataPacket & { id: number; is_admin: number; platform_roles_json: unknown })[]
    >(
      `SELECT id, is_admin, platform_roles_json FROM bg_users WHERE id IN (?, ?) AND is_deleted = 0 ORDER BY id FOR UPDATE`,
      [actorUserId, targetUserId],
    );
    const actor = rows.find((row) => Number(row.id) === actorUserId);
    if (!actor || Number(actor.is_admin) !== 1) throw new Error("NOT_ADMIN");
    const targetRow = rows.find((row) => Number(row.id) === targetUserId);
    if (!targetRow) throw new Error("USER_NOT_FOUND");
    // Lus sous le verrou : ce sont eux que l'écriture remplace, et que le
    // journal compare aux rôles enregistrés (accordés / retirés).
    previous = storedRoles(targetRow);
    assertExpectedRoles(expected, previous);

    // Rien à changer : ni écriture, ni flux fermés (un enregistrement identique
    // reconnectait pour rien tous les flux du compte). Une ligne héritée qui
    // porte `ADMIN` dans son JSON se réécrit toujours : `ADMIN` ne vit que dans
    // `is_admin`, et l'enregistrement est ce qui la remet en forme.
    unchanged = sameRoles(previous, sanitized) && !sanitizePlatformRoles(targetRow.platform_roles_json).includes("ADMIN");
    if (!unchanged) {
      await connection.execute<ResultSetHeader>(
        `UPDATE bg_users SET is_admin = ?, platform_roles_json = ? WHERE id = ? AND is_deleted = 0`,
        [isAdmin ? 1 : 0, JSON.stringify(nonAdminRoles), targetUserId],
      );
    }
    await connection.commit();
  } catch (error) {
    // Un `ROLLBACK` raté (connexion tombée) détruit la connexion au retour
    // plutôt que de la rendre au pool avec une transaction peut-être ouverte.
    await rollbackKeepingError(connection);
    throw error;
  } finally {
    await releaseWithServerLockWait(connection);
  }

  // Un flux SSE de tournoi ne lit les droits qu'à son ouverture : il gardait
  // le palier, l'aperçu du plateau et l'accès aux tournois non publiés d'un
  // rôle retiré tant que l'onglet restait ouvert. Le fermer fait reconnecter
  // le client, et la route recalcule le contexte du lecteur sur les rôles
  // enregistrés — retrait comme ajout (`session-streams.ts`).
  if (!unchanged) closeUserStreams(targetUserId);

  return { roles: sanitized, previous };
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
 * La ligne est verrouillée en **première instruction** de la transaction
 * (`FOR UPDATE`, une table, sans jointure — MariaDB) : la course avec une
 * rétrogradation concurrente se tranche sur l'état validé. Plus administrateur
 * (`is_admin` retiré par un autre entre la lecture de la session et
 * l'écriture) : `NOT_ADMIN`, que la route rend en `403 FORBIDDEN` ; compte
 * supprimé : `USER_NOT_FOUND`. Réécrire `is_admin = 1` aurait annulé la
 * décision de l'autre administrateur — la colonne n'est jamais écrite. Une
 * seule ligne, la sienne : rien à ordonner avec {@link setUserRoles}.
 *
 * `expected` : les rôles affichés à l'ouverture de « Mes rôles » ; un autre
 * administrateur qui les a changés entre-temps fait refuser l'écriture
 * (`ROLES_CHANGED`) au lieu de voir son réglage effacé.
 *
 * @returns les rôles enregistrés (normalisés, `ADMIN` en tête) et ceux qu'ils remplacent.
 */
export async function setOwnPlatformRoles(
  adminUserId: number,
  roles: PlatformRole[],
  expected?: readonly PlatformRole[],
): Promise<RolesSaveResult> {
  const sanitized = sanitizePlatformRoles(roles);
  if (!sanitized.includes("ADMIN")) throw new Error("CANNOT_REMOVE_OWN_ADMIN");
  const scopedRoles = sanitized.filter((role) => role !== "ADMIN");

  const db = await getDatabase();
  const connection = await db.getConnection();
  let previous: PlatformRole[];
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<
      (RowDataPacket & { is_admin: number; is_deleted: number; platform_roles_json: unknown })[]
    >(`SELECT is_admin, is_deleted, platform_roles_json FROM bg_users WHERE id = ? FOR UPDATE`, [adminUserId]);
    const row = rows[0];
    if (!row || Number(row.is_deleted) === 1) throw new Error("USER_NOT_FOUND");
    if (Number(row.is_admin) !== 1) throw new Error("NOT_ADMIN");
    previous = storedRoles(row);
    assertExpectedRoles(expected, previous);
    await connection.execute<ResultSetHeader>(
      `UPDATE bg_users SET platform_roles_json = ? WHERE id = ? AND is_deleted = 0 AND is_admin = 1`,
      [JSON.stringify(scopedRoles), adminUserId],
    );
    await connection.commit();
  } catch (error) {
    await rollbackKeepingError(connection);
    throw error;
  } finally {
    await releaseWithServerLockWait(connection);
  }

  // Aucun flux fermé : `is_admin` n'est jamais écrit ici, et un administrateur
  // tient toutes les permissions (`can`) — le contexte de ses flux de tournoi
  // ne change pas ; les fermer ne ferait que les reconnecter tous.
  return { roles: sanitized, previous };
}

/** La ligne du journal du staff sur Discord : aucun compte nommé, ni l'auteur. */
export const ROLES_CHANGE_DISCORD_LINE = "🛡️ Rôles de plateforme d'un compte modifiés par le staff.";
/** Variante pour une administration **accordée** : une élévation ne passe pas pour un rôle d'arbitre. */
export const ADMIN_GRANTED_DISCORD_LINE = "🛡️ Administration de la plateforme accordée à un compte par le staff.";
/** Variante pour une administration **retirée**. */
export const ADMIN_REMOVED_DISCORD_LINE = "🛡️ Administration de la plateforme retirée à un compte par le staff.";

/** La ligne Discord anonyme d'un changement : celle de l'administration dès qu'elle change. */
export function rolesChangeDiscordLine(change: PlatformRoleChange): string {
  if (change.granted.includes("ADMIN")) return ADMIN_GRANTED_DISCORD_LINE;
  if (change.removed.includes("ADMIN")) return ADMIN_REMOVED_DISCORD_LINE;
  return ROLES_CHANGE_DISCORD_LINE;
}

function roleLabels(roles: readonly PlatformRole[]): string {
  return roles.length > 0 ? roles.map((role) => ROLE_LABELS[role]).join(", ") : "aucun";
}

/**
 * La ligne des journaux du serveur (pm2) : le compte visé par son seul
 * identifiant, les rôles accordés et retirés, ceux enregistrés, et — ajouté
 * par `staffAuditLine` — l'auteur. Un administrateur qui règle les siens est dit tel.
 */
export function rolesChangeAuditLine(targetUserId: number, saved: RolesSaveResult, self: boolean): string {
  const target = self ? `de son propre compte (#${targetUserId})` : `du compte #${targetUserId}`;
  const change = diffPlatformRoles(saved.previous, saved.roles);
  return (
    `🛡️ Rôles de plateforme ${target} — accordés : ${roleLabels(change.granted)} ; ` +
    `retirés : ${roleLabels(change.removed)} ; enregistrés : ${roleLabels(saved.roles)}.`
  );
}

/**
 * Publie l'enregistrement des rôles d'un compte : anonyme sur Discord, nominatif
 * dans pm2 (`publishStaffAction`). Appelé après l'écriture seulement — un refus
 * ne laisse aucune trace — et **seulement si un rôle a été accordé ou retiré** :
 * « Enregistrer » sans écart ne remplit pas le journal du staff.
 *
 * @returns vrai si une ligne a été publiée.
 */
export function publishRolesChange(actor: StaffActor, targetUserId: number, saved: RolesSaveResult): boolean {
  const change = diffPlatformRoles(saved.previous, saved.roles);
  if (!roleChangeNeedsConfirmation(change)) return false;
  publishStaffAction(rolesChangeDiscordLine(change), actor, {
    auditLine: rolesChangeAuditLine(targetUserId, saved, targetUserId === actor.id),
    category: "admin",
  });
  return true;
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
 * vide, et c'est à l'appelant de dire ce qu'il en fait — aucun rôle (permis)
 * quand on modifie un membre existant, `DPS` pour une invitation d'avant les
 * rôles. La fonction repliait jusqu'ici sur `["OWNER"]`, ce que ses appelants
 * annulaient aussitôt en filtrant ce rôle : le repli n'a donc jamais rien
 * accordé, mais il attendait le premier appelant qui oublierait le filtre pour
 * faire d'un corps de requête vide une prise de propriété.
 */
export function sanitizeRoles(roles: TeamRole[]): TeamRole[] {
  return Array.from(new Set(parseRoles(roles)));
}
