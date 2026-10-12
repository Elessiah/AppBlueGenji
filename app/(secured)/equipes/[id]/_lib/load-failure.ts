/**
 * Refus de chargement qui ont leur propre phrase : se reconnecter, droits, ou
 * adresse invalide (`/equipes/abc` — l'équipe n'existe pas, inutile de réessayer).
 */
const REASONED_LOAD_ERRORS: ReadonlySet<string> = new Set(["UNAUTHORIZED", "FORBIDDEN", "INVALID_TEAM_ID"]);

/** Phrase d'un échec de chargement : sa raison si elle en a une, sinon « n'a pas pu être chargée ». */
export function loadFailureMessage(
  error: string | null,
  teamErrorMessage: (code: string) => string,
  generic: string,
): string {
  return error && REASONED_LOAD_ERRORS.has(error) ? teamErrorMessage(error) : generic;
}
