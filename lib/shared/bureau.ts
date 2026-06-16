export type BureauMember = {
  id: number;
  name: string;
  role: string;
  initials: string;
  color: string;
};

export type BureauMemberInput = {
  name: string;
  role: string;
  initials?: string;
  color?: string;
};

/** Palette de couleurs « cyber » utilisée pour les sigles du bureau. */
export const BUREAU_COLORS = [
  "rgb(89, 212, 255)", // bleu glacier
  "rgb(245, 195, 58)", // ambre
  "rgb(255, 157, 46)", // orange
  "rgb(167, 115, 255)", // violet
  "rgb(79, 224, 162)", // vert
  "rgb(255, 110, 130)", // rose/rouge
  "rgb(120, 200, 120)", // vert tendre
  "rgb(255, 214, 102)", // jaune doux
] as const;

/** Renvoie une couleur aléatoire de la palette du bureau. */
export function randomBureauColor(): string {
  return BUREAU_COLORS[Math.floor(Math.random() * BUREAU_COLORS.length)];
}

/**
 * Calcule les initiales (max 3 caractères) à partir d'un nom complet :
 * première lettre des deux premiers mots, ou les deux premières lettres
 * si le nom est en un seul mot. Toujours en majuscules.
 */
export function computeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export const BUREAU_NAME_MAX = 120;
export const BUREAU_ROLE_MAX = 120;
export const BUREAU_INITIALS_MAX = 4;
export const BUREAU_COLOR_MAX = 40;

export type BureauValidationResult =
  | { ok: true; value: Required<BureauMemberInput> }
  | { ok: false; error: string };

/**
 * Valide et normalise une entrée de membre du bureau. Les initiales et la
 * couleur sont dérivées automatiquement si absentes (initiales depuis le nom,
 * couleur aléatoire de la palette).
 */
export function validateBureauInput(input: BureauMemberInput): BureauValidationResult {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const role = typeof input.role === "string" ? input.role.trim() : "";

  if (!name) return { ok: false, error: "NAME_REQUIRED" };
  if (name.length > BUREAU_NAME_MAX) return { ok: false, error: "NAME_TOO_LONG" };
  if (!role) return { ok: false, error: "ROLE_REQUIRED" };
  if (role.length > BUREAU_ROLE_MAX) return { ok: false, error: "ROLE_TOO_LONG" };

  const rawInitials = typeof input.initials === "string" ? input.initials.trim() : "";
  const initials = (rawInitials || computeInitials(name)).slice(0, BUREAU_INITIALS_MAX).toUpperCase();
  if (!initials) return { ok: false, error: "INITIALS_REQUIRED" };

  const color = (typeof input.color === "string" && input.color.trim()
    ? input.color.trim()
    : randomBureauColor()
  ).slice(0, BUREAU_COLOR_MAX);

  return { ok: true, value: { name, role, initials, color } };
}
