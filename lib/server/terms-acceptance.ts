/**
 * Acceptation des conditions d'utilisation — côté serveur.
 *
 * Deux écritures pour une acceptation : `bg_users.terms_version` (la dernière
 * version acceptée, qu'on consulte avant chaque geste de gestion) et une ligne
 * de `bg_terms_acceptances` (la **preuve** : quand, quelle version, depuis quel
 * écran). La règle de validité est celle du module pur
 * (`coversCurrentTerms`), jamais réécrite en SQL.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { parseRoles, toIso } from "@/lib/server/serialization";
import { hasTeamManagementRole } from "@/lib/shared/team-roles";
import {
  TERMS_ACCEPTANCE_REQUIRED,
  TERMS_VERSION,
  coversCurrentTerms,
  type TermsAcceptanceContext,
} from "@/lib/shared/terms-of-use";

type Executor = Pick<Pool | PoolConnection, "execute">;

/**
 * Enregistre que ce compte accepte la version courante.
 *
 * `GREATEST` : une acceptation ne fait jamais **reculer** la version retenue
 * (un onglet resté ouvert sur un code plus ancien ne défait pas une
 * acceptation plus récente). `is_deleted = 0` : un compte supprimé n'accepte
 * plus rien, et la preuve n'est alors pas écrite.
 *
 * @returns `false` si le compte n'existe plus (ou vient d'être supprimé).
 */
export async function recordTermsAcceptance(
  userId: number,
  context: TermsAcceptanceContext,
  executor?: Executor,
): Promise<boolean> {
  const db = executor ?? (await getDatabase());
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE bg_users
     SET terms_version = GREATEST(COALESCE(terms_version, 0), ?),
         terms_accepted_at = NOW()
     WHERE id = ? AND is_deleted = 0`,
    [TERMS_VERSION, userId],
  );
  if (Number(result.affectedRows) === 0) return false;
  await db.execute(
    `INSERT INTO bg_terms_acceptances (user_id, version, context) VALUES (?, ?, ?)`,
    [userId, TERMS_VERSION, context],
  );
  return true;
}

/** Version acceptée par le compte, `null` s'il ne les a jamais acceptées (ou n'existe pas). */
export async function loadAcceptedTermsVersion(userId: number, executor?: Executor): Promise<number | null> {
  const db = executor ?? (await getDatabase());
  const [rows] = await db.execute<(RowDataPacket & { terms_version: number | null })[]>(
    `SELECT terms_version FROM bg_users WHERE id = ? LIMIT 1`,
    [userId],
  );
  if (rows.length === 0 || rows[0].terms_version === null) return null;
  return Number(rows[0].terms_version);
}

export async function hasAcceptedCurrentTerms(userId: number, executor?: Executor): Promise<boolean> {
  return coversCurrentTerms(await loadAcceptedTermsVersion(userId, executor));
}

/**
 * Refuse un geste de gestion d'équipe tant que les conditions en vigueur n'ont
 * pas été acceptées.
 *
 * Posé **après** le contrôle du rôle, jamais avant : un joueur sans droit sur
 * l'équipe doit lire « interdit », pas une invitation à accepter des conditions
 * qui ne lui ouvriraient rien.
 *
 * @throws TERMS_ACCEPTANCE_REQUIRED
 */
export async function assertTermsAccepted(userId: number, executor?: Executor): Promise<void> {
  if (!(await hasAcceptedCurrentTerms(userId, executor))) {
    throw new Error(TERMS_ACCEPTANCE_REQUIRED);
  }
}

/**
 * Ce compte gère-t-il une équipe sans avoir accepté les conditions en vigueur ?
 *
 * C'est la question que pose la mise en page racine pour présenter les
 * conditions à qui vient de **recevoir** la main sur une équipe (propriété
 * transférée, rôle de gérant, fantôme confiée) : il n'a fait aucun geste qui
 * permette de lui demander son accord à ce moment-là, on le lui demande donc
 * au passage suivant. Une équipe dissoute, une entrée solo (sans membre) ne
 * comptent pas.
 */
export async function needsTermsForTeamManagement(userId: number): Promise<boolean> {
  const db = await getDatabase();
  const [users] = await db.execute<(RowDataPacket & { terms_version: number | null })[]>(
    `SELECT terms_version FROM bg_users WHERE id = ? AND is_deleted = 0 LIMIT 1`,
    [userId],
  );
  if (users.length === 0) return false;
  const version = users[0].terms_version === null ? null : Number(users[0].terms_version);
  if (coversCurrentTerms(version)) return false;

  // Les rôles sont relus puis jugés par `hasTeamManagementRole`, l'unique
  // implémentation de « qui gère une équipe » : réécrite en SQL, la règle
  // aurait une seconde version.
  const [memberships] = await db.execute<(RowDataPacket & { roles_json: unknown })[]>(
    `SELECT tm.roles_json
     FROM bg_team_members tm
     JOIN bg_teams t ON t.id = tm.team_id
     WHERE tm.user_id = ?
       AND tm.left_at IS NULL
       AND t.deleted_at IS NULL
       AND t.solo_user_id IS NULL`,
    [userId],
  );
  return memberships.some((row) => hasTeamManagementRole(parseRoles(row.roles_json)));
}

/** Les acceptations du compte, pour l'export de ses données. */
export async function listTermsAcceptances(
  userId: number,
): Promise<{ version: number; context: string; acceptedAt: string }[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & { version: number; context: string; accepted_at: Date | string })[]
  >(
    `SELECT version, context, accepted_at FROM bg_terms_acceptances WHERE user_id = ? ORDER BY accepted_at, id`,
    [userId],
  );
  return rows.map((row) => ({
    version: Number(row.version),
    context: row.context,
    acceptedAt: toIso(row.accepted_at) ?? String(row.accepted_at),
  }));
}

/**
 * Enregistre l'acceptation **seulement si** la version courante n'est pas déjà
 * couverte : une connexion case cochée, le soir d'après, ne doit pas écrire une
 * preuve de plus à chaque fois.
 */
export async function recordTermsAcceptanceIfBehind(
  userId: number,
  context: TermsAcceptanceContext,
): Promise<void> {
  if (await hasAcceptedCurrentTerms(userId)) return;
  await recordTermsAcceptance(userId, context);
}
