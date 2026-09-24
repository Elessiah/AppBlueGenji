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
import { cached, invalidateCached } from "@/lib/server/cache";
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
  invalidateCached(termsNeedKey(userId));
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
 *
 * Posée à **chaque page**, elle tient en une requête — version acceptée et
 * rôles en cours, par une jointure — et sa réponse est gardée
 * `TERMS_NEED_TTL_MS` par compte : un rôle reçu à l'instant fait paraître la
 * modale au plus une demi-minute plus tard, ce qui ne change rien à la règle
 * (les gestes de gestion sont refusés côté serveur dans l'intervalle).
 * L'acceptation vide la réponse gardée.
 */
export async function needsTermsForTeamManagement(userId: number): Promise<boolean> {
  return cached(termsNeedKey(userId), TERMS_NEED_TTL_MS, async () => {
    const db = await getDatabase();
    const [rows] = await db.execute<
      (RowDataPacket & { terms_version: number | null; roles_json: unknown; team_id: number | null })[]
    >(
      `SELECT u.terms_version, tm.roles_json, t.id AS team_id
       FROM bg_users u
       LEFT JOIN bg_team_members tm ON tm.user_id = u.id AND tm.left_at IS NULL
       LEFT JOIN bg_teams t ON t.id = tm.team_id AND t.deleted_at IS NULL AND t.solo_user_id IS NULL
       WHERE u.id = ? AND u.is_deleted = 0`,
      [userId],
    );
    if (rows.length === 0) return false;
    const version = rows[0].terms_version === null ? null : Number(rows[0].terms_version);
    if (coversCurrentTerms(version)) return false;
    // Les rôles sont jugés par `hasTeamManagementRole`, l'unique implémentation
    // de « qui gère une équipe » : réécrite en SQL, la règle aurait une seconde
    // version.
    return rows.some((row) => row.team_id !== null && hasTeamManagementRole(parseRoles(row.roles_json)));
  });
}

/** Durée pendant laquelle la réponse de `needsTermsForTeamManagement` est gardée. */
export const TERMS_NEED_TTL_MS = 30_000;

function termsNeedKey(userId: number): string {
  return `terms-need:${userId}`;
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
