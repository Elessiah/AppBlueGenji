/**
 * Annonces GETI poussées par le bot et rendues par le site : bornes et formes
 * communes — `docs/features/GETI_INFO.md` § Récupération.
 *
 * Module pur : importable côté serveur comme côté client.
 */
import type { GetiCategory, GetiParsedPost } from "@/lib/shared/geti/types";

/** Durée de garde d'une annonce, comptée depuis sa publication sur Discord. */
export const GETI_RETENTION_DAYS = 14;
export const GETI_RETENTION_MS = GETI_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Annonces d'un appel `posts` ; le bot découpe ses lots sous cette borne. */
export const GETI_UPSERT_MAX_POSTS = 20;
/** Identifiants d'un appel `posts/delete` (une suppression en masse de Discord en porte 100 au plus). */
export const GETI_DELETE_MAX_IDS = 100;
/** Identifiants d'un appel `reconcile` : les messages d'un salon sur la fenêtre de garde. */
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
