/**
 * Rôles d'équipe, **tels qu'on les montre** : libellés français, ordre
 * d'affichage, familles.
 *
 * Les rôles voyageaient jusqu'à l'écran sous leur code de base — la fiche
 * d'équipe affichait « OWNER, DPS, TANK » en capitales anglaises, dans l'ordre
 * de saisie, et la modale d'édition proposait `MANAGER` coché comme `TANK`, sans
 * rien pour dire que l'un est un pouvoir et l'autre une place sur le terrain.
 *
 * Trois familles, et la ligne de partage est celle de `team-roles.ts` :
 * - **propriétaire** (`OWNER`) — jamais attribuable : il se transfère ;
 * - **gestion** (`MANAGER`) — donne la main sur l'équipe (roster, inscriptions) ;
 * - **jeu** (les cinq autres) — une place dans le roster, aucun pouvoir.
 *
 * Module **pur** : aucun rendu, aucune base — les listes et l'ordre se testent
 * seuls, et le serveur peut s'y référer sans rien importer du client.
 */

import type { TeamRole } from "./types";
import { TEAM_MANAGEMENT_ROLES } from "./team-roles";

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  OWNER: "Propriétaire",
  MANAGER: "Manager",
  CAPITAINE: "Capitaine",
  COACH: "Coach",
  TANK: "Tank",
  DPS: "DPS",
  HEAL: "Soutien",
};

/** Ordre d'affichage : du rôle le plus fort au plus sportif. */
export const TEAM_ROLE_ORDER: readonly TeamRole[] = [
  "OWNER",
  "MANAGER",
  "CAPITAINE",
  "COACH",
  "TANK",
  "DPS",
  "HEAL",
];

/** Rôles de jeu attribuables : une place dans le roster, aucun droit. */
export const ASSIGNABLE_GAME_ROLES: readonly TeamRole[] = ["CAPITAINE", "COACH", "TANK", "DPS", "HEAL"];

/**
 * Rôles de gestion attribuables. `OWNER` n'y figure pas : il ne se coche pas,
 * il se **transfère** (une équipe a exactement un propriétaire).
 */
export const ASSIGNABLE_MANAGEMENT_ROLES: readonly TeamRole[] = TEAM_MANAGEMENT_ROLES.filter(
  (role) => role !== "OWNER",
);

/** Rôles proposés par défaut à l'invitation : ceux que le serveur posait seul. */
export const DEFAULT_INVITE_ROLES: readonly TeamRole[] = ["DPS"];

export type TeamRoleFamily = "owner" | "management" | "game";

export function teamRoleFamily(role: TeamRole): TeamRoleFamily {
  if (role === "OWNER") return "owner";
  return TEAM_MANAGEMENT_ROLES.includes(role) ? "management" : "game";
}

/** Libellé d'un rôle — un code inconnu reste affiché tel quel plutôt que perdu. */
export function teamRoleLabel(role: TeamRole): string {
  return TEAM_ROLE_LABELS[role] ?? role;
}

/** Les rôles d'un membre dans l'ordre d'affichage, doublons retirés. */
export function sortTeamRoles(roles: readonly TeamRole[]): TeamRole[] {
  const rank = (role: TeamRole) => {
    const index = TEAM_ROLE_ORDER.indexOf(role);
    return index === -1 ? TEAM_ROLE_ORDER.length : index;
  };
  return Array.from(new Set(roles)).sort((a, b) => rank(a) - rank(b));
}

/** Rôles d'un membre, en phrase lisible (« Propriétaire, Tank, DPS »). */
export function formatTeamRoles(roles: readonly TeamRole[]): string {
  return sortTeamRoles(roles).map(teamRoleLabel).join(", ");
}

/**
 * Ordre du roster : le propriétaire d'abord, puis la gestion, puis les autres —
 * chaque groupe par pseudo. L'ordre alphabétique seul noyait le propriétaire au
 * milieu de la liste, alors que c'est la personne qu'on cherche en premier.
 */
export function sortTeamMembers<T extends { pseudo: string; roles: readonly TeamRole[] }>(
  members: readonly T[],
): T[] {
  const weight = (member: T) => {
    if (member.roles.includes("OWNER")) return 0;
    if (member.roles.some((role) => TEAM_MANAGEMENT_ROLES.includes(role))) return 1;
    return 2;
  };
  return [...members].sort(
    (a, b) => weight(a) - weight(b) || a.pseudo.localeCompare(b.pseudo, "fr", { sensitivity: "base" }),
  );
}
