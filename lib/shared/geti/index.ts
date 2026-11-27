/**
 * Annonces GETI : analyse et filtre — `docs/features/GETI_INFO.md`.
 *
 * Module pur : importable côté serveur comme côté client.
 */
export * from "@/lib/shared/geti/types";
export { filterGetiPosts, matchesGetiFilter } from "@/lib/shared/geti/filter";
export { getiCategoryOfChannel, isGetiBotNotice, parseGetiPost } from "@/lib/shared/geti/parse-post";
export { GETI_RANK_TOP, getiRankFromValue, getiRankValue } from "@/lib/shared/geti/ranks";
