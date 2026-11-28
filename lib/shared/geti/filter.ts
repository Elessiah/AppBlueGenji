/**
 * Filtre des annonces GETI : même règle pour la recherche de la page et pour
 * les alertes sur un filtre enregistré.
 *
 * Module pur : importable côté serveur comme côté client.
 */
import { GETI_RANK_TOP, getiRankFromValue, getiRankValue } from "@/lib/shared/geti/ranks";
import { getiWallInstant } from "@/lib/shared/geti/zones";
import {
  GETI_CATEGORIES,
  GETI_DAYS,
  GETI_ROLES,
  GETI_TIERS,
  type GetiDay,
  type GetiFilter,
  type GetiParsedPost,
  type GetiRank,
  type GetiRankRange,
  type GetiRankedRole,
} from "@/lib/shared/geti/types";

const HOUR_MS = 3_600_000;
/** Avance tolérée d'une date de publication sur l'horloge (horloges décalées). */
const CLOCK_SKEW_MS = 5 * 60_000;

/** Rôle à rang propre : une valeur enregistrée (« constructor ») n'en est pas un. */
function isRankedRole(role: unknown): role is GetiRankedRole {
  return role !== "FLEX" && GETI_ROLES.some((known) => known === role);
}

/** Nombre d'un JSON enregistré : un nombre, ou une chaîne qui en écrit un (« "3" ») ; sinon `NaN`. */
function storedNumber(value: unknown): number {
  if (typeof value === "number") return value;
  return typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
}

/** Borne de rang enregistrée, lue seulement si elle est un vrai rang ; sinon `null` (borne ouverte). */
function rankValue(rank: GetiRank | null | undefined): number | null {
  if (typeof rank !== "object" || rank === null) return null;
  const { tier, division: stored } = rank as { tier?: unknown; division?: unknown };
  const division = storedNumber(stored);
  const knownTier = GETI_TIERS.find((known) => known === tier);
  const knownDivision = Number.isInteger(division) && division >= 1 && division <= 5;
  return knownTier !== undefined && knownDivision
    ? getiRankValue({ tier: knownTier, division: division as GetiRank["division"] })
    : null;
}

/** Liste voulue d'un filtre enregistré : une valeur qui n'est pas une liste ne filtre rien. */
function wanted<T>(values: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(values) ? values : [];
}

/** Au moins une valeur voulue est dans l'annonce ; champ non lu : selon `includeUnknown`. */
function matchesAny<T>(stored: readonly T[] | undefined, values: readonly T[], includeUnknown: boolean): boolean {
  if (values.length === 0) return true;
  // Analyse gardée incomplète (champ absent) : le critère n'a pas été lu.
  const found = wanted(stored);
  if (found.length === 0) return includeUnknown;
  return values.some((value) => found.includes(value));
}

function matchesRoles(post: GetiParsedPost, filter: GetiFilter, includeUnknown: boolean): boolean {
  const roles = wanted(filter.roles);
  if (roles.length === 0) return true;
  const found = wanted(post.roles);
  if (found.length === 0) return includeUnknown;
  // « Flex » dans l'annonce : tous les rôles sont joués (ou acceptés).
  return found.includes("FLEX") || roles.some((role) => found.includes(role));
}

/**
 * Fourchettes à comparer : celles des rôles voulus quand l'annonce donne un
 * rang par rôle, sinon sa fourchette globale.
 */
function rankRangesOf(post: GetiParsedPost, filter: GetiFilter): GetiRankRange[] {
  const ranks = post.ranks ?? { min: null, max: null, byRole: {} };
  const byRole = ranks.byRole ?? {};
  const perRole = wanted(filter.roles).flatMap((role) => {
    const range = isRankedRole(role) && Object.hasOwn(byRole, role) ? getiStoredRankRange(byRole[role]) : null;
    return range === null ? [] : [range];
  });
  if (perRole.length > 0) return perRole;
  const overall = getiStoredRankRange(ranks);
  return overall === null ? [] : [overall];
}

/**
 * Fourchette de rang d'une analyse gardée, lue seulement si ses deux bornes
 * sont de vrais rangs (une ligne écrite à la main peut porter `null` ou un
 * objet abîmé) ; sinon `null` (rang non lu). Les bornes rendues sont de vrais
 * rangs (division numérique), remises dans l'ordre si la ligne les inverse.
 */
export function getiStoredRankRange(range: unknown): GetiRankRange | null {
  if (typeof range !== "object" || range === null) return null;
  const { min, max } = range as { min?: GetiRank | null; max?: GetiRank | null };
  const low = rankValue(min);
  const high = rankValue(max);
  if (low === null || high === null) return null;
  return { min: getiRankFromValue(Math.min(low, high)), max: getiRankFromValue(Math.max(low, high)) };
}

function matchesRanks(post: GetiParsedPost, filter: GetiFilter, includeUnknown: boolean): boolean {
  const ranks: unknown = filter.ranks;
  const bounds = typeof ranks === "object" && ranks !== null ? (ranks as GetiFilter["ranks"]) : null;
  // Une borne invalide est ouverte : deux bornes invalides valent un critère absent.
  const min = rankValue(bounds?.min);
  const max = rankValue(bounds?.max);
  if (min === null && max === null) return true;
  const ranges = rankRangesOf(post, filter);
  if (ranges.length === 0) return includeUnknown;
  const low = min ?? 0;
  const high = max ?? GETI_RANK_TOP;
  // Deux fourchettes se recoupent, bornes comprises.
  return ranges.some((range) => getiRankValue(range.max) >= low && getiRankValue(range.min) <= high);
}

const DAY_MINUTES = 1440;

/** Borne horaire enregistrée (minutes, 0–1440), sinon `null` (borne ouverte). */
function minuteBound(value: unknown): number | null {
  const minutes = storedNumber(value);
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= DAY_MINUTES ? minutes : null;
}

/** Une fin à « 0h » après un début dans la journée (« 22h-0h ») est la fin de journée, pas minuit du matin. */
function untilMidnight(start: number, end: number): number {
  return end === 0 && start > 0 ? DAY_MINUTES : end;
}

/**
 * Horaire d'une analyse gardée, lu seulement s'il est un objet aux bornes
 * valides (minutes, 0–1440 ; fin absente = heure seule) ; sinon `null`.
 */
export function getiStoredTimeSlot(slot: unknown): { from: number; to: number | null } | null {
  if (typeof slot !== "object" || slot === null) return null;
  const { from: rawFrom, to: rawTo } = slot as { from?: unknown; to?: unknown };
  const from = minuteBound(rawFrom);
  if (from === null) return null;
  if (rawTo === null || rawTo === undefined) return { from, to: null };
  const to = minuteBound(rawTo);
  return to === null ? null : { from, to };
}

/** Plage `[début, fin]` en minutes ; une plage qui passe minuit (« 22h-2h ») se coupe en deux. */
function segmentsOf(from: number, to: number): Array<readonly [number, number]> {
  return from <= to
    ? [[from, to]]
    : [
        [from, DAY_MINUTES],
        [0, to],
      ];
}

/**
 * Un horaire d'annonce recoupe-t-il le créneau voulu (bornes comprises) ? Une
 * heure seule doit y tomber. Un horaire ou un créneau qui passe minuit
 * (« 22h-1h », « entre 22h et 2h ») couvre la fin de soirée **et** le début de
 * la nuit. Une borne absente est ouverte (début ou fin de journée).
 *
 * @param slot Horaire lu dans l'annonce, en minutes depuis minuit.
 * @param from Début du créneau voulu en minutes, ou `null`.
 * @param to Fin du créneau voulu en minutes, ou `null`.
 * @returns `true` si les deux se recoupent.
 */
export function getiTimeSlotMatches(
  slot: { from: number; to: number | null },
  from: number | null,
  to: number | null,
): boolean {
  const stored = getiStoredTimeSlot(slot);
  if (stored === null) return false;
  const start = stored.from;
  const end = stored.to === null ? start : untilMidnight(start, stored.to);
  const windowFrom = from ?? 0;
  const windows = segmentsOf(windowFrom, untilMidnight(windowFrom, to ?? DAY_MINUTES));
  return segmentsOf(start, end).some(([low, high]) =>
    windows.some(([windowLow, windowHigh]) => high >= windowLow && low <= windowHigh),
  );
}

function matchesTime(post: GetiParsedPost, filter: GetiFilter, includeUnknown: boolean): boolean {
  const time: unknown = filter.time;
  const bounds = typeof time === "object" && time !== null ? (time as { from?: unknown; to?: unknown }) : null;
  const from = minuteBound(bounds?.from);
  const to = minuteBound(bounds?.to);
  if (from === null && to === null) return true;
  // Un horaire abîmé (ligne écrite à la main) vaut un horaire non lu.
  const times = wanted<unknown>(post.availability?.times).flatMap((slot) => {
    const stored = getiStoredTimeSlot(slot);
    return stored === null ? [] : [stored];
  });
  if (times.length === 0) return includeUnknown;
  return times.some((slot) => getiTimeSlotMatches(slot, from, to));
}

/** Durée comptée à une heure seule (« à partir de 21h ») : le créneau est dit fini deux heures après. */
export const GETI_SINGLE_TIME_MINUTES = 120;

/**
 * Fin du dernier horaire d'une annonce, en minutes depuis minuit du jour visé
 * (au-delà de 1440 : le lendemain, « 22h-1h » finit à 1500) : la fin d'une
 * plage, deux heures après une heure seule, la fin de la journée sans horaire.
 *
 * @param times Horaires gardés (`availability.times`) ; un horaire abîmé est ignoré.
 */
export function getiSlotEndMinutes(times: readonly unknown[] | null | undefined): number {
  let end = 0;
  for (const slot of wanted<unknown>(times)) {
    const stored = getiStoredTimeSlot(slot);
    if (stored === null) continue;
    const stop = stored.to === null ? stored.from + GETI_SINGLE_TIME_MINUTES : stored.to;
    end = Math.max(end, stop <= stored.from ? stop + DAY_MINUTES : stop);
  }
  return end === 0 ? DAY_MINUTES : end;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** Dates visées d'une analyse gardée (« AAAA-MM-JJ »), en millisecondes UTC à minuit ; une date abîmée est ignorée. */
function storedDays(post: GetiParsedPost): number[] {
  return wanted<unknown>(post.dates).flatMap((iso) => {
    const match = typeof iso === "string" ? ISO_DAY.exec(iso) : null;
    if (match === null) return [];
    const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(day) ? [] : [day];
  });
}

/**
 * Instant où la dernière soirée visée par l'annonce est finie (heure de
 * Paris) : sa dernière date, à la fin de son dernier horaire
 * ({@link getiSlotEndMinutes}). `null` pour une annonce sans date : elle ne
 * passe jamais.
 *
 * @param post Annonce analysée (dates et horaires à l'heure de Paris).
 * @returns L'instant en millisecondes, ou `null`.
 */
export function getiPostEndsAt(post: GetiParsedPost): number | null {
  const days = storedDays(post);
  if (days.length === 0) return null;
  return getiWallInstant(Math.max(...days), getiSlotEndMinutes(post.availability?.times));
}

/**
 * L'annonce est-elle passée ? Toutes ses dates visées sont finies à `now`
 * ({@link getiPostEndsAt}). Une annonce sans date ne l'est jamais.
 */
export function isGetiPostPast(post: GetiParsedPost, now: number): boolean {
  const ends = getiPostEndsAt(post);
  return ends !== null && now >= ends;
}

function weekdayOf(day: number): GetiDay {
  return GETI_DAYS[(new Date(day).getUTCDay() + 6) % 7];
}

/**
 * Jours d'une annonce pour le filtre : un jour voulu désigne une soirée **à
 * venir**. Le jour d'une date déjà finie ne compte plus (sauf si une date à
 * venir tombe le même jour) ; une annonce dont tous les jours sont passés ne
 * répond à aucun jour, même avec `includeUnknown`.
 */
function matchesDays(post: GetiParsedPost, days: readonly GetiDay[], includeUnknown: boolean, now: number): boolean {
  if (days.length === 0) return true;
  const found = wanted(post.availability?.days);
  if (found.length === 0) return includeUnknown;
  const dated = storedDays(post);
  if (dated.length === 0) return days.some((day) => found.includes(day));
  const end = getiSlotEndMinutes(post.availability?.times);
  const upcoming = new Set<GetiDay>();
  const over = new Set<GetiDay>();
  for (const day of dated) (now >= getiWallInstant(day, end) ? over : upcoming).add(weekdayOf(day));
  return days.some((day) => found.includes(day) && (upcoming.has(day) || !over.has(day)));
}

function matchesAge(post: GetiParsedPost, stored: number | null | undefined, now: number): boolean {
  if (stored === null || stored === undefined) return true;
  // Un JSON enregistré peut porter « "24" » : lu comme un nombre. Une limite
  // illisible (« "24h" », « "" », objet) n'est jamais lue comme « sans limite » :
  // rien ne passe. Un nombre nul, négatif ou non fini : sans limite.
  const maxAgeHours = storedNumber(stored);
  if (typeof stored !== "number" && Number.isNaN(maxAgeHours)) return false;
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) return true;
  // Une annonce sans date ne peut pas être dite récente.
  if (post.postedAt === null) return false;
  const posted = Date.parse(post.postedAt);
  // Une date dans le futur n'est pas récente : elle resterait en tête des années durant.
  return !Number.isNaN(posted) && posted <= now + CLOCK_SKEW_MS && now - posted <= maxAgeHours * HOUR_MS;
}

/** Option à deux états d'un filtre enregistré : `true`, ou « "true" » (JSON écrit à la main). */
function isOn(value: unknown): boolean {
  return value === true || value === "true";
}

/**
 * Dit si une annonce analysée passe un filtre. Chaque critère renseigné doit
 * passer (ET) ; dans un critère à plusieurs valeurs, une seule suffit (OU).
 *
 * - **Catégorie** : égalité.
 * - **Rangs** : la fourchette de l'annonce recoupe celle du filtre ; avec des
 *   rôles voulus et un rang par rôle dans l'annonce, seuls ces rôles comptent.
 * - **Rôles** : un rôle voulu est dans l'annonce, ou l'annonce dit « Flex ».
 * - **Région, plateforme, langue, niveau, sous-rôle, rôle de staff, jour** : une
 *   valeur voulue est dans l'annonce.
 * - **Horaire** : un horaire de l'annonce recoupe le créneau voulu.
 * - **Jour** : une date déjà finie ne compte plus, un jour voulu désigne une soirée à venir.
 * - **Annonces closes** : écartées avec `hideClosed`.
 * - **Annonces passées** (toutes les dates visées sont finies) : écartées avec `hidePast`.
 * - **Âge** : publiée depuis `maxAgeHours` au plus ; sans date, écartée.
 *
 * Une annonce où le critère n'a pas été lu est écartée, sauf `includeUnknown`.
 *
 * Filtre enregistré (JSON) : une catégorie inconnue, une liste qui n'en est
 * pas une ou une borne de rang invalide est ignorée ; « "3" » et « "true" »
 * valent 3 et `true` ; une limite d'âge illisible écarte tout.
 *
 * @param post Annonce analysée (`parseGetiPost`).
 * @param stored Critères ; absent, `null` ou vide = non filtré.
 * @param now Instant de référence en millisecondes (par défaut : maintenant).
 * @returns `true` si l'annonce passe tous les critères.
 */
export function matchesGetiFilter(post: GetiParsedPost, stored: GetiFilter, now: number = Date.now()): boolean {
  // Filtre enregistré : `null` ou une valeur qui n'est pas un objet ne filtre rien.
  const filter: GetiFilter = typeof stored === "object" && stored !== null ? stored : {};
  const includeUnknown = isOn(filter.includeUnknown);
  // Une catégorie enregistrée inconnue (« "LFP" », 5) ne filtre rien, comme une liste invalide.
  const category = GETI_CATEGORIES.find((known) => known === filter.category);
  if (category !== undefined && post.category !== category) return false;
  if (isOn(filter.hideClosed) && post.closed) return false;
  if (isOn(filter.hidePast) && isGetiPostPast(post, now)) return false;
  return (
    matchesAge(post, filter.maxAgeHours, now) &&
    matchesRoles(post, filter, includeUnknown) &&
    matchesRanks(post, filter, includeUnknown) &&
    matchesAny(post.regions, wanted(filter.regions), includeUnknown) &&
    matchesAny(post.platforms, wanted(filter.platforms), includeUnknown) &&
    matchesAny(post.languages, wanted(filter.languages), includeUnknown) &&
    matchesAny(post.levels, wanted(filter.levels), includeUnknown) &&
    matchesAny(post.subRoles, wanted(filter.subRoles), includeUnknown) &&
    matchesAny(post.staffRoles, wanted(filter.staffRoles), includeUnknown) &&
    matchesDays(post, wanted(filter.days), includeUnknown, now) &&
    matchesTime(post, filter, includeUnknown)
  );
}

/**
 * Garde les annonces qui passent un filtre, en lisant l'horloge **une seule
 * fois** : une annonce au bord de la limite d'âge passerait ou non
 * selon sa place dans la liste.
 *
 * @param posts Annonces analysées.
 * @param filter Critères (voir {@link matchesGetiFilter}).
 * @param now Instant de référence en millisecondes (par défaut : maintenant).
 * @returns Les annonces retenues, dans leur ordre.
 */
export function filterGetiPosts<T extends GetiParsedPost>(
  posts: readonly T[],
  filter: GetiFilter,
  now: number = Date.now(),
): T[] {
  return posts.filter((post) => matchesGetiFilter(post, filter, now));
}
