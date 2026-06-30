export type AboutStat = {
  id: number;
  value: string;
  label: string;
};

export type AboutStatInput = {
  value: string;
  label: string;
};

/**
 * Cartes affichées sous le titre « L'association » tant qu'aucune ligne n'existe
 * en base (ou si la base est injoignable). Les `id` négatifs marquent ces cartes
 * « de secours » comme non modifiables côté interface. Partagé client/serveur.
 */
export const FALLBACK_ABOUT_STATS: AboutStat[] = [
  { id: -1, value: "100%", label: "Bénévole" },
  { id: -2, value: "€4 200", label: "Prizepool 2025" },
  { id: -3, value: "12", label: "Arbitres" },
  { id: -4, value: "0 €", label: "Frais d'inscription" },
];

export const ABOUT_STAT_VALUE_MAX = 40;
export const ABOUT_STAT_LABEL_MAX = 60;

export type AboutStatValidationResult =
  | { ok: true; value: AboutStatInput }
  | { ok: false; error: string };

/** Valide et normalise une carte (valeur + titre). Les deux champs sont requis. */
export function validateAboutStatInput(input: AboutStatInput): AboutStatValidationResult {
  const value = typeof input.value === "string" ? input.value.trim() : "";
  const label = typeof input.label === "string" ? input.label.trim() : "";

  if (!value) return { ok: false, error: "VALUE_REQUIRED" };
  if (value.length > ABOUT_STAT_VALUE_MAX) return { ok: false, error: "VALUE_TOO_LONG" };
  if (!label) return { ok: false, error: "LABEL_REQUIRED" };
  if (label.length > ABOUT_STAT_LABEL_MAX) return { ok: false, error: "LABEL_TOO_LONG" };

  return { ok: true, value: { value, label } };
}
