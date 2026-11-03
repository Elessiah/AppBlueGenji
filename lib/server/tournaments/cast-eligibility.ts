/**
 * La condition d'un caster — permission `live`, tag Discord certifié, compte
 * Battle.net rattaché en Overwatch seulement (`castBlockReason`, selon le jeu du match) — rejouée sur la ligne d'un compte
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
import type { TournamentGame } from "@/lib/shared/types";
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

/** `castBlockReason` sur la ligne d'un compte, pour le jeu du match ; `null` s'il peut caster. */
export function castEligibilityBlock(row: CastEligibilityFields | undefined, game: TournamentGame): CastBlock | null {
  // Un compte supprimé n'a plus aucun droit, même s'il garde ses colonnes de rôles.
  const live =
    row !== undefined &&
    Number(row.is_deleted) !== 1 &&
    can({ isAdmin: Boolean(Number(row.is_admin)), roles: sanitizePlatformRoles(row.platform_roles_json) }, "live");
  return castBlockReason(live, casterIdentityOf(row), game);
}

/** La condition d'un seul compte, relue sur l'exécuteur donné (verrou compris). */
export async function loadCastEligibility(
  executor: Executor,
  userId: number,
  game: TournamentGame,
): Promise<CastBlock | null> {
  const [rows] = await executor.execute<CastEligibilityRow[]>(
    `SELECT ${CAST_ELIGIBILITY_COLUMNS} FROM bg_users WHERE id = ? LIMIT 1`,
    [userId],
  );
  return castEligibilityBlock(rows[0], game);
}

/**
 * Les comptes de la liste qui remplissent encore la condition, en une lecture.
 * `lock` : lecture *courante* verrouillée en partage — celle d'une inscription,
 * qu'un instantané `REPEATABLE READ` rendrait aveugle à une permission retirée
 * pendant l'attente du verrou du match.
 */
export async function loadEligibleCasterIds(
  executor: Executor,
  userIds: readonly number[],
  game: TournamentGame,
  lock = false,
): Promise<Set<number>> {
  const blocks = await loadCastBlocks(executor, userIds, game, lock);
  return new Set([...blocks].filter(([, block]) => block === null).map(([id]) => id));
}

/**
 * La condition du cast de chaque compte de la liste, en une lecture : `null`
 * s'il peut caster, sinon ce qui manque (`castEligibilityBlock`) — un compte
 * introuvable ou supprimé n'a aucun droit : `NOT_CASTER`, sans avis possible
 * (il n'y a plus personne à prévenir). `lock` : comme {@link loadEligibleCasterIds}.
 */
export async function loadCastBlocks(
  executor: Executor,
  userIds: readonly number[],
  game: TournamentGame,
  lock = false,
): Promise<Map<number, CastBlock | null>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const [rows] = await executor.execute<(CastEligibilityRow & { id: number })[]>(
    `SELECT id, ${CAST_ELIGIBILITY_COLUMNS} FROM bg_users WHERE id IN (${ids.map(() => "?").join(", ")})${
      lock ? " LOCK IN SHARE MODE" : ""
    }`,
    ids,
  );
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  return new Map(ids.map((id) => [id, castEligibilityBlock(byId.get(id), game)]));
}

/**
 * `refereeBlockReason` sur la ligne d'un compte, pour le jeu du match ; `null`
 * s'il peut arbitrer (`docs/features/MATCH_REFEREE.md`) : permission
 * `tournaments`, tag Discord certifié, compte Battle.net rattaché en Overwatch
 * seulement — l'identité même d'un caster.
 */
export function refereeEligibilityBlock(
  row: CastEligibilityFields | undefined,
  game: TournamentGame,
): RefereeBlock | null {
  return refereeBlockReason(hasRefereePermission(row), casterIdentityOf(row), game);
}

/** Le compte relu porte-t-il la permission `tournaments` (celle d'un arbitre) ? Indépendant du jeu. */
function hasRefereePermission(row: CastEligibilityFields | undefined): boolean {
  return (
    row !== undefined &&
    can({ isAdmin: Boolean(Number(row.is_admin)), roles: sanitizePlatformRoles(row.platform_roles_json) }, "tournaments")
  );
}

/**
 * Le compte arbitre-t-il (permission `tournaments`, relue en base), sans
 * condition d'identité ni de jeu : ce que juge une opposition d'arbitre.
 */
export async function loadRefereePermission(executor: Executor, userId: number): Promise<boolean> {
  const [rows] = await executor.execute<CastEligibilityRow[]>(
    `SELECT ${CAST_ELIGIBILITY_COLUMNS} FROM bg_users WHERE id = ? LIMIT 1`,
    [userId],
  );
  return hasRefereePermission(rows[0]);
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
  game: TournamentGame,
  lock = false,
): Promise<RefereeBlock | null> {
  const [rows] = await executor.execute<CastEligibilityRow[]>(
    `SELECT ${CAST_ELIGIBILITY_COLUMNS} FROM bg_users WHERE id = ? LIMIT 1${lock ? " LOCK IN SHARE MODE" : ""}`,
    [userId],
  );
  return refereeEligibilityBlock(rows[0], game);
}

/**
 * Les comptes de la liste qui remplissent encore la condition d'arbitrage et
 * n'ont pas d'opposition retenue (`referee-objection.ts`), en une lecture.
 */
export async function loadEligibleRefereeIds(
  executor: Executor,
  userIds: readonly number[],
  game: TournamentGame,
): Promise<Set<number>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Set();
  const [rows] = await executor.execute<(CastEligibilityRow & { id: number })[]>(
    `SELECT id, ${CAST_ELIGIBILITY_COLUMNS} FROM bg_users
      WHERE id IN (${ids.map(() => "?").join(", ")}) AND referee_objection_at IS NULL`,
    ids,
  );
  return new Set(rows.filter((row) => refereeEligibilityBlock(row, game) === null).map((row) => Number(row.id)));
}

/** Ce que le verrou du lancement lit de l'arbitre désigné : sa condition d'arbitrage et son opposition. */
export type RefereeStanding = { block: RefereeBlock | null; objection: boolean };

/**
 * Condition d'arbitrage **et** opposition retenue de `userId`, en une seule
 * lecture de sa ligne (`lockLaunchMatch` lisait les deux séparément à chaque
 * verrou). Sans la colonne `referee_objection_at` (base pas encore migrée),
 * repli sur la seule condition, sans opposition — comme `refereeObjectionUpheld`.
 */
export async function loadRefereeStanding(
  executor: Executor,
  userId: number,
  game: TournamentGame,
): Promise<RefereeStanding> {
  try {
    const [rows] = await executor.execute<(CastEligibilityRow & { referee_objection_at: Date | string | null })[]>(
      `SELECT ${CAST_ELIGIBILITY_COLUMNS}, referee_objection_at FROM bg_users WHERE id = ? LIMIT 1`,
      [userId],
    );
    return { block: refereeEligibilityBlock(rows[0], game), objection: (rows[0]?.referee_objection_at ?? null) !== null };
  } catch (error) {
    if (!isUnknownColumnError(error)) throw error;
    return { block: await loadRefereeEligibility(executor, userId, game), objection: false };
  }
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
