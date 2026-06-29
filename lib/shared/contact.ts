/**
 * Contact presse de l'association. L'email est stocké en base (clé/valeur) et
 * modifiable par les admins ; cette valeur sert de secours tant qu'aucune
 * n'a été enregistrée. Partagé client/serveur.
 */
export const DEFAULT_PRESS_EMAIL = "presse@bluegenji-esport.fr";

/** Clé de stockage dans la table `bg_settings`. */
export const PRESS_EMAIL_KEY = "press_email";

export const PRESS_EMAIL_MAX = 254;

// Validation volontairement permissive : un seul `@`, des deux côtés non vides,
// un point dans le domaine. On reste laxiste pour ne pas rejeter d'adresses
// valides exotiques tout en bloquant les saisies manifestement erronées.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/** Valide et normalise (trim + minuscules) une adresse email de contact. */
export function validatePressEmail(input: unknown): EmailValidationResult {
  const email = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (!email) return { ok: false, error: "EMAIL_REQUIRED" };
  if (email.length > PRESS_EMAIL_MAX) return { ok: false, error: "EMAIL_TOO_LONG" };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "EMAIL_INVALID" };
  return { ok: true, value: email };
}
