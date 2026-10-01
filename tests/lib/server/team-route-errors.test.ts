import { describe, expect, it } from "@jest/globals";

import {
  TEAM_DELETE_ERROR_STATUS,
  TEAM_INVITE_ERROR_STATUS,
  TEAM_LOGO_ERROR_STATUS,
  TEAM_MEMBER_REMOVE_ERROR_STATUS,
  TEAM_MEMBER_ROLES_ERROR_STATUS,
  TEAM_META_ERROR_STATUS,
  parseTeamId,
  teamErrorStatus,
} from "@/lib/server/team-route-errors";
import { JOIN_CONFLICTS } from "@/lib/server/team-invite-roles";
import { TERMS_ACCEPTANCE_REQUIRED } from "@/lib/shared/terms-of-use";
import { TEAM_TAG_ALREADY_USED } from "@/lib/shared/team-tag";
import { INVALID_TEAM_NAME, TEAM_NAME_ALREADY_USED } from "@/lib/shared/team-name";

describe("teamErrorStatus", () => {
  it("rend le statut nommé par la table", () => {
    expect(teamErrorStatus(TEAM_INVITE_ERROR_STATUS, "FORBIDDEN")).toBe(403);
    expect(teamErrorStatus(TEAM_INVITE_ERROR_STATUS, "USER_NOT_FOUND")).toBe(404);
  });

  it("retombe sur 400 pour un code inconnu ou vide", () => {
    expect(teamErrorStatus(TEAM_INVITE_ERROR_STATUS, "SOMETHING_ELSE")).toBe(400);
    expect(teamErrorStatus(TEAM_DELETE_ERROR_STATUS, "")).toBe(400);
  });
});

describe("tables de statuts des routes d'équipe", () => {
  it("invitation : gestion, joueur absent, doublons et conflits d'arrivée", () => {
    expect(TEAM_INVITE_ERROR_STATUS.get(TERMS_ACCEPTANCE_REQUIRED)).toBe(409);
    expect(TEAM_INVITE_ERROR_STATUS.get("USER_ALREADY_IN_TEAM")).toBe(409);
    expect(TEAM_INVITE_ERROR_STATUS.get("ALREADY_INVITED")).toBe(409);
    expect(TEAM_INVITE_ERROR_STATUS.get("MISSING_ROLE")).toBe(400);
    for (const code of JOIN_CONFLICTS) expect(TEAM_INVITE_ERROR_STATUS.get(code)).toBe(409);
  });

  it("rôles et retrait d'un membre", () => {
    expect(TEAM_MEMBER_ROLES_ERROR_STATUS.get("MEMBER_NOT_FOUND")).toBe(404);
    expect(TEAM_MEMBER_ROLES_ERROR_STATUS.get(TERMS_ACCEPTANCE_REQUIRED)).toBe(409);
    expect(TEAM_MEMBER_REMOVE_ERROR_STATUS.get("OWNER_CANNOT_LEAVE")).toBe(400);
    expect(TEAM_MEMBER_REMOVE_ERROR_STATUS.get("CANNOT_KICK_OWNER")).toBe(409);
    expect(TEAM_MEMBER_REMOVE_ERROR_STATUS.get("MEMBER_NOT_FOUND")).toBe(404);
  });

  it("logo : seuls le droit de gestion et les conditions s'écartent du défaut", () => {
    expect([...TEAM_LOGO_ERROR_STATUS]).toEqual([
      ["FORBIDDEN", 403],
      [TERMS_ACCEPTANCE_REQUIRED, 409],
    ]);
  });

  it("identité de l'équipe : collisions en 409, nom invalide en 400", () => {
    expect(TEAM_META_ERROR_STATUS.get(TEAM_TAG_ALREADY_USED)).toBe(409);
    expect(TEAM_META_ERROR_STATUS.get(TEAM_NAME_ALREADY_USED)).toBe(409);
    expect(TEAM_META_ERROR_STATUS.get(INVALID_TEAM_NAME)).toBe(400);
  });

  it("dissolution : les conditions d'utilisation n'y sont pas un conflit", () => {
    expect(TEAM_DELETE_ERROR_STATUS.get("TEAM_ALREADY_DELETED")).toBe(409);
    expect(TEAM_DELETE_ERROR_STATUS.has(TERMS_ACCEPTANCE_REQUIRED)).toBe(false);
  });
});

describe("parseTeamId", () => {
  it.each<[string, number | null]>([
    ["12", 12],
    ["1", 1],
    ["0", null],
    ["-3", null],
    ["1.5", null],
    ["abc", null],
    ["", null],
  ])("%p → %p", (raw, expected) => {
    expect(parseTeamId(raw)).toBe(expected);
  });
});
