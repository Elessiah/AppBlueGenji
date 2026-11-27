/**
 * Annonces GETI gardées par le site (`bg_geti_posts`) — `docs/features/GETI_INFO.md`
 * § Récupération.
 *
 * Le bot pousse chaque annonce des six salons sources — écrite directement
 * par un membre, ou relayée par GETI Bot — à sa création, à sa modification, à
 * sa suppression et au rattrapage ; le site l'analyse **à l'écriture**
 * (`parseGetiPost`) et garde le message brut à côté de son analyse. Une
 * annonce vit au plus la durée de garde de sa catégorie
 * (`GETI_RETENTION_DAYS` : 7 jours pour un scrim, 14 pour les autres) après sa
 * publication sur Discord, et disparaît dès que le message disparaît de Discord.
 *
 * Module serveur.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { cached, invalidateCachedPrefix } from "@/lib/server/cache";
import { startPeriodicClock } from "@/lib/server/periodic-clock";
import { toIso } from "@/lib/server/serialization";
import type { GetiPushedPost, GetiReconcileRequest } from "@/lib/server/geti/wire";
import { getiErrorCode } from "@/lib/shared/geti/page";
import {
  GETI_CATEGORIES,
  getiCategoryOfChannel,
  matchesGetiFilter,
  isGetiBotNotice,
  parseGetiPost,
  type GetiCategory,
  type GetiFilter,
  type GetiParseOptions,
  type GetiParsedPost,
} from "@/lib/shared/geti";
import {
  GETI_PAGE_SIZE_DEFAULT,
  GETI_PAGE_SIZE_MAX,
  GETI_RETENTION_MAX_DAYS,
  GETI_BOT_USER_ID,
  GETI_SOURCES,
  getiRetentionCutoff,
  type GetiPostPage,
  type GetiSource,
  type GetiStoredPost,
} from "@/lib/shared/geti/ingest";

/** Ce dont le service a besoin d'une base : le pool, ou une connexion. */
export type GetiExecutor = Pick<Pool, "execute">;

/** Pseudo Discord (32 caractères) et son ancien suffixe « #1234 ». */
const AUTHOR_TAG_MAX = 37;
/** Identifiants par `DELETE … IN (…)`. */
const DELETE_CHUNK = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Annonces lues d'un coup pour une page : le filtre (rang, rôle, région…) se
 * joue en mémoire sur l'analyse gardée, la table ne portant que deux semaines
 * de six salons.
 */
export const GETI_LIST_SCAN_MAX = 3000;

function affected(result: unknown): number {
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

/**
 * La version reçue est-elle au moins aussi récente que la version gardée ?
 * Un rattrapage peut croiser une modification en direct : la plus ancienne des
 * deux lectures ne doit pas écraser l'autre. `edited_at` est affecté **en
 * dernier** — MySQL et MariaDB lisent, dans un `ON DUPLICATE KEY UPDATE`, les
 * colonnes déjà affectées plus à gauche.
 */
const INCOMING_IS_CURRENT = "COALESCE(VALUES(edited_at), VALUES(posted_at)) >= COALESCE(edited_at, posted_at)";

const UPSERT_SQL = `
  INSERT INTO bg_geti_posts
    (message_id, channel_id, category, source, author_id, author_tag, raw_json, parsed_json, posted_at, edited_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
    author_id = IF(${INCOMING_IS_CURRENT}, VALUES(author_id), author_id),
    author_tag = IF(${INCOMING_IS_CURRENT}, VALUES(author_tag), author_tag),
    raw_json = IF(${INCOMING_IS_CURRENT}, VALUES(raw_json), raw_json),
    parsed_json = IF(${INCOMING_IS_CURRENT}, VALUES(parsed_json), parsed_json),
    edited_at = IF(${INCOMING_IS_CURRENT}, VALUES(edited_at), edited_at)`;

/** Bilan d'un lot poussé : des nombres seulement. */
export type GetiUpsertOutcome = {
  /** Annonces enregistrées ou mises à jour. */
  stored: number;
  /** Annonces sans texte (pièce jointe seule, texte vidé par une modification) : retirées si elles étaient gardées. */
  emptied: number;
  /** Annonces publiées avant la fenêtre de garde de leur catégorie : ni gardées ni rendues. */
  expired: number;
};

/**
 * Bots dont l'analyse croit les relais : GETI Bot seul (son en-tête nomme
 * l'auteur). Notre bot n'y figure pas : ses messages ne sont pas des annonces
 * (`parsePushedPost` les refuse avant l'analyse), le croire ne servirait à
 * rien. Sans cette liste, `parseGetiPost` ne nomme l'auteur d'aucun relais.
 */
export function getiTrustedBots(): GetiParseOptions {
  return { getiBotIds: [GETI_BOT_USER_ID], siteBotIds: [] };
}

/**
 * Sans texte, ou réponse de service du bot (« Ton annonce a été publié… ») : pas une annonce.
 * Le relais (`parsePushedPost`) écarte déjà tout message de bot qui n'est pas un relais ; cette garde,
 * côté enregistrement, couvre les autres appelants (graine, relecture des anciennes lignes).
 */
function isNotAnnouncement(parsed: GetiParsedPost, raw: GetiPushedPost["raw"]): boolean {
  return parsed.text.trim() === "" || isGetiBotNotice(raw);
}

/**
 * Enregistre un lot d'annonces poussées, chacune analysée ici. Une annonce déjà
 * gardée est remplacée (modification), sauf si la version reçue est plus
 * ancienne que la version gardée.
 */
export async function upsertGetiPosts(
  executor: GetiExecutor,
  posts: readonly GetiPushedPost[],
  now: number = Date.now(),
): Promise<GetiUpsertOutcome> {
  const outcome: GetiUpsertOutcome = { stored: 0, emptied: 0, expired: 0 };
  const emptied: string[] = [];
  const trusted = getiTrustedBots();
  try {
    for (const post of posts) {
      if (post.postedAt.getTime() < getiRetentionCutoff(post.category, now).getTime()) {
        outcome.expired += 1;
        continue;
      }
      const parsed = parseGetiPost(post.raw, trusted);
      if (isNotAnnouncement(parsed, post.raw)) {
        outcome.emptied += 1;
        emptied.push(post.messageId);
        continue;
      }
      await executor.execute(UPSERT_SQL, [
        post.messageId,
        post.channelId,
        post.category,
        post.source,
        parsed.authorId,
        parsed.authorTag?.slice(0, AUTHOR_TAG_MAX) ?? null,
        JSON.stringify(post.raw),
        storedAnalysis(parsed),
        post.postedAt,
        post.editedAt,
      ]);
      outcome.stored += 1;
    }
    if (emptied.length > 0) await deleteGetiPosts(executor, emptied);
  } catch (error) {
    forgetGetiScans();
    throw error;
  }
  if (outcome.stored > 0) forgetGetiScans();
  return outcome;
}

/** Retire des annonces par identifiant de message Discord ; rend le nombre de lignes retirées. */
export async function deleteGetiPosts(executor: GetiExecutor, messageIds: readonly string[]): Promise<number> {
  let removed = 0;
  try {
    for (let start = 0; start < messageIds.length; start += DELETE_CHUNK) {
      const chunk = messageIds.slice(start, start + DELETE_CHUNK);
      const [result] = await executor.execute(
        `DELETE FROM bg_geti_posts WHERE message_id IN (${chunk.map(() => "?").join(", ")})`,
        [...chunk],
      );
      removed += affected(result);
    }
  } catch (error) {
    forgetGetiScans();
    throw error;
  }
  if (removed > 0) forgetGetiScans();
  return removed;
}

/**
 * Réconcilie un salon avec Discord : toute annonce gardée, publiée entre
 * `since` et `until`, dont le message n'est plus dans `ids` a été supprimée
 * pendant que le bot n'écoutait pas — elle est retirée. `since` ne remonte pas
 * au-delà de la fenêtre de garde de la catégorie du salon ; une annonce
 * publiée après `until` (arrivée en direct pendant le rattrapage) n'est pas
 * touchée.
 */
export async function reconcileGetiChannel(
  executor: GetiExecutor,
  request: GetiReconcileRequest,
  now: number = Date.now(),
): Promise<number> {
  const category = getiCategoryOfChannel(request.channelId);
  if (category === null) return 0;
  const cutoff = getiRetentionCutoff(category, now);
  const since = request.since.getTime() < cutoff.getTime() ? cutoff : request.since;
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT message_id FROM bg_geti_posts WHERE channel_id = ? AND posted_at >= ? AND posted_at <= ?`,
    [request.channelId, since, request.until],
  );
  const kept = new Set(request.ids);
  const gone = rows.map((row) => String(row.message_id)).filter((id) => !kept.has(id));
  return gone.length === 0 ? 0 : deleteGetiPosts(executor, gone);
}

/**
 * Efface les annonces sorties de la fenêtre de garde de leur catégorie (puis
 * toute ligne plus vieille que la plus longue des durées, quelle que soit sa
 * catégorie) ; rend le nombre de lignes effacées.
 */
export async function purgeExpiredGetiPosts(executor: GetiExecutor, now: number = Date.now()): Promise<number> {
  let removed = 0;
  try {
    for (const category of GETI_CATEGORIES) {
      const [result] = await executor.execute(`DELETE FROM bg_geti_posts WHERE category = ? AND posted_at < ?`, [
        category,
        getiRetentionCutoff(category, now),
      ]);
      removed += affected(result);
    }
    const [result] = await executor.execute(`DELETE FROM bg_geti_posts WHERE posted_at < ?`, [
      new Date(now - GETI_RETENTION_MAX_DAYS * DAY_MS),
    ]);
    removed += affected(result);
  } catch (error) {
    forgetGetiScans();
    throw error;
  }
  if (removed > 0) forgetGetiScans();
  return removed;
}

const PURGE_CLOCK_KEY = "geti-posts-purge";
const PURGE_TICK_MS = 60 * 60 * 1000;
/** Premier passage peu après le démarrage, hors du chemin de la première requête. */
const FIRST_PURGE_DELAY_MS = 3 * 60 * 1000;

/**
 * Lance la purge horaire (une fois par processus ; une alerte par panne). Une
 * horloge, pas le trafic ni le bot : un site sans visite, ou un bot arrêté,
 * garderait sinon des annonces au-delà de la durée annoncée.
 */
export function startGetiPostsPurgeClock(): void {
  startPeriodicClock({
    key: PURGE_CLOCK_KEY,
    firstDelayMs: FIRST_PURGE_DELAY_MS,
    tickMs: PURGE_TICK_MS,
    run: async () => {
      const db = await getDatabase();
      await purgeExpiredGetiPosts(db);
      return refreshStaleGetiPosts(db);
    },
    failureMessage: "[geti] Purge des annonces impossible.",
  });
}

function isCategory(value: unknown): value is GetiCategory {
  return GETI_CATEGORIES.some((category) => category === value);
}

function isSource(value: unknown): value is GetiSource {
  return GETI_SOURCES.some((source) => source === value);
}

function isParsedPost(value: unknown): value is GetiParsedPost {
  return typeof value === "object" && value !== null && typeof (value as { text?: unknown }).text === "string";
}

type GetiPostRow = RowDataPacket & {
  message_id: string;
  channel_id: string;
  category: string;
  source: string;
  author_id: string | null;
  author_tag: string | null;
  parsed_json: string;
  /** Message brut, lu seulement pour une analyse gardée avant le dernier champ ajouté (`STALE_RAW_JSON`). */
  stale_raw_json?: string | null;
  posted_at: string;
  edited_at: string | null;
};

/** Champs ajoutés à l'analyse après les premières annonces gardées : vides si le message brut est illisible. */
const ADDED_FIELDS: Partial<GetiParsedPost> = { dates: [], levels: [], closed: false };
/**
 * Version de l'analyse gardée, écrite en **dernière** clé (`storedAnalysis`) :
 * avancée quand l'analyse change ce qu'elle lit — 2 : un passage masqué
 * (`||…||`) n'est plus lu, une analyse plus ancienne en a tiré des étiquettes.
 */
const ANALYSIS_VERSION = 2;
/**
 * Une analyse gardée à la version courante : `JSON.stringify` écrit la clé en
 * dernier, `…,"analysisVersion":2}` ; dans le texte d'une annonce, un guillemet
 * est échappé (`\"`), un texte ne peut pas la contrefaire.
 */
const CURRENT_ANALYSIS = `parsed_json LIKE '%"analysisVersion":${ANALYSIS_VERSION}}'`;

/** L'analyse à garder, marquée de sa version. */
function storedAnalysis(parsed: object): string {
  return JSON.stringify({ ...parsed, analysisVersion: ANALYSIS_VERSION });
}

/**
 * Message brut d'une analyse gardée à une version antérieure (`CURRENT_ANALYSIS`) :
 * relu et réanalysé à la lecture, sans quoi une étiquette tirée d'un passage
 * masqué, ou un champ manquant (`dates`, `levels`, `closed`), sortirait sur la
 * page. Les autres lignes ne remontent pas leur message brut (jusqu'à 60 000 octets).
 */
const STALE_RAW_JSON = `IF(${CURRENT_ANALYSIS}, NULL, raw_json) AS stale_raw_json`;

/** Analyse d'une ligne : celle gardée, ou celle du message brut quand elle précède les derniers champs. */
function analysisOf(row: GetiPostRow): unknown {
  if (row.stale_raw_json !== null && row.stale_raw_json !== undefined) {
    try {
      return parseGetiPost(JSON.parse(row.stale_raw_json), getiTrustedBots());
    } catch {
      // Message brut illisible : l'analyse gardée, champs ajoutés vides.
    }
  }
  return JSON.parse(row.parsed_json);
}

/** Lignes réanalysées par lot, et lots par passage (borne : 5 000 lignes, la table en garde quelques centaines). */
const REFRESH_CHUNK = 200;
const REFRESH_CHUNKS_MAX = 25;

/**
 * Nouvelle analyse (JSON) d'une ligne ancienne : celle du message brut ; à défaut, la gardée,
 * champs ajoutés vides. `null` : pas une annonce, ou ni message brut ni analyse lisibles.
 */
function reanalysed(row: RowDataPacket, trusted: GetiParseOptions): string | null {
  try {
    const raw: GetiPushedPost["raw"] = JSON.parse(String(row.raw_json));
    const parsed = parseGetiPost(raw, trusted);
    return isNotAnnouncement(parsed, raw) ? null : storedAnalysis(parsed);
  } catch {
    try {
      return storedAnalysis({ ...ADDED_FIELDS, ...JSON.parse(String(row.parsed_json)) });
    } catch {
      return null;
    }
  }
}

/**
 * Réécrit un lot de lignes anciennes ; rend les lignes réécrites et celles à retirer
 * (pas une annonce). Une écriture qui échoue en cours de route oublie aussi la
 * lecture partagée : les réécritures déjà faites sont gardées.
 */
async function rewriteChunk(
  executor: GetiExecutor,
  rows: RowDataPacket[],
  trusted: GetiParseOptions,
): Promise<{ written: number; gone: string[] }> {
  const gone: string[] = [];
  let written = 0;
  try {
    for (const row of rows) {
      const messageId = String(row.message_id);
      const next = reanalysed(row, trusted);
      if (next === null) {
        gone.push(messageId);
        continue;
      }
      const [result] = await executor.execute(
        `UPDATE bg_geti_posts SET parsed_json = ? WHERE message_id = ? AND NOT ${CURRENT_ANALYSIS}`,
        [next, messageId],
      );
      written += affected(result);
    }
  } catch (error) {
    forgetGetiScans();
    throw error;
  }
  if (written > 0) forgetGetiScans();
  return { written, gone };
}

/**
 * Réécrit l'analyse des lignes gardées à une version antérieure (`ANALYSIS_VERSION`) :
 * relues de leur message brut par la version courante de l'analyse, une seule fois,
 * hors du chemin d'une requête (la lecture les réanalyse sinon à chaque page, ~0,3 ms
 * chacune). Un message brut illisible garde son analyse, champs ajoutés vides : la
 * ligne cesse d'être « ancienne » et n'est plus relue. Une ligne qui n'est pas une
 * annonce (sans texte, avis du bot) est retirée, comme à l'enregistrement. L'écriture
 * ne touche qu'une ligne encore ancienne : une modification arrivée entre-temps gagne.
 *
 * @param executor Pool ou connexion.
 * @returns Le nombre de lignes réécrites ou retirées.
 */
export async function refreshStaleGetiPosts(executor: GetiExecutor): Promise<number> {
  const trusted = getiTrustedBots();
  let done = 0;
  for (let chunk = 0; chunk < REFRESH_CHUNKS_MAX; chunk += 1) {
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT message_id, raw_json, parsed_json FROM bg_geti_posts
        WHERE NOT ${CURRENT_ANALYSIS} ORDER BY id LIMIT ${REFRESH_CHUNK}`,
    );
    if (rows.length === 0) return done;
    const { written, gone } = await rewriteChunk(executor, rows, trusted);
    const removed = gone.length > 0 ? await deleteGetiPosts(executor, gone) : 0;
    done += written + removed;
    // Rien n'a bougé (ligne qui résiste) : relire le même lot ne ferait que boucler.
    if (written + removed === 0 || rows.length < REFRESH_CHUNK) return done;
  }
  return done;
}

/** Une ligne en annonce rendue ; `null` si elle est illisible, ou sortie de la fenêtre de garde de sa catégorie. */
function storedPostOf(row: GetiPostRow, now: number): GetiStoredPost | null {
  if (!isCategory(row.category) || !isSource(row.source)) return null;
  let parsed: unknown;
  try {
    parsed = analysisOf(row);
  } catch {
    return null;
  }
  const postedAt = toIso(row.posted_at);
  if (!isParsedPost(parsed) || postedAt === null) return null;
  if (Date.parse(postedAt) < getiRetentionCutoff(row.category, now).getTime()) return null;
  // La marque de version reste en base : l'annonce rendue ne la porte pas.
  const analysis: GetiParsedPost & { analysisVersion?: unknown } = { ...ADDED_FIELDS, ...parsed, postedAt };
  delete analysis.analysisVersion;
  return {
    messageId: String(row.message_id),
    channelId: String(row.channel_id),
    category: row.category,
    source: row.source,
    authorTag: row.author_tag,
    authorId: row.author_id,
    // La date gardée fait foi pour le filtre d'âge, pas celle recopiée dans l'analyse.
    // Une analyse gardée avant l'ajout d'un champ (dates, niveaux, clôture), au message brut illisible, le reçoit vide.
    parsed: analysis,
    postedAt,
    editedAt: toIso(row.edited_at),
  };
}

/** Page demandée : numéro à partir de 1, taille bornée. */
export type GetiPageRequest = { page?: number; pageSize?: number };

function pageNumber(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(value)));
}

/** Plus ancienne date à lire en SQL : la fenêtre de garde (de la catégorie voulue, sinon la plus longue), resserrée par l'âge voulu. */
function listSince(filter: GetiFilter, now: number): Date {
  const retention = isCategory(filter.category)
    ? getiRetentionCutoff(filter.category, now)
    : new Date(now - GETI_RETENTION_MAX_DAYS * DAY_MS);
  const maxAgeHours = filter.maxAgeHours;
  if (typeof maxAgeHours !== "number" || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0) return retention;
  const aged = new Date(now - maxAgeHours * 60 * 60 * 1000);
  return aged.getTime() > retention.getTime() ? aged : retention;
}

/**
 * Les annonces gardées qui passent `filter`, de la plus récente à la plus
 * ancienne. La catégorie et l'âge se filtrent en SQL ; le reste (rang, rôle,
 * région, plateforme, langue) par `matchesGetiFilter` sur l'analyse gardée —
 * la même fonction que la page et les alertes. Une annonce sortie de la fenêtre
 * de garde de sa catégorie n'est jamais rendue, même avant le passage de la purge.
 */
export async function listGetiPosts(
  filter: GetiFilter = {},
  page: GetiPageRequest = {},
  executor?: GetiExecutor,
  now: number = Date.now(),
): Promise<GetiPostPage> {
  const db = executor ?? (await getDatabase());
  return pageOfStored(await scanGetiPosts(filter, db, now), filter, page, now);
}

/** Lecture SQL et analyse des annonces gardées de la catégorie et de l'âge voulus (le reste du filtre se joue en mémoire). */
async function scanGetiPosts(filter: GetiFilter, db: GetiExecutor, now: number): Promise<GetiStoredPost[]> {
  const where = ["posted_at >= ?"];
  const params: (Date | string)[] = [listSince(filter, now)];
  if (isCategory(filter.category)) {
    where.push("category = ?");
    params.push(filter.category);
  }
  // `LIMIT` écrit en dur (constante entière) : `execute` n'accepte pas partout un paramètre lié à cette place.
  const [rows] = await db.execute<GetiPostRow[]>(
    `SELECT message_id, channel_id, category, source, author_id, author_tag, parsed_json, ${STALE_RAW_JSON},
            posted_at, edited_at
       FROM bg_geti_posts
      WHERE ${where.join(" AND ")}
      ORDER BY posted_at DESC, id DESC
      LIMIT ${GETI_LIST_SCAN_MAX}`,
    params,
  );
  const posts: GetiStoredPost[] = [];
  for (const row of rows) {
    const post = storedPostOf(row, now);
    if (post) posts.push(post);
  }
  return posts;
}

/** Filtre en mémoire les annonces lues, puis découpe la page demandée. */
function pageOfStored(stored: readonly GetiStoredPost[], filter: GetiFilter, page: GetiPageRequest, now: number): GetiPostPage {
  const pageSize = pageNumber(page.pageSize, GETI_PAGE_SIZE_DEFAULT, GETI_PAGE_SIZE_MAX);
  const requested = pageNumber(page.page, 1, Number.MAX_SAFE_INTEGER);
  // L'âge est déjà joué en SQL sur la date gardée : le filtre en mémoire ne le rejoue pas.
  const rest: GetiFilter = { ...filter, maxAgeHours: null };
  const matching = stored.filter((post) => matchesGetiFilter(post.parsed, rest, now));
  const start = (requested - 1) * pageSize;
  return { posts: matching.slice(start, start + pageSize), total: matching.length, page: requested, pageSize };
}

/** Préfixe des lectures partagées de la page publique (une clé par catégorie et âge). */
const GETI_SCAN_CACHE_PREFIX = "geti:scan:";

/**
 * Oublie les lectures partagées : appelée après toute écriture (enregistrement,
 * modification, suppression, réconciliation, purge, réanalyse). Chaque requête
 * est validée seule (pas de transaction), donc la page ne sert jamais, après la
 * réponse au bot, une annonce supprimée sur Discord — `/rgpd` promet son retrait
 * « aussitôt ». Une écriture qui échoue en cours de route oublie aussi : les
 * requêtes passées avant l'échec sont déjà validées.
 */
function forgetGetiScans(): void {
  invalidateCachedPrefix(GETI_SCAN_CACHE_PREFIX);
}

/** Durée de vie de la lecture partagée de la page publique : une annonce modifiée sur Discord s'y voit en quelques secondes. */
export const GETI_SCAN_CACHE_TTL_MS = 10_000;

/**
 * Comme {@link listGetiPosts} pour la page publique : la lecture SQL (jusqu'à
 * {@link GETI_LIST_SCAN_MAX} lignes à analyser) est **mutualisée** par catégorie
 * et âge (`cached`, vol unique), le filtre et la pagination restent par demande.
 * Cent visiteurs, actualisations de fond comprises, coûtent une lecture par fenêtre.
 */
export async function listGetiPostsShared(
  filter: GetiFilter,
  page: GetiPageRequest = {},
  now: number = Date.now(),
): Promise<GetiPostPage> {
  const age = typeof filter.maxAgeHours === "number" && Number.isFinite(filter.maxAgeHours) ? filter.maxAgeHours : 0;
  const key = `${GETI_SCAN_CACHE_PREFIX}${isCategory(filter.category) ? filter.category : "all"}:${age}`;
  const stored = await cached(key, GETI_SCAN_CACHE_TTL_MS, async () =>
    scanGetiPosts(filter, await getDatabase(), now),
  );
  return pageOfStored(stored, filter, page, now);
}

/** Une ligne de pm2 par minute au plus quand la liste est illisible : chaque visite la redemanderait. */
export const GETI_LIST_FAILURE_LOG_MS = 60_000;
let lastListFailureLog = Number.NEGATIVE_INFINITY;
let silencedListFailures = 0;

/**
 * Consigne dans pm2 l'échec de lecture de la liste publique : un code seul
 * (`getiErrorCode`, jamais le message, qui peut citer la requête), au plus une
 * fois par {@link GETI_LIST_FAILURE_LOG_MS}, avec le nombre d'échecs tus depuis.
 *
 * @returns `true` si une ligne a été écrite.
 */
export function logGetiListFailure(error: unknown, now: number = Date.now()): boolean {
  if (now - lastListFailureLog < GETI_LIST_FAILURE_LOG_MS) {
    silencedListFailures += 1;
    return false;
  }
  const silenced = silencedListFailures;
  lastListFailureLog = now;
  silencedListFailures = 0;
  console.warn("[geti] post list unavailable:", getiErrorCode(error), silenced > 0 ? `(+${silenced} since last line)` : "");
  return true;
}

/** Tests : oublie la dernière ligne consignée. */
export function resetGetiListFailureLog(): void {
  lastListFailureLog = Number.NEGATIVE_INFINITY;
  silencedListFailures = 0;
}
