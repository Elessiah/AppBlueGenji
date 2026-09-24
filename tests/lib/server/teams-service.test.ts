import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/terms-acceptance", () =>
  jest.requireActual<typeof import("../../helpers/terms-acceptance-double")>("../../helpers/terms-acceptance-double").termsAcceptanceDouble(),
);
jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import {
  canManageTeam,
  leaveTeam,
  removeTeamMember,
  updateTeamMemberRoles,
} from "@/lib/server/teams-service";
import type { TeamRole } from "@/lib/shared/types";
import { fakePool } from "../../helpers/sql-double";

/**
 * Gestion du roster : qui a la main, et sur qui.
 *
 * Deux rôles seulement donnent la main (`OWNER`, `MANAGER` —
 * `lib/shared/team-roles.ts`) ; les cinq autres sont sportifs, `CAPITAINE`
 * compris. Le propriétaire ne se retire ni ne se destitue par ces chemins : il
 * transfère d'abord la propriété.
 */

const TEAM_ID = 7;
const OWNER_ID = 1;
const MANAGER_ID = 2;
const CAPTAIN_ID = 3;
const DPS_ID = 4;
const OUTSIDER_ID = 99;

const ROSTER: Record<number, TeamRole[]> = {
  [OWNER_ID]: ["OWNER", "TANK"],
  [MANAGER_ID]: ["MANAGER"],
  [CAPTAIN_ID]: ["CAPITAINE", "HEAL"],
  [DPS_ID]: ["DPS"],
};

type Execute = (sql: string, params?: unknown[]) => Promise<unknown>;
let execute: jest.Mock<Execute>;

/**
 * Base simulée : la lecture des rôles d'un membre répond depuis `roster`, toute
 * écriture rend `affectedRows`.
 */
function useDatabase(roster: Record<number, TeamRole[]> = ROSTER, affectedRows = 1) {
  execute = jest.fn<Execute>(async (sql, params = []) => {
    if (/SELECT roles_json\s+FROM bg_team_members/.test(sql)) {
      const roles = roster[Number(params[1])];
      return [roles ? [{ roles_json: JSON.stringify(roles) }] : [], []];
    }
    return [{ affectedRows }, []];
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

const updates = () =>
  execute.mock.calls.filter(([sql]) => /UPDATE bg_team_members/.test(sql));

beforeEach(() => {
  jest.clearAllMocks();
  useDatabase();
});

describe("canManageTeam", () => {
  it.each([
    ["le propriétaire", OWNER_ID, true],
    ["le manager", MANAGER_ID, true],
    ["le capitaine — rôle sportif, pas de gestion", CAPTAIN_ID, false],
    ["un DPS", DPS_ID, false],
    ["un non-membre", OUTSIDER_ID, false],
  ])("%s → %s", async (_label, userId, expected) => {
    await expect(canManageTeam(TEAM_ID, userId)).resolves.toBe(expected);
  });

  it("ne lit que l'appartenance active de l'équipe visée", async () => {
    await canManageTeam(TEAM_ID, DPS_ID);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/left_at IS NULL/);
    expect(params).toEqual([TEAM_ID, DPS_ID]);
  });
});

describe("updateTeamMemberRoles", () => {
  it.each([
    ["un rôle sportif", DPS_ID],
    ["le capitaine", CAPTAIN_ID],
    ["un non-membre", OUTSIDER_ID],
  ])("refuse la demande d'%s sans rien écrire", async (_label, requesterId) => {
    await expect(updateTeamMemberRoles(requesterId, TEAM_ID, DPS_ID, ["HEAL"])).rejects.toThrow(
      "FORBIDDEN",
    );
    expect(updates()).toHaveLength(0);
  });

  it("interdit au manager de toucher aux rôles du propriétaire", async () => {
    await expect(updateTeamMemberRoles(MANAGER_ID, TEAM_ID, OWNER_ID, ["DPS"])).rejects.toThrow(
      "FORBIDDEN",
    );
    expect(updates()).toHaveLength(0);
  });

  it("refuse une cible qui n'est pas dans le roster", async () => {
    await expect(updateTeamMemberRoles(OWNER_ID, TEAM_ID, OUTSIDER_ID, ["DPS"])).rejects.toThrow(
      "MEMBER_NOT_FOUND",
    );
    expect(updates()).toHaveLength(0);
  });

  it("remplace les rôles de la cible, doublons retirés", async () => {
    await updateTeamMemberRoles(MANAGER_ID, TEAM_ID, DPS_ID, ["TANK", "TANK", "HEAL"]);
    expect(updates()).toHaveLength(1);
    expect(updates()[0][1]).toEqual([JSON.stringify(["TANK", "HEAL"]), TEAM_ID, DPS_ID]);
  });

  it("ne laisse pas conférer OWNER par ce chemin", async () => {
    await updateTeamMemberRoles(OWNER_ID, TEAM_ID, DPS_ID, ["OWNER", "COACH"]);
    expect(updates()[0][1]).toEqual([JSON.stringify(["COACH"]), TEAM_ID, DPS_ID]);
  });

  it("garde OWNER au propriétaire, en tête de ses rôles", async () => {
    await updateTeamMemberRoles(OWNER_ID, TEAM_ID, OWNER_ID, ["DPS"]);
    expect(updates()[0][1]).toEqual([JSON.stringify(["OWNER", "DPS"]), TEAM_ID, OWNER_ID]);
  });

  it.each([
    ["aucun rôle", [] as TeamRole[]],
    ["OWNER seul, qui est retiré", ["OWNER"] as TeamRole[]],
  ])("refuse %s", async (_label, roles) => {
    await expect(updateTeamMemberRoles(OWNER_ID, TEAM_ID, DPS_ID, roles)).rejects.toThrow(
      "MISSING_ROLE",
    );
    expect(updates()).toHaveLength(0);
  });

  it("rend MEMBER_NOT_FOUND si la cible est partie entre la lecture et l'écriture", async () => {
    useDatabase(ROSTER, 0);
    await expect(updateTeamMemberRoles(OWNER_ID, TEAM_ID, DPS_ID, ["HEAL"])).rejects.toThrow(
      "MEMBER_NOT_FOUND",
    );
  });
});

describe("removeTeamMember", () => {
  it.each([
    ["un rôle sportif", DPS_ID],
    ["le capitaine", CAPTAIN_ID],
    ["un non-membre", OUTSIDER_ID],
  ])("refuse l'exclusion demandée par %s", async (_label, requesterId) => {
    await expect(removeTeamMember(requesterId, TEAM_ID, MANAGER_ID)).rejects.toThrow("FORBIDDEN");
    expect(updates()).toHaveLength(0);
  });

  it("refuse de s'exclure soi-même — c'est `leaveTeam`", async () => {
    await expect(removeTeamMember(MANAGER_ID, TEAM_ID, MANAGER_ID)).rejects.toThrow(
      "OWNER_CANNOT_LEAVE",
    );
    expect(updates()).toHaveLength(0);
  });

  it("refuse d'exclure le propriétaire", async () => {
    await expect(removeTeamMember(MANAGER_ID, TEAM_ID, OWNER_ID)).rejects.toThrow(
      "CANNOT_KICK_OWNER",
    );
    expect(updates()).toHaveLength(0);
  });

  it("refuse une cible absente du roster", async () => {
    await expect(removeTeamMember(OWNER_ID, TEAM_ID, OUTSIDER_ID)).rejects.toThrow(
      "MEMBER_NOT_FOUND",
    );
  });

  it.each([
    ["le propriétaire", OWNER_ID],
    ["le manager", MANAGER_ID],
  ])("laisse %s exclure un joueur, en datant son départ", async (_label, requesterId) => {
    await removeTeamMember(requesterId, TEAM_ID, DPS_ID);
    expect(updates()).toHaveLength(1);
    const [sql, params] = updates()[0];
    expect(sql).toMatch(/SET left_at = NOW\(\)/);
    expect(params).toEqual([TEAM_ID, DPS_ID]);
  });

  it("rend MEMBER_NOT_FOUND si la cible est partie entre-temps", async () => {
    useDatabase(ROSTER, 0);
    await expect(removeTeamMember(OWNER_ID, TEAM_ID, DPS_ID)).rejects.toThrow("MEMBER_NOT_FOUND");
  });
});

describe("leaveTeam", () => {
  it("refuse un joueur qui n'est pas membre", async () => {
    await expect(leaveTeam(OUTSIDER_ID, TEAM_ID)).rejects.toThrow("NOT_A_MEMBER");
    expect(updates()).toHaveLength(0);
  });

  it("oblige le propriétaire à transférer d'abord", async () => {
    await expect(leaveTeam(OWNER_ID, TEAM_ID)).rejects.toThrow("OWNER_MUST_TRANSFER");
    expect(updates()).toHaveLength(0);
  });

  it.each([
    ["le manager", MANAGER_ID],
    ["un joueur", DPS_ID],
  ])("laisse partir %s, en datant son départ", async (_label, userId) => {
    await leaveTeam(userId, TEAM_ID);
    expect(updates()).toHaveLength(1);
    const [sql, params] = updates()[0];
    expect(sql).toMatch(/SET left_at = NOW\(\)/);
    expect(params).toEqual([TEAM_ID, userId]);
  });
});
