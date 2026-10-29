/**
 * La condition d'un caster — permission `live`, tag Discord certifié, compte
 * Battle.net rattaché (`castBlockReason`) — rejouée sur la ligne d'un compte
 * **déjà inscrit**. Contrôlée une fois à l'inscription, elle ne suffisait pas :
 * un compte privé de `live` ou d'identité gardait ses inscriptions, recevait les
 * contacts de la modale et pouvait encore déclarer son « Prêt ».
 *
 * Module sans dépendance au moteur, pour être lu aussi bien par le lancement
 * (`match-launch.ts`, `match-launch-info.ts`) que par le balayage des
 * notifications (`player-pushes.ts`). Les rôles sont relus en base, jamais pris
 * dans une session.
 *
 * Voir `docs/features/MATCH_LAUNCH.md`.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { castBlockReason, type CastBlock, type CasterIdentity } from "@/lib/shared/match-launch";
import { refereeBlockReason, type RefereeBlock } from "@/lib/shared/match-referee";
import { can, sanitizePlatformRoles } from "@/lib/shared/permissions";
import { isUnknownColumnError } from "@/lib/server/mysql-errors";
import { battletagFromBlizzard, type BattletagOriginFields } from "@/lib/server/battletag-origin";

type CasterIdentityFields = BattletagOriginFields & {
  discord_verified_at: Date | string | null;
  discord_pseudo: string | null;
  overwatch_battletag: string | null;
  is_deleted: number;
};

export type CasterIdentityRow = RowDataPacket & CasterIdentityFields;

/** Colonnes de `bg_users` que lit `castEligibilityBlock`. */
export type CastEligibilityFields = CasterIdentityFields & {
  is_admin: number;
  platform_roles_json: unknown;
};

export type CastEligibilityRow = RowDataPacket & CastEligibilityFields;

/** Ce qui s'exécute : une connexion ou le pool. */
type Executor = Pick<PoolConnection, "execute">;

const CAST_ELIGIBILITY_COLUMNS = `discord_verified_at, discord_pseudo, blizzard_sub, overwatch_battletag, overwatch_battletag_typed,
        is_deleted, is_admin, platform_roles_json`;

/** Identité d'un caster lue sur sa ligne ; un compte absent ou supprimé n'en a aucune. */
export function casterIdentityOf(row: CasterIdentityFields | undefined): CasterIdentity {
  if (!row || Number(row.is_deleted) === 1) return { discordVerified: false, blizzardLinked: false };
  return {
    discordVerified: row.discord_verified_at !== null && Boolean(row.discord_pseudo),
    // Un BattleTag tapé, gardé sous un Battle.net qui n'en donne aucun, n'est
    // pas vérifié (`battletag-origin.ts`).
    blizzardLinked: battletagFromBlizzard(row) && Boolean(row.overwatch_battletag),
  };
}

/** `castBlockReason` sur la ligne d'un compte ; `null` s'il peut caster. */
export function castEligibilityBlock(row: CastEligibilityFields | undefined): CastBlock | null {
  const live =
    row !== undefined &&
    can({ isAdmin: Boolean(Number(row.is_admin)), roles: sanitizePlatformRoles(row.platform_roles_json) }, "live");
  return castBlockReason(live, casterIdentityOf(row));
}

/** La condition d'un seul compte, relue sur l'exécuteur donné (verrou compris). */
export async function loadCastEligibility(executor: Executor, userId: number): Promise<CastBlock | null> {
  const [rows] = await executor.execute<CastEligibilityRow[]>(
    `SELECT ${CAST_ELIGIBILITY_COLUMNS} FROM bg_users WHERE id = ? LIMIT 1`,
    [userId],
  );
  return castEligibilityBlock(rows[0]);
}

/** Les comptes de la liste qui remplissent encore la condition, en une lecture. */
export async function loadEligibleCasterIds(
  executor: Executor,
  userIds: readonly number[],
): Promise<Set<number>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Set();
  const [rows] = await executor.execute<(CastEligibilityRow & { id: number })[]>(
    `SELECT id, ${CAST_ELIGIBILITY_COLUMNS} FROM bg_users WHERE id IN (${ids.map(() => "?").join(", ")})`,
    ids,
  );
  return new Set(rows.filter((row) => castEligibilityBlock(row) === null).map((row) => Number(row.id)));
}

/**
 * `refereeBlockReason` sur la ligne d'un compte ; `null` s'il peut arbitrer
 * (`docs/features/MATCH_REFEREE.md`) : permission `tournaments`, tag Discord
 * certifié, compte Battle.net rattaché — l'identité même d'un caster.
 */
export function refereeEligibilityBlock(row: CastEligibilityFields | undefined): RefereeBlock | null {
  const tournaments =
    row !== undefined &&
    can({ isAdmin: Boolean(Number(row.is_admin)), roles: sanitizePlatformRoles(row.platform_roles_json) }, "tournaments");
  return refereeBlockReason(tournaments, casterIdentityOf(row));
}

/**
 * La condition d'arbitrage d'un seul compte, relue sur l'exécuteur donné.
 * `lock` : lecture verrouillée (partagée) de la ligne du compte, pour une
 * désignation — la suppression du compte la tient en exclusif : ou bien la
 * désignation attend qu'elle soit validée et lit le compte supprimé (refusé),
 * ou bien la suppression attend la désignation et la retire (`withdrawUserCasts`).
 */
export async function loadRefereeEligibility(
  executor: Executor,
  userId: number,
  lock = false,
): Promise<RefereeBlock | null> {
  const [rows] = await executor.execute<CastEligibilityRow[]>(
    `SELECT ${CAST_ELIGIBILITY_COLUMNS} FROM bg_users WHERE id = ? LIMIT 1${lock ? " LOCK IN SHARE MODE" : ""}`,
    [userId],
  );
  return refereeEligibilityBlock(rows[0]);
}

/** Les comptes de la liste qui remplissent encore la condition d'arbitrage, en une lecture. */
export async function loadEligibleRefereeIds(
  executor: Executor,
  userIds: readonly number[],
): Promise<Set<number>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Set();
  const [rows] = await executor.execute<(CastEligibilityRow & { id: number })[]>(
    `SELECT id, ${CAST_ELIGIBILITY_COLUMNS} FROM bg_users WHERE id IN (${ids.map(() => "?").join(", ")})`,
    ids,
  );
  return new Set(rows.filter((row) => refereeEligibilityBlock(row) === null).map((row) => Number(row.id)));
}

/**
 * L'opposition d'arbitre de ce compte est-elle retenue
 * (`bg_users.referee_objection_at`, `docs/features/MATCH_REFEREE.md`) ? Elle
 * lui ferme tout arbitrage. `lock` : lecture verrouillée en partage — celle
 * d'une désignation, que l'écriture exclusive de l'opposition sérialise. Une
 * colonne absente (son `ALTER` a échoué) ne retient rien.
 */
export async function refereeObjectionUpheld(executor: Executor, userId: number, lock = false): Promise<boolean> {
  try {
    const [rows] = await executor.execute<(RowDataPacket & { referee_objection_at: Date | string | null })[]>(
      `SELECT referee_objection_at FROM bg_users WHERE id = ? LIMIT 1${lock ? " LOCK IN SHARE MODE" : ""}`,
      [userId],
    );
    return (rows[0]?.referee_objection_at ?? null) !== null;
  } catch (error) {
    if (isUnknownColumnError(error)) return false;
    throw error;
  }
}
