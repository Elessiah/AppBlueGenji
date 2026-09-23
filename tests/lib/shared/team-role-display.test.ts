import { describe, expect, it } from "@jest/globals";
import type { TeamRole } from "@/lib/shared/types";
import {
  ASSIGNABLE_GAME_ROLES,
  ASSIGNABLE_MANAGEMENT_ROLES,
  DEFAULT_INVITE_ROLES,
  TEAM_ROLE_LABELS,
  TEAM_ROLE_ORDER,
  formatTeamRoles,
  sortTeamMembers,
  sortTeamRoles,
  teamRoleFamily,
  teamRoleLabel,
} from "@/lib/shared/team-role-display";
import { TEAM_MANAGEMENT_ROLES } from "@/lib/shared/team-roles";

const ALL_ROLES: TeamRole[] = ["COACH", "TANK", "DPS", "HEAL", "CAPITAINE", "MANAGER", "OWNER"];

describe("libellés des rôles d'équipe", () => {
  it.each(ALL_ROLES)("%s a un libellé français qui n'est pas son code (sauf DPS)", (role) => {
    const label = teamRoleLabel(role);
    expect(label.length).toBeGreaterThan(1);
    // DPS se dit DPS en français aussi ; les autres codes ne doivent pas fuiter.
    if (role !== "DPS") expect(label).not.toBe(role);
  });

  it("ne laisse aucun rôle sans libellé ni sans rang", () => {
    expect(Object.keys(TEAM_ROLE_LABELS).sort()).toEqual([...ALL_ROLES].sort());
    expect([...TEAM_ROLE_ORDER].sort()).toEqual([...ALL_ROLES].sort());
  });

  it("rend un code inconnu tel quel plutôt que rien", () => {
    expect(teamRoleLabel("INCONNU" as TeamRole)).toBe("INCONNU");
  });
});

describe("familles de rôles", () => {
  it("sépare propriétaire, gestion et jeu", () => {
    expect(teamRoleFamily("OWNER")).toBe("owner");
    expect(teamRoleFamily("MANAGER")).toBe("management");
    for (const role of ["COACH", "TANK", "DPS", "HEAL", "CAPITAINE"] as TeamRole[]) {
      expect(teamRoleFamily(role)).toBe("game");
    }
  });

  it("n'offre jamais OWNER à la saisie : il se transfère", () => {
    expect(ASSIGNABLE_GAME_ROLES).not.toContain("OWNER");
    expect(ASSIGNABLE_MANAGEMENT_ROLES).not.toContain("OWNER");
  });

  it("propose tous les autres rôles, chacun dans un seul groupe", () => {
    const offered = [...ASSIGNABLE_GAME_ROLES, ...ASSIGNABLE_MANAGEMENT_ROLES];
    expect(new Set(offered).size).toBe(offered.length);
    expect([...offered].sort()).toEqual(ALL_ROLES.filter((r) => r !== "OWNER").sort());
  });

  it("tire la gestion du module d'autorisation, pas d'une seconde liste", () => {
    // Un rôle de gestion ajouté à `team-roles.ts` doit apparaître dans le bon
    // groupe sans qu'on pense à ce fichier.
    expect([...ASSIGNABLE_MANAGEMENT_ROLES]).toEqual(TEAM_MANAGEMENT_ROLES.filter((r) => r !== "OWNER"));
    expect(ASSIGNABLE_GAME_ROLES.some((r) => TEAM_MANAGEMENT_ROLES.includes(r))).toBe(false);
  });

  it("invite en DPS par défaut, comme le serveur le faisait seul", () => {
    expect(DEFAULT_INVITE_ROLES).toEqual(["DPS"]);
  });
});

describe("sortTeamRoles / formatTeamRoles", () => {
  it("range du plus fort au plus sportif, quel que soit l'ordre de saisie", () => {
    expect(sortTeamRoles(["HEAL", "OWNER", "TANK", "MANAGER"])).toEqual(["OWNER", "MANAGER", "TANK", "HEAL"]);
  });

  it("retire les doublons", () => {
    expect(sortTeamRoles(["DPS", "DPS", "TANK"])).toEqual(["TANK", "DPS"]);
  });

  it("ne modifie pas la liste reçue", () => {
    const roles: TeamRole[] = ["DPS", "OWNER"];
    sortTeamRoles(roles);
    expect(roles).toEqual(["DPS", "OWNER"]);
  });

  it("écrit une phrase lisible", () => {
    expect(formatTeamRoles(["DPS", "OWNER", "TANK"])).toBe("Propriétaire, Tank, DPS");
    expect(formatTeamRoles([])).toBe("");
  });
});

describe("sortTeamMembers", () => {
  const m = (pseudo: string, ...roles: TeamRole[]) => ({ pseudo, roles });

  it("met le propriétaire en tête, puis la gestion, puis les autres", () => {
    const sorted = sortTeamMembers([m("alice", "DPS"), m("zoe", "MANAGER"), m("bob", "OWNER"), m("carl", "TANK")]);
    expect(sorted.map((x) => x.pseudo)).toEqual(["bob", "zoe", "alice", "carl"]);
  });

  it("classe chaque groupe par pseudo, sans tenir compte de la casse", () => {
    const sorted = sortTeamMembers([m("Émile", "DPS"), m("anna", "DPS"), m("Bruno", "DPS")]);
    expect(sorted.map((x) => x.pseudo)).toEqual(["anna", "Bruno", "Émile"]);
  });

  it("ne modifie pas la liste reçue", () => {
    const list = [m("b", "DPS"), m("a", "OWNER")];
    sortTeamMembers(list);
    expect(list.map((x) => x.pseudo)).toEqual(["b", "a"]);
  });
});
