import { describe, expect, it, jest } from "@jest/globals";
import { getUserActiveTeam } from "@/lib/server/teams/roster";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/**
 * Le menu du compte montre le nom de l'équipe active et en fait son nom
 * accessible : `getUserActiveTeam` rend sa forme affichable (`UNTRUSTED_NAMES.md`).
 */
function connectionWith(teamName: string) {
  const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ team_id: 7, team_name: teamName, roles_json: '["OWNER"]' }]]);
  return fakeConnection({ execute });
}

describe("getUserActiveTeam — nom de l'équipe", () => {
  it("retire commande de direction et invisibles d'un nom resté en base", async () => {
    const name = `Les${String.fromCodePoint(0x200b)} Ours${String.fromCodePoint(0x202e)}`;
    await expect(getUserActiveTeam(1, connectionWith(name))).resolves.toEqual({
      teamId: 7,
      teamName: "Les Ours",
      roles: ["OWNER"],
    });
  });

  it("garde un nom stylisé tel qu'il est sur la fiche (sans NFKC)", async () => {
    const team = await getUserActiveTeam(1, connectionWith("ＢＬＵＥ  Team²"));
    expect(team?.teamName).toBe("ＢＬＵＥ Team²");
  });

  it("rend un nom vide quand il ne garde rien de visible (le menu retombe sur « Mon équipe »)", async () => {
    const team = await getUserActiveTeam(1, connectionWith(String.fromCodePoint(0x200b, 0x2060)));
    expect(team?.teamName).toBe("");
  });

  it("rend null sans équipe active", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[]]);
    await expect(getUserActiveTeam(1, fakeConnection({ execute }))).resolves.toBeNull();
  });
});
