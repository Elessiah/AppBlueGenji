export type Benevole = {
  id: number;
  firstName: string;
  pseudo: string | null;
  lastName: string;
  category: string;
  photoUrl: string | null;
  joinedAt: string; // YYYY-MM-DD
};

export type BenevoleInput = {
  firstName: string;
  pseudo?: string | null;
  lastName: string;
  category: string;
  photoUrl?: string | null;
  joinedAt: string;
};

export type BenevoleNormalized = {
  firstName: string;
  pseudo: string;
  lastName: string;
  category: string;
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

export function validateBenevoleInput(input: BenevoleInput): BenevoleValidationResult {
  const firstName = typeof input.firstName === "string" ? input.firstName.trim() : "";
  const lastName = typeof input.lastName === "string" ? input.lastName.trim() : "";
  const pseudo = typeof input.pseudo === "string" ? input.pseudo.trim() : "";
  const category = typeof input.category === "string" ? input.category.trim() : "";
  const photoUrl = typeof input.photoUrl === "string" ? input.photoUrl.trim() : "";
  const joinedAt = typeof input.joinedAt === "string" ? input.joinedAt.trim() : "";

  if (firstName.length > BENEVOLE_FIRST_NAME_MAX) return { ok: false, error: "FIRST_NAME_TOO_LONG" };
  if (lastName.length > BENEVOLE_LAST_NAME_MAX) return { ok: false, error: "LAST_NAME_TOO_LONG" };
  // Prénom/nom civil facultatif : un pseudo seul suffit à identifier le bénévole.
  // Mais un prénom/nom partiel (l'un sans l'autre) reste invalide.
  if (!firstName && !lastName && !pseudo) return { ok: false, error: "NAME_REQUIRED" };
  if (firstName && !lastName) return { ok: false, error: "LAST_NAME_REQUIRED" };
  if (lastName && !firstName) return { ok: false, error: "FIRST_NAME_REQUIRED" };
  if (!category) return { ok: false, error: "CATEGORY_REQUIRED" };
  if (category.length > BENEVOLE_CATEGORY_MAX) return { ok: false, error: "CATEGORY_TOO_LONG" };
  if (!joinedAt) return { ok: false, error: "JOINED_AT_REQUIRED" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinedAt)) return { ok: false, error: "JOINED_AT_INVALID" };
  {
    const [y, m, d] = joinedAt.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
      return { ok: false, error: "JOINED_AT_INVALID" };
    }
  }
  if (pseudo && pseudo.length > BENEVOLE_PSEUDO_MAX) return { ok: false, error: "PSEUDO_TOO_LONG" };
  if (photoUrl && photoUrl.length > BENEVOLE_PHOTO_URL_MAX) return { ok: false, error: "PHOTO_URL_TOO_LONG" };

  return {
    ok: true,
    value: { firstName, lastName, pseudo, category, photoUrl, joinedAt },
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
export function formatJoinedAt(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}
