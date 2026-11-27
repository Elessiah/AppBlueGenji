/**
 * Oppositions aux annonces GETI (RGPD, art. 21) — `docs/features/GETI_INFO.md`
 * § Opposition.
 *
 * Supprimer une ligne de `bg_geti_posts` ne suffit pas : le bot repousse
 * l'annonce à chaque rattrapage tant que le message reste sur Discord. Une
 * opposition s'enregistre donc dans `bg_geti_objections` — sur un **auteur**
 * (son identifiant Discord : toutes ses annonces, présentes et à venir) ou sur
 * un **message** (une annonce) —, et `upsertGetiPosts` écarte tout ce qu'elle
 * couvre. Une opposition sur un auteur tient jusqu'à sa levée ; une opposition
 * sur un message est effacée par la purge horaire une fois passée la plus
 * longue durée de garde (le message ne peut plus revenir : il est trop vieux).
 *
 * Module serveur.
 */
import type { GetiExecutor } from "@/lib/server/geti/posts";
import { parseSnowflake } from "@/lib/server/geti/wire";
import { GETI_RETENTION_MAX_DAYS } from "@/lib/shared/geti/ingest";

/** Ce que vise une opposition : toutes les annonces d'un auteur, ou une seule. */
export const GETI_OBJECTION_KINDS = ["author", "message"] as const;
export type GetiObjectionKind = (typeof GETI_OBJECTION_KINDS)[number];

/** Une opposition : son objet, et l'identifiant Discord visé. */
export type GetiObjection = { kind: GetiObjectionKind; targetId: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Colonne de `bg_geti_posts` que vise chaque sorte d'opposition. */
const TARGET_COLUMN: Readonly<Record<GetiObjectionKind, "author_id" | "message_id">> = {
  author: "author_id",
  message: "message_id",
};

/**
 * Lit le corps d'une opposition : `{ authorId }` ou `{ messageId }`, l'un des
 * deux exactement, identifiant Discord ; `null` sinon.
 */
export function parseGetiObjection(body: unknown): GetiObjection | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const authorId = record.authorId === undefined ? undefined : parseSnowflake(record.authorId);
  const messageId = record.messageId === undefined ? undefined : parseSnowflake(record.messageId);
  if (authorId === null || messageId === null) return null;
  if (authorId !== undefined && messageId === undefined) return { kind: "author", targetId: authorId };
  if (messageId !== undefined && authorId === undefined) return { kind: "message", targetId: messageId };
  return null;
}

function affected(result: unknown): number {
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

/**
 * Enregistre une opposition et retire sur-le-champ les annonces qu'elle couvre ;
 * rend le nombre d'annonces retirées. Rejouer la même opposition ne la double pas.
 */
export async function recordGetiObjection(executor: GetiExecutor, objection: GetiObjection): Promise<number> {
  await executor.execute(
    `INSERT INTO bg_geti_objections (kind, target_id) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE created_at = CURRENT_TIMESTAMP`,
    [objection.kind, objection.targetId],
  );
  const [result] = await executor.execute(
    `DELETE FROM bg_geti_posts WHERE ${TARGET_COLUMN[objection.kind]} = ?`,
    [objection.targetId],
  );
  return affected(result);
}

/**
 * Lève une opposition (l'auteur la retire) ; rend `true` si elle existait. Les
 * annonces encore sur Discord reviennent au prochain rattrapage du bot.
 */
export async function liftGetiObjection(executor: GetiExecutor, objection: GetiObjection): Promise<boolean> {
  const [result] = await executor.execute(`DELETE FROM bg_geti_objections WHERE kind = ? AND target_id = ?`, [
    objection.kind,
    objection.targetId,
  ]);
  return affected(result) > 0;
}

/**
 * Retire, parmi les messages d'un lot qui vient d'être écrit, ceux qu'une
 * opposition couvre (par leur identifiant, ou celui de leur auteur) ; rend le
 * nombre de lignes retirées. Joué **après** l'écriture : une opposition
 * enregistrée pendant que le lot s'écrit l'emporte quel que soit l'ordre.
 */
export async function withholdObjectedGetiPosts(executor: GetiExecutor, messageIds: readonly string[]): Promise<number> {
  if (messageIds.length === 0) return 0;
  const [result] = await executor.execute(
    `DELETE FROM bg_geti_posts
      WHERE message_id IN (${messageIds.map(() => "?").join(", ")})
        AND (message_id IN (SELECT target_id FROM bg_geti_objections WHERE kind = 'message')
          OR author_id IN (SELECT target_id FROM bg_geti_objections WHERE kind = 'author'))`,
    [...messageIds],
  );
  return affected(result);
}

/**
 * Efface les oppositions sur un message plus vieilles que la plus longue durée
 * de garde : publié avant elle, le message est refusé de toute façon. Celles
 * sur un auteur restent jusqu'à leur levée.
 */
export async function purgeStaleGetiObjections(executor: GetiExecutor, now: number = Date.now()): Promise<number> {
  const [result] = await executor.execute(`DELETE FROM bg_geti_objections WHERE kind = 'message' AND created_at < ?`, [
    new Date(now - GETI_RETENTION_MAX_DAYS * DAY_MS),
  ]);
  return affected(result);
}
