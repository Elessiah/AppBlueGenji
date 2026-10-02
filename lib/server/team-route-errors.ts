import { TERMS_ACCEPTANCE_REQUIRED } from "@/lib/shared/terms-of-use";
import { TEAM_TAG_ALREADY_USED } from "@/lib/shared/team-tag";
import { INVALID_TEAM_NAME, TEAM_NAME_ALREADY_USED } from "@/lib/shared/team-name";
import { JOIN_CONFLICTS } from "./team-invite-roles";

/**
 * Statuts HTTP des refus levés par `lib/server/teams/`, une table par geste des
 * routes `/api/teams/[id]/*`. Un code absent de la table garde le statut par
 * défaut des routes d'équipe (400, `teamErrorStatus`) : les tables ne nomment
 * que ce qui s'en écarte, plus les 400 qui méritent d'être lus ici.
 */
export type TeamErrorStatusTable = ReadonlyMap<string, number>;

const MANAGEMENT_REFUSALS: ReadonlyArray<readonly [string, number]> = [
  ["FORBIDDEN", 403],
  [TERMS_ACCEPTANCE_REQUIRED, 409],
];

/** Invitation d'un joueur (`POST …/members` et `POST …/invitations`). */
export const TEAM_INVITE_ERROR_STATUS: TeamErrorStatusTable = new Map([
  ...MANAGEMENT_REFUSALS,
  ["USER_NOT_FOUND", 404],
  ["USER_ALREADY_IN_TEAM", 409],
  ["ALREADY_INVITED", 409],
  ["MISSING_ROLE", 400],
  ...[...JOIN_CONFLICTS].map((code) => [code, 409] as const),
]);

/** Changement des rôles d'un membre (`PATCH …/members`). */
export const TEAM_MEMBER_ROLES_ERROR_STATUS: TeamErrorStatusTable = new Map([
  ...MANAGEMENT_REFUSALS,
  ["MEMBER_NOT_FOUND", 404],
  ["MISSING_ROLE", 400],
]);

/** Retrait d'un membre (`DELETE …/members`). */
export const TEAM_MEMBER_REMOVE_ERROR_STATUS: TeamErrorStatusTable = new Map([
  ...MANAGEMENT_REFUSALS,
  ["MEMBER_NOT_FOUND", 404],
  ["OWNER_CANNOT_LEAVE", 400],
  ["CANNOT_KICK_OWNER", 409],
]);

/** Logo (`POST` / `DELETE …/logo`). */
export const TEAM_LOGO_ERROR_STATUS: TeamErrorStatusTable = new Map(MANAGEMENT_REFUSALS);

/**
 * Identité de l'équipe (`PATCH /api/teams/[id]`). Les refus de forme du sigle
 * (`isTeamTagRejection`) et du nom restent en 400, le défaut.
 */
export const TEAM_META_ERROR_STATUS: TeamErrorStatusTable = new Map([
  ...MANAGEMENT_REFUSALS,
  [TEAM_TAG_ALREADY_USED, 409],
  [TEAM_NAME_ALREADY_USED, 409],
  [INVALID_TEAM_NAME, 400],
]);

/** Dissolution (`DELETE /api/teams/[id]`). */
export const TEAM_DELETE_ERROR_STATUS: TeamErrorStatusTable = new Map([
  ["FORBIDDEN", 403],
  ["TEAM_ALREADY_DELETED", 409],
]);

/** Statut d'un refus d'après sa table, 400 pour tout code qu'elle ne nomme pas. */
export function teamErrorStatus(table: TeamErrorStatusTable, message: string): number {
  return table.get(message) ?? 400;
}

/** Identifiant d'équipe lu dans le segment d'URL, `null` s'il n'est pas un entier positif. */
export function parseTeamId(raw: string): number | null {
  const teamId = Number(raw);
  return Number.isInteger(teamId) && teamId > 0 ? teamId : null;
}
