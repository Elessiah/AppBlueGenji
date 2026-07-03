export type ReorderValidationResult =
  | { ok: true; ids: number[] }
  | { ok: false; error: string };

/**
 * Valide une liste d'identifiants représentant un nouvel ordre d'affichage.
 * Refuse une liste vide, un id non entier / négatif, ou un doublon. Partagé
 * client/serveur pour réordonner bureau, cartes « association » et partenaires.
 */
export function validateReorderIds(raw: unknown): ReorderValidationResult {
  if (!Array.isArray(raw)) return { ok: false, error: "IDS_REQUIRED" };
  if (raw.length === 0) return { ok: false, error: "IDS_EMPTY" };

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const entry of raw) {
    const id = Number(entry);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "INVALID_ID" };
    if (seen.has(id)) return { ok: false, error: "DUPLICATE_ID" };
    seen.add(id);
    ids.push(id);
  }

  return { ok: true, ids };
}
