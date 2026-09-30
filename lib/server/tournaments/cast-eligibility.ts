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
import { can, sanitizePlatformRoles } from "@/lib/shared/permissions";

export type CasterIdentityRow = RowDataPacket & {
  discord_verified_at: Date | string | null;
  discord_pseudo: string | null;
  blizzard_sub: string | null;
  overwatch_battletag: string | null;
  is_deleted: number;
};

/** Colonnes de `bg_users` que lit `castEligibilityBlock`. */
export type CastEligibilityRow = CasterIdentityRow & {
  is_admin: number;
  platform_roles_json: unknown;
};

/** Ce qui s'exécute : une connexion ou le pool. */
type Executor = Pick<PoolConnection, "execute">;

const CAST_ELIGIBILITY_COLUMNS = `discord_verified_at, discord_pseudo, blizzard_sub, overwatch_battletag,
        is_deleted, is_admin, platform_roles_json`;

/** Identité d'un caster lue sur sa ligne ; un compte absent ou supprimé n'en a aucune. */
export function casterIdentityOf(row: CasterIdentityRow | undefined): CasterIdentity {
  if (!row || Number(row.is_deleted) === 1) return { discordVerified: false, blizzardLinked: false };
  return {
    discordVerified: row.discord_verified_at !== null && Boolean(row.discord_pseudo),
    blizzardLinked: row.blizzard_sub !== null && Boolean(row.overwatch_battletag),
  };
}

/** `castBlockReason` sur la ligne d'un compte ; `null` s'il peut caster. */
export function castEligibilityBlock(row: CastEligibilityRow | undefined): CastBlock | null {
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
