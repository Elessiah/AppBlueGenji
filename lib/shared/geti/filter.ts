/**
 * Filtre des annonces GETI : même règle pour la recherche de la page et pour
 * les alertes sur un filtre enregistré.
 *
 * Module pur : importable côté serveur comme côté client.
 */
import { GETI_RANK_TOP, getiRankValue } from "@/lib/shared/geti/ranks";
import type { GetiFilter, GetiParsedPost, GetiRankRange } from "@/lib/shared/geti/types";

const HOUR_MS = 3_600_000;

function wanted<T>(values: readonly T[] | null | undefined): readonly T[] {
  return values ?? [];
}

/** Au moins une valeur voulue est dans l'annonce ; champ non lu : selon `includeUnknown`. */
function matchesAny<T>(found: readonly T[], values: readonly T[], includeUnknown: boolean): boolean {
  if (values.length === 0) return true;
  if (found.length === 0) return includeUnknown;
  return values.some((value) => found.includes(value));
}

function matchesRoles(post: GetiParsedPost, filter: GetiFilter, includeUnknown: boolean): boolean {
  const roles = wanted(filter.roles);
  if (roles.length === 0) return true;
  if (post.roles.length === 0) return includeUnknown;
  // « Flex » dans l'annonce : tous les rôles sont joués (ou acceptés).
  return post.roles.includes("FLEX") || roles.some((role) => post.roles.includes(role));
}

/**
 * Fourchettes à comparer : celles des rôles voulus quand l'annonce donne un
 * rang par rôle, sinon sa fourchette globale.
 */
function rankRangesOf(post: GetiParsedPost, filter: GetiFilter): GetiRankRange[] {
  const perRole = wanted(filter.roles).flatMap((role) => {
    const range = role === "FLEX" ? undefined : post.ranks.byRole[role];
    return range === undefined ? [] : [range];
  });
  if (perRole.length > 0) return perRole;
  return post.ranks.min === null || post.ranks.max === null ? [] : [{ min: post.ranks.min, max: post.ranks.max }];
}

function matchesRanks(post: GetiParsedPost, filter: GetiFilter, includeUnknown: boolean): boolean {
  const min = filter.ranks?.min ?? null;
  const max = filter.ranks?.max ?? null;
  if (min === null && max === null) return true;
  const ranges = rankRangesOf(post, filter);
  if (ranges.length === 0) return includeUnknown;
  const low = min === null ? 0 : getiRankValue(min);
  const high = max === null ? GETI_RANK_TOP : getiRankValue(max);
  // Deux fourchettes se recoupent, bornes comprises.
  return ranges.some((range) => getiRankValue(range.max) >= low && getiRankValue(range.min) <= high);
}

function matchesAge(post: GetiParsedPost, maxAgeHours: number | null | undefined, now: number): boolean {
  if (maxAgeHours === null || maxAgeHours === undefined || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    return true;
  }
  // Une annonce sans date ne peut pas être dite récente.
  if (post.postedAt === null) return false;
  const posted = Date.parse(post.postedAt);
  return !Number.isNaN(posted) && now - posted <= maxAgeHours * HOUR_MS;
}

/**
 * Dit si une annonce analysée passe un filtre. Chaque critère renseigné doit
 * passer (ET) ; dans un critère à plusieurs valeurs, une seule suffit (OU).
 *
 * - **Catégorie** : égalité.
 * - **Rangs** : la fourchette de l'annonce recoupe celle du filtre ; avec des
 *   rôles voulus et un rang par rôle dans l'annonce, seuls ces rôles comptent.
 * - **Rôles** : un rôle voulu est dans l'annonce, ou l'annonce dit « Flex ».
 * - **Région, plateforme, langue, niveau** : une valeur voulue est dans l'annonce.
 * - **Annonces closes** : écartées avec `hideClosed`.
 * - **Âge** : publiée depuis `maxAgeHours` au plus ; sans date, écartée.
 *
 * Une annonce où le critère n'a pas été lu est écartée, sauf `includeUnknown`.
 *
 * @param post Annonce analysée (`parseGetiPost`).
 * @param filter Critères ; absent, `null` ou vide = non filtré.
 * @param now Instant de référence en millisecondes (par défaut : maintenant).
 * @returns `true` si l'annonce passe tous les critères.
 */
export function matchesGetiFilter(post: GetiParsedPost, filter: GetiFilter, now: number = Date.now()): boolean {
  const includeUnknown = filter.includeUnknown === true;
  if (filter.category !== null && filter.category !== undefined && post.category !== filter.category) return false;
  if (filter.hideClosed === true && post.closed) return false;
  return (
    matchesAge(post, filter.maxAgeHours, now) &&
    matchesRoles(post, filter, includeUnknown) &&
    matchesRanks(post, filter, includeUnknown) &&
    matchesAny(post.regions, wanted(filter.regions), includeUnknown) &&
    matchesAny(post.platforms, wanted(filter.platforms), includeUnknown) &&
    matchesAny(post.languages, wanted(filter.languages), includeUnknown) &&
    matchesAny(post.levels, wanted(filter.levels), includeUnknown)
  );
}
