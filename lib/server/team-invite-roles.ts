import type { TeamRole } from "@/lib/shared/types";

/**
 * Rôles d'invitation tels que le corps d'une requête les apporte.
 *
 * Trois cas, et ils ne se confondent pas :
 * - **absents** (`undefined`, `null`) → `undefined`, que `inviteToTeam` lit
 *   comme le défaut d'origine (`DPS`) — un appelant qui ne connaît pas le champ
 *   garde le comportement d'avant ;
 * - **une liste** → ses chaînes, que le service assainit (codes inconnus et
 *   `OWNER` retirés) ;
 * - **autre chose** → une liste vide, donc un refus `MISSING_ROLE` : une valeur
 *   malformée n'est pas une absence, et la lire comme telle ferait arriver le
 *   joueur en DPS sans que personne ne l'ait choisi.
 */
export function inviteRolesFromBody(raw: unknown): TeamRole[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) return [];
  return raw.filter((role): role is TeamRole => typeof role === "string");
}
