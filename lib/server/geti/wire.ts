/**
 * Lecture des corps poussés par le bot (`/api/internal/geti/*`) : tout y est
 * **non fiable** — le jeton dit que l'appelant est le bot, pas que le texte
 * d'un inconnu relayé par lui est sain. Chaque champ est typé, borné, et ce
 * qui n'a pas la forme attendue est écarté plutôt que deviné.
 *
 * Module serveur.
 */
import { getiCategoryOfChannel, type GetiCategory, type GetiRawEmbed, type GetiRawPost } from "@/lib/shared/geti";
import {
  GETI_BOT_USER_ID,
  GETI_DELETE_MAX_IDS,
  GETI_RECONCILE_MAX_IDS,
  GETI_UPSERT_MAX_POSTS,
  type GetiSource,
} from "@/lib/shared/geti/ingest";

/** Codes de refus des routes GETI. */
export const GETI_INGEST_ERRORS = {
  invalidRequest: "GETI_INVALID_REQUEST",
  tooManyPosts: "GETI_TOO_MANY_POSTS",
  tooManyIds: "GETI_TOO_MANY_IDS",
  unknownChannel: "GETI_UNKNOWN_CHANNEL",
  invalidWindow: "GETI_INVALID_WINDOW",
  unavailable: "GETI_UNAVAILABLE",
} as const;

/** Bornes de Discord (contenu 4 000, encart 6 000 au total), prises larges. */
const CONTENT_MAX = 4000;
const EMBEDS_MAX = 10;
const EMBED_TITLE_MAX = 256;
const EMBED_DESCRIPTION_MAX = 4096;
const EMBED_FIELDS_MAX = 25;
const EMBED_FIELD_NAME_MAX = 256;
const EMBED_FIELD_VALUE_MAX = 1024;
const EMBED_FOOTER_MAX = 2048;
const USERNAME_MAX = 64;
const DATE_MAX_LENGTH = 40;
/** Octets du message brut gardé (`raw_json`) : au-delà, l'annonce est écartée. */
export const GETI_RAW_JSON_MAX_BYTES = 60_000;

const SNOWFLAKE = /^\d{15,22}$/u;

/** Une annonce poussée, lue et bornée. */
export type GetiPushedPost = {
  messageId: string;
  channelId: string;
  category: GetiCategory;
  raw: GetiRawPost;
  source: GetiSource;
  postedAt: Date;
  editedAt: Date | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Identifiant Discord (15 à 22 chiffres), ou `null`. */
export function parseSnowflake(value: unknown): string | null {
  return typeof value === "string" && SNOWFLAKE.test(value) ? value : null;
}

function bounded(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value === "" || value.length > DATE_MAX_LENGTH) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

function parseEmbed(value: unknown): GetiRawEmbed | null {
  if (!isRecord(value)) return null;
  const fields = Array.isArray(value.fields)
    ? value.fields
        .slice(0, EMBED_FIELDS_MAX)
        .filter(isRecord)
        .map((field) => ({
          name: bounded(field.name, EMBED_FIELD_NAME_MAX),
          value: bounded(field.value, EMBED_FIELD_VALUE_MAX),
        }))
    : [];
  return {
    authorName: bounded(value.authorName, EMBED_TITLE_MAX),
    title: bounded(value.title, EMBED_TITLE_MAX),
    description: bounded(value.description, EMBED_DESCRIPTION_MAX),
    fields,
    footerText: bounded(value.footerText, EMBED_FOOTER_MAX),
  };
}

function parseEmbeds(value: unknown): GetiRawEmbed[] {
  if (!Array.isArray(value)) return [];
  const embeds: GetiRawEmbed[] = [];
  for (const entry of value.slice(0, EMBEDS_MAX)) {
    const embed = parseEmbed(entry);
    if (embed) embeds.push(embed);
  }
  return embeds;
}

/**
 * Lit une annonce poussée. `null` : forme inattendue (identifiant, salon hors
 * des six sources, date de publication illisible), message d'un bot autre que
 * GETI Bot, ou message brut trop lourd — elle est comptée « écartée », jamais
 * enregistrée à moitié.
 */
export function parsePushedPost(value: unknown): GetiPushedPost | null {
  if (!isRecord(value)) return null;
  const messageId = parseSnowflake(value.id);
  const channelId = parseSnowflake(value.channelId);
  const category = getiCategoryOfChannel(channelId);
  const postedAt = parseDate(value.postedAt);
  if (!messageId || !channelId || !category || !postedAt) return null;
  const editedAt = parseDate(value.editedAt);
  const author = isRecord(value.author) ? value.author : {};
  const fromBot = author.bot === true;
  // Seul GETI Bot relaie des annonces : le message d'un autre bot (le nôtre compris) n'en est pas une.
  if (fromBot && author.id !== GETI_BOT_USER_ID) return null;
  const raw: GetiRawPost = {
    category,
    channelId,
    content: bounded(value.content, CONTENT_MAX) ?? "",
    author: {
      id: parseSnowflake(author.id),
      username: bounded(author.username, USERNAME_MAX),
      discriminator: bounded(author.discriminator, 4),
      bot: fromBot,
    },
    embeds: parseEmbeds(value.embeds),
    postedAt: postedAt.toISOString(),
    editedAt: editedAt ? editedAt.toISOString() : null,
  };
  if (Buffer.byteLength(JSON.stringify(raw), "utf8") > GETI_RAW_JSON_MAX_BYTES) return null;
  return { messageId, channelId, category, source: fromBot ? "relay" : "direct", raw, postedAt, editedAt };
}

/** Corps de `POST /api/internal/geti/posts` : les annonces lisibles, et le nombre d'écartées. */
export function parseUpsertBody(body: Record<string, unknown>): { posts: GetiPushedPost[]; rejected: number } | string {
  if (!Array.isArray(body.posts)) return GETI_INGEST_ERRORS.invalidRequest;
  if (body.posts.length > GETI_UPSERT_MAX_POSTS) return GETI_INGEST_ERRORS.tooManyPosts;
  const posts: GetiPushedPost[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const entry of body.posts) {
    const post = parsePushedPost(entry);
    // Deux fois le même message dans un lot : la première lecture seule compte.
    if (!post || seen.has(post.messageId)) rejected += 1;
    else {
      seen.add(post.messageId);
      posts.push(post);
    }
  }
  return { posts, rejected };
}

/** Liste d'identifiants Discord, sans doublon ; un seul identifiant invalide refuse le corps. */
function parseIds(value: unknown, max: number): string[] | string {
  if (!Array.isArray(value)) return GETI_INGEST_ERRORS.invalidRequest;
  if (value.length > max) return GETI_INGEST_ERRORS.tooManyIds;
  const ids = new Set<string>();
  for (const entry of value) {
    const id = parseSnowflake(entry);
    if (!id) return GETI_INGEST_ERRORS.invalidRequest;
    ids.add(id);
  }
  return [...ids];
}

/** Corps de `POST /api/internal/geti/posts/delete`. */
export function parseDeleteBody(body: Record<string, unknown>): { ids: string[] } | string {
  const ids = parseIds(body.ids, GETI_DELETE_MAX_IDS);
  return typeof ids === "string" ? ids : { ids };
}

/** Fenêtre d'un salon à réconcilier : tout message gardé entre `since` et `until` absent de `ids` est retiré. */
export type GetiReconcileRequest = { channelId: string; since: Date; until: Date; ids: string[] };

/** Corps de `POST /api/internal/geti/reconcile`. */
export function parseReconcileBody(body: Record<string, unknown>): GetiReconcileRequest | string {
  const channelId = parseSnowflake(body.channelId);
  if (!channelId) return GETI_INGEST_ERRORS.invalidRequest;
  if (!getiCategoryOfChannel(channelId)) return GETI_INGEST_ERRORS.unknownChannel;
  const since = parseDate(body.since);
  const until = parseDate(body.until);
  if (!since || !until || since.getTime() > until.getTime()) return GETI_INGEST_ERRORS.invalidWindow;
  const ids = parseIds(body.ids, GETI_RECONCILE_MAX_IDS);
  return typeof ids === "string" ? ids : { channelId, since, until, ids };
}
