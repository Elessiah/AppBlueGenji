/**
 * Nom d'une équipe : bornes et contrôle de forme.
 *
 * La création contrôlait le nom (3 à 60 caractères), le **renommage** ne
 * contrôlait rien : depuis la fiche, un propriétaire pouvait vider le nom de son
 * équipe, le réduire à deux lettres, ou le rallonger au-delà de la colonne
 * (`VARCHAR(60)`) — auquel cas c'est le message brut de MySQL qui partait dans la
 * notification. Une règle écrite deux fois (ici pour la création, nulle part pour
 * l'édition) est une règle qu'on oublie la seconde fois : elle est donc écrite
 * une seule fois, et le formulaire comme les deux chemins serveur l'appellent.
 *
 * La longueur se compte en **caractères** (points de code), comme MySQL compte
 * ceux d'un `VARCHAR` en `utf8mb4` — `String.length` compterait deux unités pour
 * un emoji, et refuserait un nom que la colonne accepte.
 *
 * Module pur : importable côté serveur comme côté client.
 */

export const TEAM_NAME_MIN_LENGTH = 3;
export const TEAM_NAME_MAX_LENGTH = 60;

/** Refus de forme (400) — le nom est vide, trop court ou trop long. */
export const INVALID_TEAM_NAME = "INVALID_TEAM_NAME";

/** Refus d'unicité (409) — le nom est déjà porté par une autre équipe. */
export const TEAM_NAME_ALREADY_USED = "TEAM_NAME_ALREADY_USED";

export type TeamNameCheck = { ok: true; name: string } | { ok: false; reason: typeof INVALID_TEAM_NAME };

/** Nombre de caractères d'un nom, tel que la base le compte. */
export function teamNameLength(name: string): number {
  return Array.from(name).length;
}

/**
 * Valide une saisie de nom et rend sa forme canonique (sans espaces de bordure).
 *
 * Prend `unknown` : le corps d'une requête n'est qu'annoté, et un nom qui n'est
 * pas du texte (`{ "name": 123 }`) faisait lever `.trim()` — le message du
 * moteur JavaScript partait alors au client à la place d'un refus nommé.
 */
export function checkTeamName(raw: unknown): TeamNameCheck {
  const name = typeof raw === "string" ? raw.trim() : "";
  const length = teamNameLength(name);
  if (length < TEAM_NAME_MIN_LENGTH || length > TEAM_NAME_MAX_LENGTH) {
    return { ok: false, reason: INVALID_TEAM_NAME };
  }
  return { ok: true, name };
}
