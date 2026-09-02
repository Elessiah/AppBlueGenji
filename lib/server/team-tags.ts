/**
 * Sigle d'équipe, côté serveur : validation de forme puis unicité.
 *
 * La forme est décidée par le module pur `lib/shared/team-tag.ts`, partagé avec
 * les formulaires. Reste ici ce que seul le serveur peut faire : vérifier que
 * le sigle est libre, et **traduire la violation d'unicité MySQL**.
 *
 * Les deux contrôles ne font pas double emploi. Le `SELECT` préalable donne un
 * refus lisible dans le cas courant ; l'index unique, lui, est le seul juge en
 * cas de course — deux créations simultanées passent toutes deux le `SELECT`,
 * et c'est l'`INSERT` de la seconde qui échoue. Un service qui écrit un sigle
 * doit donc faire les deux : appeler `assertTeamTagAvailable` avant, et
 * envelopper son écriture dans `mapTeamTagConflict`.
 */
import type { RowDataPacket } from "mysql2/promise";
import { TEAM_TAG_ALREADY_USED, checkTeamTag } from "@/lib/shared/team-tag";

/** Nom de l'index unique posé par la migration (`lib/server/database.ts`). */
const TAG_INDEX = "uniq_bg_teams_tag";

/**
 * Ce que ce module attend d'une connexion : `execute`. Un `Pool` comme une
 * `PoolConnection` le fournissent, si bien que le contrôle d'unicité s'exécute
 * indifféremment hors transaction ou dans celle de la création.
 */
type Executor = {
  execute<T extends RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
};

/**
 * Forme canonique du sigle saisi, ou `null` s'il n'y en a pas.
 * Lève le code de refus du module pur (`TEAM_TAG_TOO_SHORT`, …), que les routes
 * traduisent en 400.
 */
export function resolveTeamTag(raw: string | null | undefined): string | null {
  const check = checkTeamTag(raw);
  if (!check.ok) throw new Error(check.reason);
  return check.tag;
}

/**
 * Refuse un sigle déjà porté par une autre équipe. `excludeTeamId` laisse une
 * équipe garder le sien lors d'une mise à jour.
 *
 * La comparaison est faite en base : la collation par défaut d'`utf8mb4` étant
 * insensible à la casse, « bg » y trouve bien « BG » — le sigle est de toute
 * façon normalisé en majuscules avant d'arriver ici.
 */
export async function assertTeamTagAvailable(
  executor: Executor,
  tag: string | null,
  excludeTeamId?: number,
): Promise<void> {
  if (tag === null) return;

  const params: unknown[] = [tag];
  let sql = `SELECT id FROM bg_teams WHERE tag = ?`;
  if (excludeTeamId !== undefined) {
    sql += ` AND id <> ?`;
    params.push(excludeTeamId);
  }
  sql += ` LIMIT 1`;

  const [rows] = await executor.execute<(RowDataPacket & { id: number })[]>(sql, params);
  if (rows.length > 0) throw new Error(TEAM_TAG_ALREADY_USED);
}

/**
 * Vrai si l'erreur MySQL est la violation de l'index unique des sigles.
 *
 * `bg_teams` porte deux uniques (le nom, le sigle) : distinguer les deux est ce
 * qui évite d'annoncer « nom déjà utilisé » à qui vient de saisir un sigle pris.
 */
export function isTeamTagConflict(error: unknown): boolean {
  const err = error as { code?: string; message?: string; sqlMessage?: string };
  if (err?.code !== "ER_DUP_ENTRY") return false;
  return `${err.sqlMessage ?? ""} ${err.message ?? ""}`.includes(TAG_INDEX);
}

/**
 * Rejoue une écriture en traduisant la collision d'unicité du sigle en
 * `TEAM_TAG_ALREADY_USED` — le même code que le `SELECT` préalable, pour que
 * la course et le cas courant se répondent pareil.
 */
export async function mapTeamTagConflict<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isTeamTagConflict(error)) throw new Error(TEAM_TAG_ALREADY_USED);
    throw error;
  }
}
