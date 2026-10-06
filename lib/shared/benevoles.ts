import { isStoredUploadIn, toDiskUploadPath } from "./uploads";
import { INTL_LOCALE, type Locale } from "./locales";
import { checkEnglish, englishCodes, hasEnglish, staffText } from "./staff-translation";

export type Benevole = {
  id: number;
  firstName: string;
  pseudo: string | null;
  lastName: string;
  category: string;
  /**
   * Catégorie en anglais (lot 5b) ; `null` tant qu'elle n'est pas saisie. Une
   * catégorie se traduit **en bloc** : l'enregistrement d'un bénévole recopie
   * son anglais sur toute sa catégorie (`benevoles-service.ts`). Sous `/en`, une
   * catégorie sans anglais n'est pas rendue.
   */
  categoryEn: string | null;
  photoUrl: string | null;
  joinedAt: string; // YYYY-MM-DD
};

export type BenevoleInput = {
  firstName: string;
  pseudo?: string | null;
  lastName: string;
  category: string;
  categoryEn?: string | null;
  photoUrl?: string | null;
  joinedAt: string;
};

export type BenevoleNormalized = {
  firstName: string;
  pseudo: string;
  lastName: string;
  category: string;
  categoryEn: string;
  photoUrl: string;
  joinedAt: string;
};

export const BENEVOLE_FIRST_NAME_MAX = 80;
export const BENEVOLE_LAST_NAME_MAX = 80;
export const BENEVOLE_PSEUDO_MAX = 80;
export const BENEVOLE_CATEGORY_MAX = 120;
export const BENEVOLE_PHOTO_URL_MAX = 500;

export type BenevoleValidationResult =
  | { ok: true; value: BenevoleNormalized }
  | { ok: false; error: string };

function benevoleNameError(firstName: string, lastName: string, pseudo: string): string | null {
  if (firstName.length > BENEVOLE_FIRST_NAME_MAX) return "FIRST_NAME_TOO_LONG";
  if (lastName.length > BENEVOLE_LAST_NAME_MAX) return "LAST_NAME_TOO_LONG";
  // Prénom/nom civil facultatif : un pseudo seul suffit à identifier le bénévole.
  // Mais un prénom/nom partiel (l'un sans l'autre) reste invalide.
  if (!firstName && !lastName && !pseudo) return "NAME_REQUIRED";
  if (firstName && !lastName) return "LAST_NAME_REQUIRED";
  if (lastName && !firstName) return "FIRST_NAME_REQUIRED";
  return null;
}

function benevoleCategoryError(category: string): string | null {
  if (!category) return "CATEGORY_REQUIRED";
  if (category.length > BENEVOLE_CATEGORY_MAX) return "CATEGORY_TOO_LONG";
  return null;
}

/** Date d'arrivée `AAAA-MM-JJ`, refusée si elle n'existe pas au calendrier. */
function benevoleJoinedAtError(joinedAt: string): string | null {
  if (!joinedAt) return "JOINED_AT_REQUIRED";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinedAt)) return "JOINED_AT_INVALID";
  const [y, m, d] = joinedAt.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return "JOINED_AT_INVALID";
  }
  return null;
}

function benevoleExtrasError(pseudo: string, photoUrl: string): string | null {
  if (pseudo && pseudo.length > BENEVOLE_PSEUDO_MAX) return "PSEUDO_TOO_LONG";
  if (photoUrl && photoUrl.length > BENEVOLE_PHOTO_URL_MAX) return "PHOTO_URL_TOO_LONG";
  // Une photo téléversée vit dans `benevoles/` : une autre adresse d'upload
  // (avatar d'un joueur, logo d'une équipe) serait effacée au remplacement de
  // la photo. Une adresse étrangère reste acceptée ; `localUploadUrl` la
  // tait à la sortie.
  if (photoUrl && toDiskUploadPath(photoUrl) !== null && !isStoredUploadIn(photoUrl, "benevoles")) {
    return "INVALID_PHOTO_URL";
  }
  return null;
}

export function validateBenevoleInput(input: BenevoleInput): BenevoleValidationResult {
  const firstName = typeof input.firstName === "string" ? input.firstName.trim() : "";
  const lastName = typeof input.lastName === "string" ? input.lastName.trim() : "";
  const pseudo = typeof input.pseudo === "string" ? input.pseudo.trim() : "";
  const category = typeof input.category === "string" ? input.category.trim() : "";
  const photoUrl = typeof input.photoUrl === "string" ? input.photoUrl.trim() : "";
  const joinedAt = typeof input.joinedAt === "string" ? input.joinedAt.trim() : "";

  const error =
    benevoleNameError(firstName, lastName, pseudo) ??
    benevoleCategoryError(category);
  if (error) return { ok: false, error };
  // Anglais de la catégorie obligatoire (D9), vérifié juste après le français.
  const categoryEn = checkEnglish(input.categoryEn, true, BENEVOLE_CATEGORY_MAX, englishCodes("CATEGORY"));
  if (!categoryEn.ok) return categoryEn;
  const later = benevoleJoinedAtError(joinedAt) ?? benevoleExtrasError(pseudo, photoUrl);
  if (later) return { ok: false, error: later };

  return {
    ok: true,
    value: { firstName, lastName, pseudo, category, categoryEn: categoryEn.value ?? "", photoUrl, joinedAt },
  };
}

export type CategoryReorderResult =
  | { ok: true; categories: string[] }
  | { ok: false; error: string };

/**
 * Valide une liste ordonnée de noms de catégories (nouvel ordre d'affichage).
 * Refuse une liste vide, une entrée non-string / vide, ou un doublon (après
 * trim). Partagé client/serveur pour réordonner les catégories de bénévoles.
 */
export function validateCategoryReorder(raw: unknown): CategoryReorderResult {
  if (!Array.isArray(raw)) return { ok: false, error: "CATEGORIES_REQUIRED" };
  if (raw.length === 0) return { ok: false, error: "CATEGORIES_EMPTY" };

  const categories: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") return { ok: false, error: "INVALID_CATEGORY" };
    const category = entry.trim();
    if (!category) return { ok: false, error: "INVALID_CATEGORY" };
    if (seen.has(category)) return { ok: false, error: "DUPLICATE_CATEGORY" };
    seen.add(category);
    categories.push(category);
  }

  return { ok: true, categories };
}

/** Groupe une liste plate de bénévoles par catégorie, dans l'ordre de première apparition. */
export function groupByCategory(benevoles: Benevole[]): { category: string; members: Benevole[] }[] {
  const map = new Map<string, Benevole[]>();
  for (const b of benevoles) {
    if (!map.has(b.category)) map.set(b.category, []);
    map.get(b.category)!.push(b);
  }
  return Array.from(map.entries()).map(([category, members]) => ({ category, members }));
}

/**
 * L'anglais d'une catégorie : celui du premier de ses bénévoles qui en a un
 * (tous le partagent depuis le lot 5b ; une ligne plus ancienne peut ne pas
 * l'avoir encore), `null` si aucun.
 */
export function categoryEnglish(members: readonly Pick<Benevole, "categoryEn">[]): string | null {
  for (const member of members) if (hasEnglish(member.categoryEn)) return member.categoryEn.trim();
  return null;
}

/**
 * Les catégories dans la langue de la page : intitulé traduit, et sous `/en`,
 * seulement celles qui ont leur anglais — jamais de français sur la page
 * anglaise (`staff-translation.ts`).
 */
export function localizedCategories(
  benevoles: Benevole[],
  locale: Locale,
): { category: string; label: string; members: Benevole[] }[] {
  return groupByCategory(benevoles).flatMap(({ category, members }) => {
    const label = staffText(category, categoryEnglish(members), locale);
    return label === null ? [] : [{ category, label, members }];
  });
}

/**
 * Formate le nom d'affichage : Prénom "Pseudo" NOM. Sans prénom/nom complet,
 * retombe sur le pseudo seul, puis sur le prénom ou le nom isolé le cas
 * échéant (donnée historique/partielle) plutôt que de renvoyer une chaîne vide.
 */
export function formatDisplayName(b: Pick<Benevole, "firstName" | "pseudo" | "lastName">): string {
  if (b.firstName && b.lastName) {
    const parts: string[] = [b.firstName];
    if (b.pseudo) parts.push(`"${b.pseudo}"`);
    parts.push(b.lastName.toUpperCase());
    return parts.join(" ");
  }
  return b.pseudo || b.firstName || b.lastName.toUpperCase();
}

/** Initiales d'avatar : Prénom+Nom si les deux sont renseignés, sinon la première lettre du pseudo. */
export function benevoleInitials(b: Pick<Benevole, "firstName" | "pseudo" | "lastName">): string {
  if (b.firstName && b.lastName) return `${b.firstName[0]}${b.lastName[0]}`.toUpperCase();
  return b.pseudo ? b.pseudo[0].toUpperCase() : "?";
}

/** Formate une date ISO (YYYY-MM-DD) en date française (dd/mm/yyyy). */
export function formatJoinedAt(iso: string, locale: Locale = "fr"): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  if (locale === "fr") return `${day}/${month}/${year}`;
  // Sous `/en` : « Oct 6, 2026 » — une date en chiffres s'y lirait mois et jour inversés.
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(INTL_LOCALE[locale], { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Champ du formulaire que chaque refus de catégorie désigne (`useFieldErrors`). */
export const BENEVOLE_FIELD_ERRORS = {
  CATEGORY_REQUIRED: "category",
  CATEGORY_TOO_LONG: "category",
  CATEGORY_EN_REQUIRED: "categoryEn",
  CATEGORY_EN_TOO_LONG: "categoryEn",
} as const;
