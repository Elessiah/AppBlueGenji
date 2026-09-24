import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { removeTeamLogoAsModerator } from "@/lib/server/teams-service";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

jest.mock("@/lib/server/terms-acceptance", () =>
  jest.requireActual<typeof import("../../helpers/terms-acceptance-double")>("../../helpers/terms-acceptance-double").termsAcceptanceDouble(),
);
jest.mock("@/lib/server/database");

const LOGO = "/api/uploads/teams/4-a.webp";

let connection: ReturnType<typeof connectionMock>;

async function install(team: object | null, othersSharing: number) {
  const { getDatabase } = await import("@/lib/server/database");
  connection = connectionMock();
  connection.execute = jest.fn<SqlQuery>(async (sql) => {
    if (/FOR UPDATE/.test(sql)) return [team ? [team] : []];
    if (/UPDATE bg_teams SET logo_url = NULL/.test(sql)) return [{}];
    if (/COUNT\(\*\) AS total FROM bg_teams WHERE logo_url = \? AND id <> \?/.test(sql)) {
      return [[{ total: othersSharing }]];
    }
    throw new Error(`requête inattendue : ${sql}`);
  });
  jest.mocked(getDatabase).mockResolvedValue(
    fakePool({ execute: jest.fn<SqlQuery>(), getConnection: async () => fakeConnection(connection) }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("removeTeamLogoAsModerator", () => {
  it("vide la colonne et rend le logo retiré, fichier propre à l'équipe", async () => {
    await install({ name: "Alpha", logo_url: LOGO, solo_user_id: null }, 0);
    await expect(removeTeamLogoAsModerator(4)).resolves.toEqual({
      teamName: "Alpha",
      removedLogoUrl: LOGO,
      sharedWithOtherTeams: false,
    });
    expect(connection.commit).toHaveBeenCalled();
    const sharing = connection.execute.mock.calls.find(([sql]) => /COUNT\(\*\)/.test(sql));
    expect(sharing?.[1]).toEqual([LOGO, 4]);
  });

  it("signale un fichier que d'autres équipes désignent encore — l'appelant le garde", async () => {
    await install({ name: "Alpha", logo_url: LOGO, solo_user_id: null }, 2);
    await expect(removeTeamLogoAsModerator(4)).resolves.toEqual(
      expect.objectContaining({ sharedWithOtherTeams: true }),
    );
  });

  it("refuse une entrée solo, une équipe inconnue et une équipe sans logo", async () => {
    await install({ name: "Solo", logo_url: LOGO, solo_user_id: 9 }, 0);
    await expect(removeTeamLogoAsModerator(4)).rejects.toThrow("TEAM_NOT_FOUND");
    expect(connection.rollback).toHaveBeenCalled();

    await install(null, 0);
    await expect(removeTeamLogoAsModerator(4)).rejects.toThrow("TEAM_NOT_FOUND");

    await install({ name: "Alpha", logo_url: null, solo_user_id: null }, 0);
    await expect(removeTeamLogoAsModerator(4)).rejects.toThrow("TEAM_HAS_NO_LOGO");
  });
});
