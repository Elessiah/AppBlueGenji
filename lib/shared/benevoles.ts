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

  if (!firstName) return { ok: false, error: "FIRST_NAME_REQUIRED" };
  if (firstName.length > BENEVOLE_FIRST_NAME_MAX) return { ok: false, error: "FIRST_NAME_TOO_LONG" };
  if (!lastName) return { ok: false, error: "LAST_NAME_REQUIRED" };
  if (lastName.length > BENEVOLE_LAST_NAME_MAX) return { ok: false, error: "LAST_NAME_TOO_LONG" };
  if (!category) return { ok: false, error: "CATEGORY_REQUIRED" };
  if (category.length > BENEVOLE_CATEGORY_MAX) return { ok: false, error: "CATEGORY_TOO_LONG" };
  if (!joinedAt) return { ok: false, error: "JOINED_AT_REQUIRED" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinedAt)) return { ok: false, error: "JOINED_AT_INVALID" };
  if (pseudo && pseudo.length > BENEVOLE_PSEUDO_MAX) return { ok: false, error: "PSEUDO_TOO_LONG" };
  if (photoUrl && photoUrl.length > BENEVOLE_PHOTO_URL_MAX) return { ok: false, error: "PHOTO_URL_TOO_LONG" };

  return {
    ok: true,
    value: { firstName, lastName, pseudo, category, photoUrl, joinedAt },
  };
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

/** Formate le nom d'affichage : Prénom "Pseudo" NOM */
export function formatDisplayName(b: Pick<Benevole, "firstName" | "pseudo" | "lastName">): string {
  const parts: string[] = [b.firstName];
  if (b.pseudo) parts.push(`"${b.pseudo}"`);
  parts.push(b.lastName.toUpperCase());
  return parts.join(" ");
}

/** Formate une date ISO (YYYY-MM-DD) en date française (dd/mm/yyyy). */
export function formatJoinedAt(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}
