/**
 * Alertes sur une recherche d'annonces GETI — `docs/features/GETI_INFO.md`
 * § Alertes.
 *
 * Une alerte garde une catégorie et l'état des filtres de la page, sous la
 * forme **canonique de l'adresse** (`getiPageSearch`) : la relire passe par
 * `parseGetiPageQuery`, qui ignore tout ce qui est inconnu ou hors borne — une
 * alerte gardée ne peut donc pas porter un filtre que la page ne saurait pas
 * écrire. La correspondance est celle de la page (`matchesGetiFilter`).
 *
 * Module pur : importable côté serveur comme côté client.
 */
import { isGetiPostPast, matchesGetiFilter } from "@/lib/shared/geti/filter";
import { visibleText } from "@/lib/shared/visible-text";
import {
  getiPageFilter,
  getiPageSearch,
  parseGetiPageQuery,
  type GetiPageQuery,
  type GetiSearchParams,
} from "@/lib/shared/geti/page";
import type { GetiCategory, GetiFilter, GetiParsedPost } from "@/lib/shared/geti/types";

/** Alertes gardées par compte, au plus. */
export const GETI_ALERT_MAX_PER_USER = 10;

/** Longueur d'un nom d'alerte (facultatif). */
export const GETI_ALERT_NAME_MAX = 60;

/** Longueur de la recherche gardée : tous les filtres cochés tiennent largement dessous. */
export const GETI_ALERT_SEARCH_MAX = 600;

/** Au plus une notification par alerte sur cette durée ; les annonces arrivées entre-temps se lisent sur la page. */
export const GETI_ALERT_COOLDOWN_MINUTES = 10;

/**
 * Une annonce ne prévient que si elle a été publiée (ou modifiée) depuis moins
 * de cette durée : le rattrapage du bot, qui repousse deux semaines
 * d'annonces à chaque démarrage, ne réveille personne pour cet arriéré (seules
 * ses annonces récentes peuvent prévenir).
 */
export const GETI_ALERT_FRESH_MINUTES = 30;

/** Alertes actives lues par catégorie à chaque lot reçu : la borne du coût d'une correspondance. */
export const GETI_ALERT_SCAN_MAX = 2000;

/** Jours de garde d'une trace « cette alerte a déjà vu cette annonce » : au-delà de la plus longue garde d'une annonce. */
export const GETI_ALERT_HIT_RETENTION_DAYS = 15;

/** Une alerte telle que la page la rend à son propriétaire. */
export type GetiAlert = {
  id: number;
  category: GetiCategory;
  /** Nom donné par le compte, `null` s'il n'en a pas donné. */
  name: string | null;
  /** Filtres gardés, forme canonique de l'adresse (`?role=tank`), vide sans filtre. */
  search: string;
  paused: boolean;
  /** Date ISO 8601. */
  createdAt: string;
};

/** Codes de refus des routes d'alertes. */
export const GETI_ALERT_ERRORS = {
  unauthorized: "UNAUTHORIZED",
  invalid: "GETI_ALERT_INVALID",
  nameTooLong: "GETI_ALERT_NAME_TOO_LONG",
  limit: "GETI_ALERT_LIMIT",
  duplicate: "GETI_ALERT_DUPLICATE",
  notFound: "GETI_ALERT_NOT_FOUND",
  unavailable: "GETI_ALERT_UNAVAILABLE",
} as const;

/** Les paramètres d'une recherche écrite (`?role=tank&reg=eu`), pour `parseGetiPageQuery`. */
function searchParamsOf(search: string): GetiSearchParams {
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    if (!(key in params)) params[key] = value;
  }
  return params;
}

/**
 * Ce qu'une alerte garde d'un état de filtres : ni la page, ni l'âge (une
 * alerte ne regarde que ce qui vient d'arriver), ni « montrer les annonces
 * closes » ou « passées » (une annonce close ou passée ne prévient jamais).
 */
function alertQuery(query: GetiPageQuery): GetiPageQuery {
  return { ...query, page: 1, ageDays: null, showClosed: false, showPast: false };
}

/** L'état de filtres d'une alerte gardée (ou d'une recherche écrite par la page). */
export function getiAlertQuery(category: GetiCategory, search: string): GetiPageQuery {
  return alertQuery(parseGetiPageQuery(category, searchParamsOf(search)));
}

/**
 * La recherche gardée pour une alerte, depuis une recherche écrite par la
 * page (ou par n'importe qui) : relue, nettoyée, réécrite en forme canonique.
 * `null` si elle dépasse la longueur gardée.
 */
export function getiAlertSearch(category: GetiCategory, search: string): string | null {
  if (search.length > GETI_ALERT_SEARCH_MAX * 4) return null;
  const canonical = getiPageSearch(getiAlertQuery(category, search));
  return canonical.length > GETI_ALERT_SEARCH_MAX ? null : canonical;
}

/** Le filtre du moteur pour une alerte gardée. */
export function getiAlertFilter(category: GetiCategory, search: string): GetiFilter {
  return getiPageFilter(category, getiAlertQuery(category, search));
}

/** Un nom d'alerte reçu est-il d'un type admis (texte, ou absent) ? Un autre type est un refus `invalid`, pas « trop long ». */
export function isGetiAlertNameInput(input: unknown): input is string | null | undefined {
  return input === null || input === undefined || typeof input === "string";
}

/**
 * Nom d'alerte nettoyé par `visibleText` (NFKC, contrôles, caractères
 * invisibles et de direction retirés, espaces repliés —
 * `docs/features/UNTRUSTED_NAMES.md`). `null` pour un nom vide (ou fait
 * seulement d'invisibles), `undefined` s'il est trop long ou n'est pas un
 * texte (`isGetiAlertNameInput` distingue ce second cas).
 */
export function getiAlertName(input: unknown): string | null | undefined {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string") return undefined;
  const name = visibleText(input);
  if (name === "") return null;
  return name.length > GETI_ALERT_NAME_MAX ? undefined : name;
}

/** Une annonce reçue est-elle assez récente pour prévenir ? (publication, ou dernière modification) */
export function isFreshGetiPost(postedAt: number, editedAt: number | null, now: number): boolean {
  const latest = Math.max(postedAt, editedAt ?? postedAt);
  return now - latest <= GETI_ALERT_FRESH_MINUTES * 60_000;
}

/** Ce que la correspondance lit d'une alerte. */
export type GetiAlertCriteria = { id: number; category: GetiCategory; search: string };

/**
 * Une annonce peut-elle prévenir ? Ni close, ni passée : une annonce dont
 * toutes les dates visées sont finies à `now` (un scrim de la veille reçu au
 * rattrapage, une modification tardive) ne réveille personne.
 */
export function isGetiPostAlertable(post: GetiParsedPost, now: number): boolean {
  return !post.closed && !isGetiPostPast(post, now);
}

/**
 * Les alertes que touche une annonce : même catégorie, annonce ouverte et à venir, et la
 * correspondance de la page (`matchesGetiFilter`). Le filtre de chaque alerte
 * est construit une fois (`filters`, à partager entre les annonces d'un lot).
 */
export function matchingGetiAlerts<T extends GetiAlertCriteria>(
  post: GetiParsedPost,
  category: GetiCategory,
  alerts: readonly T[],
  filters: Map<number, GetiFilter>,
  now: number,
): T[] {
  if (!isGetiPostAlertable(post, now)) return [];
  return alerts.filter((alert) => {
    if (alert.category !== category) return false;
    let filter = filters.get(alert.id);
    if (!filter) {
      filter = getiAlertFilter(alert.category, alert.search);
      filters.set(alert.id, filter);
    }
    return matchesGetiFilter({ ...post, category }, filter, now);
  });
}
