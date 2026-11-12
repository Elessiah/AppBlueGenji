import { TEAM_ROLES } from "@/lib/shared/constants";
import type { TeamRole } from "@/lib/shared/types";

/**
 * Rôles d'invitation tels que le corps d'une requête les apporte.
 *
 * Trois cas, et ils ne se confondent pas :
 * - **absents** (`undefined`, `null`) → `undefined`, que `inviteToTeam` lit
 *   comme le défaut d'origine (`DPS`) — un appelant qui ne connaît pas le champ
 *   garde le comportement d'avant ;
 * - **une liste** de codes connus → telle quelle, que le service assainit
 *   (`OWNER` retiré). Vide, elle est permise : une invitation **sans rôle**
 *   (décision D71), le joueur choisira ses rôles de jeu lui-même ;
 * - **autre chose** (pas un tableau, ou un élément qui n'est pas un code de
 *   rôle connu) → refus `INVALID_ROLES` : une valeur malformée n'est ni une
 *   absence ni un choix, et la lire comme l'un ou l'autre ferait arriver le
 *   joueur en DPS, ou sans rôle, sans que personne ne l'ait voulu.
 *
 * @throws INVALID_ROLES
 */
export function inviteRolesFromBody(raw: unknown): TeamRole[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  return rolesListFromBody(raw);
}

/**
 * Liste de rôles **exigée** dans un corps de requête (rôles d'un membre, ses
 * propres rôles de jeu) : un tableau de codes de rôle connus (`TEAM_ROLES`).
 * Absente, malformée, ou portant un élément inconnu (`"PILOTE"`, `3`) →
 * `INVALID_ROLES`. Filtrer en silence ces éléments rendait une liste vide — et
 * une liste vide, désormais permise, **effaçait** les rôles du membre.
 * Avant, une liste absente valait une liste vide, que le refus `MISSING_ROLE`
 * arrêtait ; une liste vide étant désormais permise (D71), l'absence ne doit
 * plus effacer les rôles d'un membre.
 *
 * @throws INVALID_ROLES
 */
export function rolesListFromBody(raw: unknown): TeamRole[] {
  if (!Array.isArray(raw)) throw new Error("INVALID_ROLES");
  if (!raw.every(isKnownRole)) throw new Error("INVALID_ROLES");
  // Dédoublonnée ici : une liste de milliers de « TANK » ne doit pas être
  // parcourue de nouveau sous le verrou d'une ligne ou de l'équipe.
  return Array.from(new Set(raw));
}

function isKnownRole(role: unknown): role is TeamRole {
  return typeof role === "string" && TEAM_ROLES.includes(role as TeamRole);
}

/**
 * Refus d'une **arrivée** dans une équipe que l'état a rendue impossible entre
 * la lecture et l'écriture (`acceptIntoTeam`) — des conflits (409), pas des
 * saisies fautives : l'invitation a déjà reçu une réponse, l'équipe a été
 * dissoute, le joueur a supprimé son compte, ou la fantôme qu'on lui proposait
 * de reprendre a trouvé propriétaire entre-temps.
 */
export const JOIN_CONFLICTS: ReadonlySet<string> = new Set([
  "INVITATION_NOT_PENDING",
  "TEAM_DELETED",
  "TEAM_NOT_JOINABLE",
  "PLAYER_ACCOUNT_DELETED",
  "NOT_A_GHOST_TEAM",
]);
