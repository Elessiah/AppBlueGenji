import { describe, expect, it } from "@jest/globals";

import { arrivalRoles, teamJoinRefusal, type JoinTargetTeam } from "@/lib/shared/team-join";

describe("arrivalRoles", () => {
  it("une reprise de fantôme arrive OWNER seul", () => {
    expect(arrivalRoles(true, ["DPS", "OWNER"])).toEqual(["OWNER"]);
    expect(arrivalRoles(true, [])).toEqual(["OWNER"]);
  });

  it("une arrivée ordinaire garde ses rôles, sans OWNER", () => {
    expect(arrivalRoles(false, ["TANK", "OWNER", "CAPITAINE"])).toEqual(["TANK", "CAPITAINE"]);
  });

  it("retombe sur DPS quand il ne reste aucun rôle", () => {
    expect(arrivalRoles(false, [])).toEqual(["DPS"]);
    expect(arrivalRoles(false, ["OWNER"])).toEqual(["DPS"]);
  });
});

describe("teamJoinRefusal", () => {
  const team: JoinTargetTeam = { deleted_at: null, is_ghost: 0, solo_user_id: null };

  it("accepte une équipe ordinaire vivante", () => {
    expect(teamJoinRefusal(team, false)).toBeNull();
  });

  it("refuse une équipe absente, dissoute ou entrée solo", () => {
    expect(teamJoinRefusal(undefined, false)).toBe("TEAM_NOT_FOUND");
    expect(teamJoinRefusal({ ...team, deleted_at: new Date() }, false)).toBe("TEAM_DELETED");
    expect(teamJoinRefusal({ ...team, solo_user_id: 4 }, true)).toBe("TEAM_NOT_JOINABLE");
  });

  it("la dissolution l'emporte sur la nature de l'équipe", () => {
    expect(teamJoinRefusal({ ...team, deleted_at: new Date(), solo_user_id: 4 }, false)).toBe("TEAM_DELETED");
  });

  it("une reprise n'entre que dans une fantôme, une arrivée ordinaire jamais", () => {
    expect(teamJoinRefusal(team, true)).toBe("NOT_A_GHOST_TEAM");
    expect(teamJoinRefusal({ ...team, is_ghost: 1 }, true)).toBeNull();
    expect(teamJoinRefusal({ ...team, is_ghost: 1 }, false)).toBe("TEAM_NOT_JOINABLE");
  });
});
