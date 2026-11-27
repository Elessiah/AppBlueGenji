/**
 * Annonces GETI poussées par le bot et rendues par le site : sources, durées
 * de garde, bornes et formes communes — `docs/features/GETI_INFO.md`
 * § Récupération.
 *
 * Module pur : importable côté serveur comme côté client.
 */
import { GETI_CATEGORIES, type GetiCategory, type GetiParsedPost } from "@/lib/shared/geti/types";

/**
 * Compte Discord de GETI Bot, qui relaie dans nos salons les annonces publiées
 * sur les serveurs abonnés à son réseau. Les messages de tout **autre** bot
 * (le nôtre compris) ne sont pas des annonces.
 */
export const GETI_BOT_USER_ID = "357980843001511937";

/** Début d'un relais de GETI Bot : la mention de l'auteur de l'annonce (« <@id>*(pseudo)* sur … »). */
const GETI_RELAY_HEADER_START = /^\s*<@!?\d{15,22}>/u;

/**
 * Le message de GETI Bot est-il un relais d'annonce ? Un relais ouvre son
 * premier encart sur la mention de l'auteur ; ses autres messages (« Ton
 * annonce a été publié dans … », l'avis qui suit une annonce directe) n'en
 * sont pas — même règle côté bot (`isGetiRelayMessage`).
 *
 * @param embeds Encarts du message, non fiables.
 */
export function isGetiRelay(embeds: readonly { description?: string | null }[] | null | undefined): boolean {
  const description = Array.isArray(embeds) ? embeds[0]?.description : null;
  return typeof description === "string" && GETI_RELAY_HEADER_START.test(description);
}

/**
 * D'où vient une annonce : écrite **directement** dans notre salon par un
 * membre (`direct` — l'auteur Discord est l'auteur de l'annonce, sa
 * modification et sa suppression sont les siennes), ou **relayée** par GETI
 * Bot depuis un autre serveur (`relay` — c'est la modification ou la
 * suppression du relais par GETI Bot qui s'applique).
 */
export const GETI_SOURCES = ["direct", "relay"] as const;
export type GetiSource = (typeof GETI_SOURCES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Durée de garde d'une annonce, en jours depuis sa publication sur Discord,
 * par catégorie : une recherche de scrim est périmée en une semaine, les
 * autres recherches vivent deux semaines.
 */
export const GETI_RETENTION_DAYS: Readonly<Record<GetiCategory, number>> = Object.freeze({
  lfp: 14,
  lft: 14,
  lfsub: 14,
  lfstaff: 14,
  lfs: 7,
  lfcast: 14,
});

/** La plus longue des durées de garde : aucune annonce ne vit au-delà. */
export const GETI_RETENTION_MAX_DAYS = Math.max(...GETI_CATEGORIES.map((category) => GETI_RETENTION_DAYS[category]));

/** Durée de garde d'une catégorie, en millisecondes. */
export function getiRetentionMs(category: GetiCategory): number {
  return GETI_RETENTION_DAYS[category] * DAY_MS;
}

/** Début de la fenêtre de garde d'une catégorie : une annonce publiée avant n'est ni gardée ni rendue. */
export function getiRetentionCutoff(category: GetiCategory, now: number = Date.now()): Date {
  return new Date(now - getiRetentionMs(category));
}

/** Annonces d'un appel `posts` ; le bot découpe ses lots sous cette borne. */
export const GETI_UPSERT_MAX_POSTS = 20;
/** Identifiants d'un appel `posts/delete` (une suppression en masse de Discord en porte 100 au plus). */
export const GETI_DELETE_MAX_IDS = 100;
/** Identifiants d'un appel `reconcile` : les messages d'un salon sur sa fenêtre de garde. */
export const GETI_RECONCILE_MAX_IDS = 10_000;

/** Taille d'une page d'annonces : par défaut, et au plus. */
export const GETI_PAGE_SIZE_DEFAULT = 30;
export const GETI_PAGE_SIZE_MAX = 100;

/** Une annonce gardée, telle que le site la rend (jamais le message brut). */
export type GetiStoredPost = {
  /** Identifiant du message Discord. */
  messageId: string;
  channelId: string;
  category: GetiCategory;
  source: GetiSource;
  /** Pseudo Discord à copier, `null` s'il n'a pas pu être lu. */
  authorTag: string | null;
  authorId: string | null;
  parsed: GetiParsedPost;
  /** Dates ISO 8601. */
  postedAt: string;
  editedAt: string | null;
};

/** Page d'annonces : `total` compte toutes celles qui passent le filtre. */
export type GetiPostPage = {
  posts: GetiStoredPost[];
  total: number;
  page: number;
  pageSize: number;
};
