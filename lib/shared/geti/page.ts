/**
 * Page publique des annonces GETI (`/geti-info`) : adresses, filtres proposés
 * par catégorie, état des filtres dans l'adresse, étiquettes d'une annonce et
 * texte à afficher — `docs/features/GETI_INFO.md` § Page.
 *
 * Module pur : importable côté serveur comme côté client.
 */
import { getiStoredRankRange, getiStoredTimeSlot, getiTimeSlotMatches } from "@/lib/shared/geti/filter";
import { GETI_RETENTION_DAYS } from "@/lib/shared/geti/ingest";
import { GETI_PAGE_PATH } from "@/lib/shared/geti/path";
import type { Metadata } from "next";
import { INTL_LOCALE, SITE_TIME_ZONE, type Locale } from "@/lib/shared/locales";

export { GETI_OFFICIAL_INVITE_CODE, GETI_OFFICIAL_INVITE_URL } from "@/lib/shared/discord";
import { getiCodeSpan, getiWithoutSpoilers } from "@/lib/shared/geti/normalize";
import { GETI_RANK_TOP, getiRankFromValue, getiRankValue } from "@/lib/shared/geti/ranks";
import {
  GETI_CATEGORIES,
  GETI_CHANNEL_IDS,
  GETI_DAYS,
  GETI_GUILD_ID,
  GETI_LANGUAGES,
  GETI_LEVELS,
  GETI_PLATFORMS,
  GETI_REGIONS,
  GETI_ROLES,
  GETI_STAFF_ROLES,
  GETI_SUB_ROLES,
  GETI_TIERS,
  type GetiCategory,
  type GetiDay,
  type GetiFilter,
  type GetiLanguage,
  type GetiLevel,
  type GetiParsedPost,
  type GetiPlatform,
  type GetiRank,
  type GetiRankedRole,
  type GetiRegion,
  type GetiRole,
  type GetiStaffRole,
  type GetiSubRole,
} from "@/lib/shared/geti/types";

/** Adresse de la page, sans préfixe de langue (définie dans `path.ts`, sans dépendance). */
export { GETI_PAGE_PATH };

/** Catégorie rendue par `/geti-info` tout court. */
export const GETI_DEFAULT_CATEGORY: GetiCategory = "lfs";

/**
 * Ordre d'**affichage** des catégories (sélecteur de la page, raccourcis de
 * l'accueil) : la catégorie par défaut d'abord, puis l'ordre des salons.
 * `GETI_CATEGORIES` reste l'ordre de référence des données.
 */
export const GETI_CATEGORY_ORDER: readonly GetiCategory[] = [
  GETI_DEFAULT_CATEGORY,
  ...GETI_CATEGORIES.filter((category) => category !== GETI_DEFAULT_CATEGORY),
];

/** Nom du serveur officiel de GETI. */
export const GETI_OFFICIAL_SERVER_NAME = "GETI \u2014 Geeking Time";

/** Adresse d'une catégorie (`/geti-info/lfp`) : le sigle du salon, le même dans les deux langues. */
export function getiCategoryPath(category: GetiCategory): string {
  return `${GETI_PAGE_PATH}/${category}`;
}

/** La catégorie d'un segment d'adresse, `null` s'il n'en désigne aucune. */
export function getiCategoryOfSlug(slug: string | null | undefined): GetiCategory | null {
  const wanted = (slug ?? "").toLowerCase();
  return GETI_CATEGORIES.find((category) => category === wanted) ?? null;
}

/** Lien direct vers le salon de la catégorie sur notre serveur Discord (où l'on publie). */
export function getiChannelUrl(category: GetiCategory): string {
  return `https://discord.com/channels/${GETI_GUILD_ID}/${GETI_CHANNEL_IDS[category]}`;
}

/** Groupes de filtres ; chaque catégorie n'en propose qu'une partie. */
export const GETI_FILTER_FIELDS = [
  "ranks",
  "roles",
  "subRoles",
  "staffRoles",
  "levels",
  "regions",
  "platforms",
  "languages",
  "days",
  "time",
] as const;
export type GetiFilterField = (typeof GETI_FILTER_FIELDS)[number];

/**
 * Filtres proposés par catégorie : ceux que l'analyse lit réellement dans ses
 * annonces (un filtre qu'aucune annonce ne renseigne ne ferait que vider la liste).
 */
export const GETI_CATEGORY_FILTERS: Readonly<Record<GetiCategory, readonly GetiFilterField[]>> = Object.freeze({
  lfp: ["ranks", "roles", "subRoles", "levels", "regions", "platforms", "languages", "days", "time"],
  lft: ["ranks", "roles", "subRoles", "levels", "regions", "platforms", "languages", "days", "time"],
  lfsub: ["ranks", "roles", "subRoles", "regions", "platforms", "languages", "days", "time"],
  lfstaff: ["staffRoles", "ranks", "levels", "regions", "platforms", "languages"],
  lfs: ["ranks", "levels", "regions", "platforms", "languages", "days", "time"],
  lfcast: ["staffRoles", "languages", "days", "time"],
});

/**
 * Catégories où une annonce passée (toutes ses dates visées sont finies) est
 * masquée par défaut : la recherche de scrim, qui ne vaut que pour sa soirée.
 * Ailleurs, elle reste affichée, avec sa pastille.
 */
export const GETI_PAST_HIDDEN_CATEGORIES: readonly GetiCategory[] = ["lfs"];

/** La catégorie masque-t-elle par défaut ses annonces passées ? */
export function getiHidesPast(category: GetiCategory): boolean {
  return GETI_PAST_HIDDEN_CATEGORIES.includes(category);
}

/** Âges proposés (en jours), toujours sous la durée de garde de la catégorie ; « tout » = aucune valeur. */
export function getiAgeOptions(category: GetiCategory): number[] {
  return [1, 3, 7].filter((days) => days < GETI_RETENTION_DAYS[category]);
}

/** État des filtres de la page, tel que l'adresse le porte. */
export type GetiPageQuery = {
  rankMin: GetiRank | null;
  rankMax: GetiRank | null;
  roles: GetiRole[];
  subRoles: GetiSubRole[];
  staffRoles: GetiStaffRole[];
  levels: GetiLevel[];
  regions: GetiRegion[];
  platforms: GetiPlatform[];
  languages: GetiLanguage[];
  days: GetiDay[];
  /**
   * Créneau voulu, en heures entières (début 0–23, fin 1–24). Un début après la
   * fin (« entre 22h et 2h ») est un créneau qui passe minuit.
   */
  hourFrom: number | null;
  hourTo: number | null;
  /** Âge maximal en jours ; `null` : toute la durée de garde. */
  ageDays: number | null;
  /** `true` : les annonces closes (texte barré) sont montrées aussi. */
  showClosed: boolean;
  /** `true` : les annonces passées sont montrées aussi (catégories de `GETI_PAST_HIDDEN_CATEGORIES`). */
  showPast: boolean;
  /** `true` : une annonce qui ne précise pas un critère demandé est écartée. */
  strict: boolean;
  /** Page demandée, à partir de 1. */
  page: number;
};

/** Aucun filtre, première page. */
export function emptyGetiPageQuery(): GetiPageQuery {
  return {
    rankMin: null,
    rankMax: null,
    roles: [],
    subRoles: [],
    staffRoles: [],
    levels: [],
    regions: [],
    platforms: [],
    languages: [],
    days: [],
    hourFrom: null,
    hourTo: null,
    ageDays: null,
    showClosed: false,
    showPast: false,
    strict: false,
    page: 1,
  };
}

/** Paramètres d'adresse : une valeur, ou plusieurs (formulaire envoyé sans JavaScript). */
export type GetiSearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

/** Noms des paramètres d'adresse (courts : l'adresse se partage). */
export const GETI_PARAMS = {
  rankMin: "rmin",
  rankMax: "rmax",
  roles: "role",
  subRoles: "sub",
  staffRoles: "staff",
  levels: "lvl",
  regions: "reg",
  platforms: "plat",
  languages: "lang",
  days: "day",
  hourFrom: "hfrom",
  hourTo: "hto",
  ageDays: "age",
  showClosed: "closed",
  showPast: "past",
  strict: "strict",
  page: "p",
} as const;

const MAX_PARAM_LENGTH = 200;
const MAX_PARAM_VALUES = 20;
const MAX_PAGE = 10_000;

function rawValues(params: GetiSearchParams, name: string): string[] {
  const value = params[name];
  let list: readonly string[] = [];
  if (typeof value === "string") list = [value];
  else if (value !== undefined) list = value.slice(0, MAX_PARAM_VALUES);
  return list.flatMap((entry) => entry.slice(0, MAX_PARAM_LENGTH).split(","));
}

/** Valeurs connues d'un paramètre à choix multiples, sans doublon, dans l'ordre du domaine. */
function listParam<T extends string>(params: GetiSearchParams, name: string, domain: readonly T[]): T[] {
  const wanted = new Set(rawValues(params, name).map((value) => value.trim().toUpperCase()));
  return domain.filter((value) => wanted.has(value));
}

function intParam(params: GetiSearchParams, name: string, min: number, max: number): number | null {
  const raw = rawValues(params, name)[0]?.trim() ?? "";
  if (!/^\d{1,5}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

function flagParam(params: GetiSearchParams, name: string): boolean {
  return rawValues(params, name)[0] === "1";
}

/** Écriture d'un rang dans l'adresse : `master-3`. */
export function getiRankSlug(rank: GetiRank): string {
  return `${rank.tier.toLowerCase()}-${rank.division}`;
}

/** Lit `master-3` ; `null` pour tout autre texte. */
export function parseGetiRankSlug(slug: string | null | undefined): GetiRank | null {
  const match = /^([a-z]{1,12})-([1-5])$/.exec((slug ?? "").trim().toLowerCase());
  if (!match) return null;
  const tier = GETI_TIERS.find((candidate) => candidate.toLowerCase() === match[1]);
  if (!tier) return null;
  return { tier, division: Number(match[2]) as GetiRank["division"] };
}

/** Tous les rangs, du plus bas au plus haut (listes déroulantes). */
export function getiAllRanks(): GetiRank[] {
  return Array.from({ length: GETI_RANK_TOP + 1 }, (_, value) => getiRankFromValue(value));
}

/**
 * Lit l'état des filtres dans l'adresse. Tout ce qui est inconnu, hors borne
 * ou non proposé par la catégorie est ignoré : une adresse abîmée rend la
 * liste entière, jamais une erreur.
 */
export function parseGetiPageQuery(category: GetiCategory, params: GetiSearchParams): GetiPageQuery {
  const fields = GETI_CATEGORY_FILTERS[category];
  const list = <T extends string>(field: GetiFilterField, name: string, domain: readonly T[]): T[] =>
    fields.includes(field) ? listParam(params, name, domain) : [];
  const ranked = fields.includes("ranks");
  const timed = fields.includes("time");
  // Rangs inversés : remis dans l'ordre plutôt que de rendre une liste vide. Les
  // heures, elles, ne s'échangent pas : « 22h → 2h » est un créneau de nuit.
  const [rankMin, rankMax] = ordered(
    ranked ? parseGetiRankSlug(rawValues(params, GETI_PARAMS.rankMin)[0]) : null,
    ranked ? parseGetiRankSlug(rawValues(params, GETI_PARAMS.rankMax)[0]) : null,
    getiRankValue,
  );
  const hourFrom = timed ? intParam(params, GETI_PARAMS.hourFrom, 0, 23) : null;
  const hourTo = timed ? intParam(params, GETI_PARAMS.hourTo, 1, 24) : null;
  const ageDays = intParam(params, GETI_PARAMS.ageDays, 1, GETI_RETENTION_DAYS[category]);
  return {
    rankMin,
    rankMax,
    roles: list("roles", GETI_PARAMS.roles, GETI_ROLES),
    subRoles: list("subRoles", GETI_PARAMS.subRoles, GETI_SUB_ROLES),
    staffRoles: list("staffRoles", GETI_PARAMS.staffRoles, GETI_STAFF_ROLES),
    levels: list("levels", GETI_PARAMS.levels, GETI_LEVELS),
    regions: list("regions", GETI_PARAMS.regions, GETI_REGIONS),
    platforms: list("platforms", GETI_PARAMS.platforms, GETI_PLATFORMS),
    languages: list("languages", GETI_PARAMS.languages, GETI_LANGUAGES),
    days: list("days", GETI_PARAMS.days, GETI_DAYS),
    hourFrom,
    hourTo,
    ageDays: ageDays !== null && getiAgeOptions(category).includes(ageDays) ? ageDays : null,
    showClosed: flagParam(params, GETI_PARAMS.showClosed),
    showPast: getiHidesPast(category) && flagParam(params, GETI_PARAMS.showPast),
    strict: flagParam(params, GETI_PARAMS.strict),
    page: intParam(params, GETI_PARAMS.page, 1, MAX_PAGE) ?? 1,
  };
}

/** Deux bornes dans l'ordre croissant ; une borne absente reste absente. */
function ordered<T>(low: T | null, high: T | null, valueOf: (bound: T) => number): [T | null, T | null] {
  return low !== null && high !== null && valueOf(low) > valueOf(high) ? [high, low] : [low, high];
}

/** Paramètres d'adresse d'un état de filtres, dans un ordre stable ; rien pour une valeur par défaut. */
export function getiPageSearch(query: GetiPageQuery): string {
  const search = new URLSearchParams();
  const list = (name: string, values: readonly string[]) => {
    if (values.length > 0) search.set(name, values.map((value) => value.toLowerCase()).join(","));
  };
  if (query.rankMin) search.set(GETI_PARAMS.rankMin, getiRankSlug(query.rankMin));
  if (query.rankMax) search.set(GETI_PARAMS.rankMax, getiRankSlug(query.rankMax));
  list(GETI_PARAMS.roles, query.roles);
  list(GETI_PARAMS.subRoles, query.subRoles);
  list(GETI_PARAMS.staffRoles, query.staffRoles);
  list(GETI_PARAMS.levels, query.levels);
  list(GETI_PARAMS.regions, query.regions);
  list(GETI_PARAMS.platforms, query.platforms);
  list(GETI_PARAMS.languages, query.languages);
  list(GETI_PARAMS.days, query.days);
  if (query.hourFrom !== null) search.set(GETI_PARAMS.hourFrom, String(query.hourFrom));
  if (query.hourTo !== null) search.set(GETI_PARAMS.hourTo, String(query.hourTo));
  if (query.ageDays !== null) search.set(GETI_PARAMS.ageDays, String(query.ageDays));
  if (query.showClosed) search.set(GETI_PARAMS.showClosed, "1");
  if (query.showPast) search.set(GETI_PARAMS.showPast, "1");
  if (query.strict) search.set(GETI_PARAMS.strict, "1");
  if (query.page > 1) search.set(GETI_PARAMS.page, String(query.page));
  // Les virgules restent lisibles dans une adresse partagée.
  const text = search.toString().replaceAll("%2C", ",");
  return text === "" ? "" : `?${text}`;
}

/**
 * Paramètres d'adresse d'un état de filtres **tel que le serveur le rendra** :
 * relus comme une adresse (rangs inversés remis dans l'ordre, valeurs hors
 * catégorie retirées). Un changement de filtre attend ce rendu-là, pas l'état
 * brut du panneau, sinon l'attente ne se lèverait jamais.
 */
export function getiNormalizedSearch(category: GetiCategory, query: GetiPageQuery): string {
  const params = Object.fromEntries(new URLSearchParams(getiPageSearch(query)));
  return getiPageSearch(parseGetiPageQuery(category, params));
}

/** Adresse (sans préfixe de langue) d'une catégorie avec ses filtres. */
export function getiPageHref(category: GetiCategory, query?: GetiPageQuery): string {
  return `${getiCategoryPath(category)}${query ? getiPageSearch(query) : ""}`;
}

/** Nombre de critères actifs (la page et les réglages par défaut ne comptent pas). */
export function getiActiveFilterCount(query: GetiPageQuery): number {
  const lists = [
    query.roles,
    query.subRoles,
    query.staffRoles,
    query.levels,
    query.regions,
    query.platforms,
    query.languages,
    query.days,
  ];
  const flags = [
    query.rankMin !== null || query.rankMax !== null,
    query.hourFrom !== null || query.hourTo !== null,
    query.ageDays !== null,
    query.showClosed,
    query.showPast,
    query.strict,
  ];
  return lists.filter((values) => values.length > 0).length + flags.filter(Boolean).length;
}

/** Le filtre du moteur (`matchesGetiFilter`) pour un état de filtres de la page. */
export function getiPageFilter(category: GetiCategory, query: GetiPageQuery): GetiFilter {
  const timed = query.hourFrom !== null || query.hourTo !== null;
  return {
    category,
    ranks: query.rankMin || query.rankMax ? { min: query.rankMin, max: query.rankMax } : null,
    roles: query.roles,
    subRoles: query.subRoles,
    staffRoles: query.staffRoles,
    levels: query.levels,
    regions: query.regions,
    platforms: query.platforms,
    languages: query.languages,
    days: query.days,
    time: timed
      ? {
          from: query.hourFrom === null ? null : query.hourFrom * 60,
          to: query.hourTo === null ? null : query.hourTo * 60,
        }
      : null,
    hideClosed: !query.showClosed,
    hidePast: getiHidesPast(category) && !query.showPast,
    maxAgeHours: query.ageDays === null ? null : query.ageDays * 24,
    // Par défaut une annonce qui ne précise pas un critère reste visible : la
    // plupart ne donnent ni région ni plateforme, les écarter viderait la liste.
    includeUnknown: !query.strict,
  };
}

/**
 * Les filtres reçoivent-ils l'état rendu par le serveur ? Tant qu'un changement
 * de filtre attend son rendu (`pending`), le rendu d'un changement plus ancien
 * est ignoré : il déferait le dernier geste. Sans attente (retour arrière, lien
 * partagé), l'adresse rendue fait foi.
 *
 * Appelée à **chaque** rendu du serveur, même s'il redonne l'adresse
 * précédente (un geste défait avant son rendu) : l'attente atteinte se lève.
 *
 * @param pending Adresse normalisée (`getiNormalizedSearch`) du dernier changement en attente, ou `null`.
 * @param serverSearch Paramètres de l'état que le serveur vient de rendre.
 * @returns `adopt` : reprendre l'état du serveur ; `pending` : l'attente qui reste.
 */
export function getiFilterSync(
  pending: string | null,
  serverSearch: string,
): { adopt: boolean; pending: string | null } {
  if (pending !== null && pending !== serverSearch) return { adopt: false, pending };
  return { adopt: true, pending: null };
}

/**
 * Le clic sur ce lien remplace-t-il la page de cet onglet ? Seul ce cas rend la
 * main à l'adresse affichée (`GetiFilters`) : un lien ouvert ailleurs
 * (`target`), un téléchargement ou une ancre de la même page laisse le dernier
 * changement de filtre en attente.
 *
 * @param link Cible (`href` résolu ou relatif), `target` et présence de `download`.
 * @param here Adresse complète de la page affichée.
 */
export function getiLinkNavigatesTab(
  link: Readonly<{ href: string; target: string; download: boolean }>,
  here: string,
): boolean {
  if (link.download) return false;
  if (link.target !== "" && link.target.toLowerCase() !== "_self") return false;
  let url: URL;
  let current: URL;
  try {
    current = new URL(here);
    url = new URL(link.href, current);
  } catch {
    return false;
  }
  if (url.origin !== current.origin) return false;
  // Ancre de la même page : rien n'est rechargé.
  return !(url.pathname === current.pathname && url.search === current.search && url.hash !== "");
}

/** Une donnée lue dans l'annonce, à rendre en étiquette. */
export type GetiChip =
  | {
      kind: "rank";
      role: GetiRankedRole | null;
      min: GetiRank;
      max: GetiRank;
      /** Rang par rôle : fourchette globale de l'annonce, que le filtre compare quand aucun rôle voulu n'a son rang. */
      overall?: { min: GetiRank; max: GetiRank } | null;
    }
  | { kind: "role"; value: GetiRole }
  | { kind: "subRole"; value: GetiSubRole }
  | { kind: "staffRole"; value: GetiStaffRole }
  | { kind: "level"; value: GetiLevel }
  | { kind: "region"; value: GetiRegion }
  | { kind: "platform"; value: GetiPlatform }
  | { kind: "language"; value: GetiLanguage }
  | { kind: "day"; value: GetiDay }
  | {
      kind: "time";
      /** Horaire à l'heure de Paris. */
      from: number;
      to: number | null;
      /** Fuseau écrit dans l'annonce, `null` s'il n'y en a pas. */
      timezone: string | null;
      /** Horaire tel qu'écrit dans ce fuseau, quand la conversion l'a décalé ; absent ou `null` sinon. */
      stated?: { from: number; to: number | null } | null;
    }
  | { kind: "date"; iso: string }
  | { kind: "team"; name: string }
  | { kind: "minAge"; age: number };

/** Plafonds d'étiquettes par annonce : une annonce bavarde ne noie pas la carte. */
const MAX_TIME_CHIPS = 4;
const MAX_DATE_CHIPS = 4;
const RANKED_ROLES: readonly GetiRankedRole[] = ["TANK", "DPS", "SUPPORT"];

/** Les données lues dans une annonce, dans l'ordre d'affichage. */
/** Liste d'une analyse gardée : un champ absent ou abîmé vaut une liste vide (la carte reste rendue). */
function listOf<T>(values: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(values) ? values : [];
}

/**
 * Valeurs d'une liste gardée qui appartiennent au domaine : une valeur inconnue
 * (`"__proto__"`, ancienne énumération) n'a pas de libellé et ferait échouer le
 * rendu de toute la page — elle est ignorée.
 */
function knownOf<T extends string>(values: readonly T[] | null | undefined, domain: readonly T[]): T[] {
  return listOf<unknown>(values).filter((value): value is T => domain.some((known) => known === value));
}

/** Analyse gardée, champs peut-être absents (ligne écrite à la main, analyse ancienne). */
type StoredAnalysis = Partial<GetiParsedPost>;

/** Étiquettes des listes fermées (rôles, niveaux, région…), valeurs hors domaine écartées. */
function listedChips(stored: StoredAnalysis): GetiChip[] {
  return [
    ...knownOf(stored.roles, GETI_ROLES).map((value): GetiChip => ({ kind: "role", value })),
    ...knownOf(stored.subRoles, GETI_SUB_ROLES).map((value): GetiChip => ({ kind: "subRole", value })),
    ...knownOf(stored.staffRoles, GETI_STAFF_ROLES).map((value): GetiChip => ({ kind: "staffRole", value })),
    ...knownOf(stored.levels, GETI_LEVELS).map((value): GetiChip => ({ kind: "level", value })),
    ...knownOf(stored.regions, GETI_REGIONS).map((value): GetiChip => ({ kind: "region", value })),
    ...knownOf(stored.platforms, GETI_PLATFORMS).map((value): GetiChip => ({ kind: "platform", value })),
    ...knownOf(stored.languages, GETI_LANGUAGES).map((value): GetiChip => ({ kind: "language", value })),
    ...knownOf(stored.availability?.days, GETI_DAYS).map((value): GetiChip => ({ kind: "day", value })),
  ];
}

/**
 * Les données lues dans une annonce, dans l'ordre d'affichage. Une analyse
 * gardée incomplète (champ absent) donne moins d'étiquettes, jamais une erreur.
 */
export function getiPostChips(post: GetiParsedPost): GetiChip[] {
  const stored: StoredAnalysis = post;
  const chips: GetiChip[] = [];
  if (typeof stored.teamName === "string" && stored.teamName) chips.push({ kind: "team", name: stored.teamName });
  const byRole = stored.ranks?.byRole ?? {};
  const overall = getiStoredRankRange(stored.ranks);
  const perRole = RANKED_ROLES.flatMap((role): GetiChip[] => {
    const range = Object.hasOwn(byRole, role) ? getiStoredRankRange(byRole[role]) : null;
    return range === null ? [] : [{ kind: "rank", role, min: range.min, max: range.max, overall }];
  });
  if (perRole.length > 0) chips.push(...perRole);
  else if (overall !== null) chips.push({ kind: "rank", role: null, min: overall.min, max: overall.max });
  chips.push(...listedChips(stored));
  const availability = stored.availability;
  const timezone = typeof availability?.timezone === "string" ? availability.timezone : null;
  // Les horaires écrits suivent l'ordre des horaires convertis : même rang, même créneau.
  const statedTimes = timezone === null ? [] : listOf<unknown>(availability?.statedTimes);
  const slots = listOf<unknown>(availability?.times).flatMap((slot, index) => {
    const valid = getiStoredTimeSlot(slot);
    return valid === null ? [] : [{ ...valid, stated: getiStoredTimeSlot(statedTimes[index]) }];
  });
  for (const slot of slots.slice(0, MAX_TIME_CHIPS)) {
    const stated = slot.stated === null ? {} : { stated: slot.stated };
    chips.push({ kind: "time", from: slot.from, to: slot.to, timezone, ...stated });
  }
  const dates = listOf<unknown>(stored.dates).filter((iso): iso is string => typeof iso === "string");
  for (const iso of dates.slice(0, MAX_DATE_CHIPS)) chips.push({ kind: "date", iso });
  if (typeof stored.minAge === "number" && Number.isFinite(stored.minAge)) chips.push({ kind: "minAge", age: stored.minAge });
  return chips;
}

const DAY_MINUTES = 1440;

function included<T>(values: readonly T[] | null | undefined, value: T): boolean {
  return (values ?? []).includes(value);
}

function isRankedRole(role: unknown): role is GetiRankedRole {
  return RANKED_ROLES.some((known) => known === role);
}

function rankChipMatches(
  chip: Extract<GetiChip, { kind: "rank" }>,
  filter: GetiFilter,
  cardRoles: readonly GetiRankedRole[] | null,
): boolean {
  const min = filter.ranks?.min ?? null;
  const max = filter.ranks?.max ?? null;
  if (min === null && max === null) return false;
  // Comme le filtre : avec des rôles voulus, seul le rang de ces rôles compte —
  // sauf si la carte n'en porte aucun (ou qu'aucun rôle n'est voulu) ; le filtre
  // compare alors la fourchette globale de l'annonce, que l'étiquette porte.
  const wantedRoles = (filter.roles ?? []).filter(isRankedRole);
  const usesOverall =
    cardRoles === null ? wantedRoles.length === 0 : !wantedRoles.some((role) => cardRoles.includes(role));
  if (chip.role !== null && !usesOverall && !wantedRoles.includes(chip.role)) return false;
  // `overall: null` : l'annonce n'a pas de fourchette globale lisible, le filtre n'a rien à comparer.
  if (usesOverall && chip.role !== null && chip.overall === null) return false;
  const range = usesOverall && chip.role !== null && chip.overall ? chip.overall : chip;
  const low = min === null ? 0 : getiRankValue(min);
  const high = max === null ? GETI_RANK_TOP : getiRankValue(max);
  return getiRankValue(range.max) >= low && getiRankValue(range.min) <= high;
}

function timeChipMatches(chip: { from: number; to: number | null }, filter: GetiFilter): boolean {
  const from = filter.time?.from ?? null;
  const to = filter.time?.to ?? null;
  if (from === null && to === null) return false;
  return getiTimeSlotMatches(chip, from, to);
}

/**
 * L'étiquette répond-elle à un critère **actif** de la recherche ? Sert à la
 * mettre en avant ; un critère absent ne met rien en avant.
 *
 * @param chips Toutes les étiquettes de la carte : un rang par rôle se juge
 *   comme le filtre, qui retombe sur la fourchette globale quand l'annonce ne
 *   donne le rang d'aucun rôle voulu. Sans elles, seul le rôle de l'étiquette compte.
 */
export function getiChipMatches(chip: GetiChip, filter: GetiFilter, chips?: readonly GetiChip[]): boolean {
  switch (chip.kind) {
    case "rank":
      return rankChipMatches(
        chip,
        filter,
        chips
          ? chips.flatMap((entry) => (entry.kind === "rank" && entry.role !== null ? [entry.role] : []))
          : null,
      );
    case "role":
      // « Flex » répond à tout rôle voulu, comme dans le filtre.
      return included(filter.roles, chip.value) || (chip.value === "FLEX" && (filter.roles ?? []).length > 0);
    case "subRole":
      return included(filter.subRoles, chip.value);
    case "staffRole":
      return included(filter.staffRoles, chip.value);
    case "level":
      return included(filter.levels, chip.value);
    case "region":
      return included(filter.regions, chip.value);
    case "platform":
      return included(filter.platforms, chip.value);
    case "language":
      return included(filter.languages, chip.value);
    case "day":
      return included(filter.days, chip.value);
    case "time":
      return timeChipMatches(chip, filter);
    default:
      return false;
  }
}

/**
 * Une heure sur 24 h, à l'écriture de la langue : « 21h », « 20h30 » en
 * français, « 21:00 », « 20:30 » en anglais. La fin de journée (1440) s'écrit
 * « 24h » / « 24:00 », jamais « 0h » (elle se confondrait avec minuit pile).
 */
export function getiClockLabel(minutes: number, locale: Locale = "fr"): string {
  const safe = Math.min(DAY_MINUTES, Math.max(0, Math.trunc(Number.isFinite(minutes) ? minutes : 0)));
  const hours = Math.floor(safe / 60);
  const rest = String(safe % 60).padStart(2, "0");
  if (locale === "en") return `${String(hours).padStart(2, "0")}:${rest}`;
  return rest === "00" ? `${hours}h` : `${hours}h${rest}`;
}

/** Mots neutres qui remplacent les mentions Discord d'une annonce, et le texte masqué (`||…||`). */
export type GetiMentionLabels = { member: string; role: string; channel: string; spoiler: string };

/** Au-delà, la carte replie le texte derrière « Lire la suite ». */
export const GETI_TEXT_COLLAPSE_CHARS = 420;
export const GETI_TEXT_COLLAPSE_LINES = 7;

/**
 * Une seule marque de citation en tête de ligne, suivie d'une espace ou seule
 * sur sa ligne (ligne vide d'une citation) — comme Discord, qui n'imbrique pas
 * les citations et laisse « >4000 » en texte.
 */
const QUOTE_PREFIX = /^[ \t]*(?:>>>|>)(?: |$)/u;

function stripLineMarks(line: string): string {
  const rest = line.replace(QUOTE_PREFIX, "").trimStart();
  if (rest.startsWith("-# ")) return rest.slice(3);
  // Titres Discord (« # », « ## », « ### »).
  const heading = /^#{1,3} /.exec(rest);
  return heading ? rest.slice(heading[0].length) : rest;
}

/**
 * Balisage par paires (gras, souligné, barré) **au bord d'un mot** : « xX__Sniper__Xx »
 * reste tel quel, un pseudo écrit dans le texte se recopie juste. Contenu borné.
 */
const PAIRED_MARKUP = [String.raw`\*\*`, "__", "~~"].map(
  (mark) => new RegExp(String.raw`(?<![\p{L}\p{N}])${mark}(?=\S)([\s\S]{0,300}?\S)${mark}(?![\p{L}\p{N}])`, "gu"),
);
/** Langue d'un bloc de code (« ```txt ») : une étiquette de mise en forme, pas du texte. */
const CODE_LANGUAGE = /^[\w+#.-]{1,20}\n/u;
/** Marques de gras et de barré restées seules (paire coupée, contenu trop long). */
const LEFTOVER_MARKS = /\*{2,}|~{2,}/gu;

/**
 * Une marque restée seule est-elle du texte ? Entre deux chiffres (« 5**2 »),
 * entre deux espaces (« a ~~~ b ») ou seule sur sa ligne (un séparateur « ~~~~ ») :
 * oui, elle reste. Collée à un mot ou en bout de texte (« **LFS**s », « Team ~~ ») : non.
 */
function leftoverMarkIsText(text: string, index: number, length: number): boolean {
  const before = text[index - 1];
  const after = text[index + length];
  const lineStart = before === undefined || before === "\n";
  const lineEnd = after === undefined || after === "\n";
  if (lineStart && lineEnd) return true;
  if (before === undefined || after === undefined) return false;
  return (/\d/u.test(before) && /\d/u.test(after)) || (/[ \t]/u.test(before) && /[ \t]/u.test(after));
}

/** Balisage par paires retiré d'un passage hors code, puis ses marques restées seules. */
function withoutPairedMarkup(text: string): string {
  let out = text;
  for (const pattern of PAIRED_MARKUP) out = out.replace(pattern, "$1");
  return out.replace(LEFTOVER_MARKS, (mark: string, index: number, whole: string) =>
    leftoverMarkIsText(whole, index, mark.length) ? mark : "",
  );
}

/**
 * Passage hors code : marques de ligne (citation, titre, `-#`) retirées des seules
 * lignes qui commencent vraiment (`atLineStart` pour la première), puis le balisage par paires.
 */
function withoutMarkupOutside(text: string, atLineStart: boolean): string {
  const lines = text.split("\n").map((line, index) => (index > 0 || atLineStart ? stripLineMarks(line) : line));
  return withoutPairedMarkup(lines.join("\n"));
}

/** Le texte, code compris : le code garde son contenu exact (aucune marque n'y est retirée). */
function withoutMarkupOutsideCode(text: string): string {
  let out = "";
  let from = 0;
  for (const match of text.matchAll(getiCodeSpan())) {
    const index = match.index ?? 0;
    const [whole, fence, inner] = match;
    out += withoutMarkupOutside(text.slice(from, index), from === 0 || text[from - 1] === "\n");
    out += fence === "```" ? inner.replace(CODE_LANGUAGE, "") : inner;
    from = index + whole.length;
  }
  return out + withoutMarkupOutside(text.slice(from), from === 0 || text[from - 1] === "\n");
}
/** Horodatage Discord `<t:secondes:style>`, rendu en date lisible à l'heure du site. */
const TIMESTAMP = /<t:(\d{1,12})(?::([a-zA-Z]))?>/gu;

const TIME_PARTS: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
const TIMESTAMP_STYLES: Record<string, Intl.DateTimeFormatOptions> = {
  t: { ...TIME_PARTS, timeZoneName: "short" },
  T: { ...TIME_PARTS, second: "2-digit", timeZoneName: "short" },
  d: { day: "2-digit", month: "2-digit", year: "numeric" },
  D: { day: "numeric", month: "long", year: "numeric" },
  f: { day: "numeric", month: "long", year: "numeric", ...TIME_PARTS, timeZoneName: "short" },
  F: { weekday: "long", day: "numeric", month: "long", year: "numeric", ...TIME_PARTS, timeZoneName: "short" },
};

/**
 * Un horodatage Discord en texte, dans la langue de la page et à l'heure du
 * site (fuseau écrit pour une heure). Le style relatif (`R`) vieillirait sur
 * une page relue : il s'écrit comme la date complète (`f`), tout comme un style inconnu.
 */
export function getiTimestampLabel(seconds: number, style: string | undefined, locale: Locale = "fr"): string {
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(seconds) || Number.isNaN(date.getTime())) return "";
  const options = (style !== undefined && Object.hasOwn(TIMESTAMP_STYLES, style) ? TIMESTAMP_STYLES[style] : null) ?? TIMESTAMP_STYLES.f;
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...options, timeZone: SITE_TIME_ZONE }).format(date);
}

/**
 * Le texte d'une annonce tel que la page le montre : du **texte simple**. Une
 * marque de citation (celle du relais, `> `) et le balisage Discord par paires
 * (gras, souligné, barré, code, titres) sont retirés, un passage masqué devient
 * un mot neutre (jamais son contenu), une mention aussi (jamais un identifiant),
 * un émoji de serveur son nom, un horodatage une date. Rien n'est interprété :
 * le rendu reste un nœud de texte, un lien reste du texte.
 */
export function getiPostBodyText(text: string, labels: GetiMentionLabels, locale: Locale = "fr"): string {
  const body = getiWithoutSpoilers(text, labels.spoiler)
    .replace(/<@&\d{1,25}>/g, labels.role)
    .replace(/<@!?\d{1,25}>/g, labels.member)
    .replace(/<#\d{1,25}>/g, labels.channel)
    .replace(/<a?:(\w{1,40}):\d{1,25}>/g, ":$1:")
    .replace(TIMESTAMP, (_match, seconds: string, style: string | undefined) =>
      getiTimestampLabel(Number(seconds), style, locale),
    );
  return withoutMarkupOutsideCode(body)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Le texte est-il assez long pour être replié ? */
export function getiTextIsLong(text: string): boolean {
  return text.length > GETI_TEXT_COLLAPSE_CHARS || text.split("\n").length > GETI_TEXT_COLLAPSE_LINES;
}

/** Âge d'une annonce pour `Intl.RelativeTimeFormat` : la plus grande unité entière (valeur négative = passé). */
export function getiRelativeAge(
  postedAt: string,
  now: number,
): { value: number; unit: "minute" | "hour" | "day" } | null {
  const posted = Date.parse(postedAt);
  if (Number.isNaN(posted)) return null;
  const minutes = Math.max(0, Math.floor((now - posted) / 60_000));
  if (minutes < 60) return { value: -minutes, unit: "minute" };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { value: -hours, unit: "hour" };
  return { value: -Math.floor(hours / 24), unit: "day" };
}

/** Relecture de fond de la liste (aucun flux sur cette page), page au premier plan. */
export const GETI_REFRESH_INTERVAL_MS = 300_000;

/**
 * Période de la relecture de fond selon le régime de la page
 * (`CLIENT_POWER_MODES.md`) : seul le régime plein en garde une ; ailleurs, le
 * retour sur l'onglet suffit (`null`).
 */
export function getiRefreshIntervalMs(mode: string): number | null {
  return mode === "FULL" ? GETI_REFRESH_INTERVAL_MS : null;
}

/**
 * Code court d'une erreur de lecture (`ER_PARSE_ERROR`, `ECONNREFUSED`…), à
 * défaut le nom de sa classe (`TypeError` : un défaut du code, pas une panne de
 * la base), sinon « unknown ». Jamais le message, qui peut citer la requête.
 */
export function getiErrorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (typeof code === "string" && /^[A-Z0-9_]{1,40}$/u.test(code)) return code;
  const name = error instanceof Error ? error.name : undefined;
  return typeof name === "string" && /^[A-Za-z]{1,40}$/u.test(name) ? name : "unknown";
}

/**
 * Consigne aux moteurs : ne pas indexer, suivre les liens. Les annonces portent
 * le pseudo Discord de tiers (relais GETI compris) ; `data-nosnippet` ne cache
 * que l'extrait, pas l'indexation — une recherche sur un pseudo mènerait sinon
 * à la page. Les catégories restent hors du plan du site.
 */
export const GETI_ROBOTS: NonNullable<Metadata["robots"]> = {
  index: false,
  follow: true,
  googleBot: { index: false, follow: true },
};
