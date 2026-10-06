import type { Locale } from "@/lib/shared/locales";
import { checkEnglish, englishCodes, englishErrorMessage, staffText } from "@/lib/shared/staff-translation";

export type BureauMember = {
  id: number;
  name: string;
  role: string;
  /** Rôle en anglais (lot 5b) ; `null` tant qu'il n'est pas saisi — le membre n'est alors pas rendu sous `/en`. */
  roleEn: string | null;
  initials: string;
  color: string;
};

export type BureauMemberInput = {
  name: string;
  role: string;
  roleEn?: string | null;
  initials?: string;
  color?: string;
};

/**
 * Bureau affiché tant qu'aucune ligne n'existe en base (ou si la base est
 * injoignable). Les `id` négatifs marquent ces membres « de secours » comme
 * non modifiables côté interface. Partagé client/serveur.
 */
export const FALLBACK_BUREAU: BureauMember[] = [
  { id: -1, name: "Léo Perreaut", role: "Président", roleEn: "President", initials: "LP", color: "rgb(89, 212, 255)" },
  { id: -2, name: "Bryan Boulleaux", role: "Trésorier", roleEn: "Treasurer", initials: "BB", color: "rgb(247, 138, 216)" },
  { id: -3, name: "Sophie Martin", role: "Secrétaire", roleEn: "Secretary", initials: "SM", color: "rgb(62, 232, 176)" },
  { id: -4, name: "Jérôme Dubois", role: "Responsable arbitrage", roleEn: "Head of refereeing", initials: "JD", color: "rgb(167, 115, 255)" },
];

/**
 * Palette « néon froid » des sigles du bureau (`DESIGN_SYSTEM.md`) : aucune
 * teinte chaude — l'ambre est réservé aux avertissements. Les couleurs déjà
 * enregistrées en base restent telles quelles.
 */
export const BUREAU_COLORS = [
  "rgb(89, 212, 255)", // bleu glacier
  "rgb(62, 230, 255)", // cyan
  "rgb(167, 139, 250)", // violet
  "rgb(196, 181, 253)", // lavande
  "rgb(247, 138, 216)", // rose néon
  "rgb(62, 232, 176)", // vert d'eau
  "rgb(143, 213, 255)", // bleu clair
] as const;

/** Renvoie une couleur aléatoire de la palette du bureau. */
export function randomBureauColor(): string {
  return BUREAU_COLORS[Math.floor(Math.random() * BUREAU_COLORS.length)]; // NOSONAR typescript:S2245 — couleur décorative
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
  | { ok: true; value: Required<Omit<BureauMemberInput, "roleEn">> & { roleEn: string } }
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
  // Anglais obligatoire (D9) : sans lui, le membre manquerait à la page anglaise.
  const roleEn = checkEnglish(input.roleEn, true, BUREAU_ROLE_MAX, englishCodes("ROLE"));
  if (!roleEn.ok) return roleEn;

  const rawInitials = typeof input.initials === "string" ? input.initials.trim() : "";
  // Découpe par point de code (et non par unité UTF-16) pour ne jamais couper
  // une paire de substituts — sinon MySQL utf8mb4 rejetterait la chaîne.
  const initials = [...(rawInitials || computeInitials(name))]
    .slice(0, BUREAU_INITIALS_MAX)
    .join("")
    .toUpperCase();
  if (!initials) return { ok: false, error: "INITIALS_REQUIRED" };

  const color = (typeof input.color === "string" && input.color.trim()
    ? input.color.trim()
    : randomBureauColor()
  ).slice(0, BUREAU_COLOR_MAX);

  return { ok: true, value: { name, role, roleEn: roleEn.value ?? "", initials, color } };
}

/**
 * Le bureau dans la langue de la page : chaque membre avec son rôle traduit et
 * sa place dans la liste complète (le réordonnancement porte sur elle). Sous
 * `/en`, un membre sans rôle anglais n'est pas rendu (`staff-translation.ts`).
 */
export function localizedBureau(
  members: readonly BureauMember[],
  locale: Locale,
): { member: BureauMember; role: string; index: number }[] {
  return members.flatMap((member, index) => {
    const role = staffText(member.role, member.roleEn, locale);
    return role === null ? [] : [{ member, role, index }];
  });
}

/** Champ du formulaire que chaque refus désigne (`useFieldErrors`). */
export const BUREAU_FIELD_ERRORS = {
  ROLE_REQUIRED: "role",
  ROLE_TOO_LONG: "role",
  ROLE_EN_REQUIRED: "roleEn",
  ROLE_EN_TOO_LONG: "roleEn",
} as const;

const BUREAU_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  NAME_REQUIRED: "Le nom est requis.",
  NAME_TOO_LONG: `Nom trop long (${BUREAU_NAME_MAX} caractères maximum).`,
  ROLE_REQUIRED: "Le rôle est requis.",
  ROLE_TOO_LONG: `Rôle trop long (${BUREAU_ROLE_MAX} caractères maximum).`,
};

/** Phrase d'un refus (staff, en français — D4) ; un code inconnu garde « Échec : CODE ». */
export function bureauErrorMessage(code: string | null | undefined, fallback: string): string {
  if (!code) return fallback;
  if (Object.hasOwn(BUREAU_ERROR_MESSAGES, code)) return BUREAU_ERROR_MESSAGES[code];
  return englishErrorMessage(code) ?? `Échec : ${code}`;
}
