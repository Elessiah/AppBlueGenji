import type { TeamRole } from "@/lib/shared/types";

/**
 * Règles pures d'une arrivée dans une équipe (`acceptIntoTeam`,
 * `lib/server/teams/invitations.ts`), séparées de la transaction qui les applique.
 */

/**
 * Rôles posés à l'arrivée : `OWNER` seul pour une reprise de fantôme, sinon
 * les rôles assainis sans `OWNER` — et `DPS`, le défaut d'origine, s'il n'en
 * reste aucun (demande, invitation d'avant la colonne).
 */
export function arrivalRoles(claim: boolean, sanitized: readonly TeamRole[]): TeamRole[] {
  if (claim) return ["OWNER"];
  const filtered = sanitized.filter((role) => role !== "OWNER");
  return filtered.length === 0 ? ["DPS"] : filtered;
}

/** Ce que l'arrivée lit de l'équipe visée, relue sous verrou. */
export interface JoinTargetTeam {
  deleted_at: Date | null;
  is_ghost: 0 | 1;
  solo_user_id: number | null;
}

/**
 * Refus d'une arrivée d'après l'état de l'équipe, ou `null` si elle peut se
 * faire. Une reprise (`claim`) n'entre que dans une fantôme ; une arrivée
 * ordinaire jamais.
 */
export function teamJoinRefusal(team: JoinTargetTeam | undefined, claim: boolean): string | null {
  if (!team) return "TEAM_NOT_FOUND";
  if (team.deleted_at !== null) return "TEAM_DELETED";
  if (team.solo_user_id !== null) return "TEAM_NOT_JOINABLE";
  const ghost = team.is_ghost === 1;
  if (claim && !ghost) return "NOT_A_GHOST_TEAM";
  if (!claim && ghost) return "TEAM_NOT_JOINABLE";
  return null;
}
