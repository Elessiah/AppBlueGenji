import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/ranking-cache");
jest.mock("@/lib/server/landing-cache");
jest.mock("@/lib/server/terms-acceptance", () =>
  jest.requireActual<typeof import("../../helpers/terms-acceptance-double")>("../../helpers/terms-acceptance-double").termsAcceptanceDouble(),
);

import { getDatabase } from "@/lib/server/database";
import { invalidateLandingTeamViews } from "@/lib/server/landing-cache";
import { invalidateTeamIdentityViews } from "@/lib/server/ranking-cache";
import { syncSoloEntryIdentity } from "@/lib/server/solo-entries-service";
import { updateTeamLogo } from "@/lib/server/teams/identity";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * Écritures d'identité (logo d'équipe, entrée solo) : l'ancienne valeur se
 * relit sous verrou, et les vues mises en cache qui la montrent (classement,
 * podium, cartes d'aperçu, vitrine) sont vidées **après** le commit.
 */

type Route = [RegExp, () => unknown];

function routed(routes: Route[]): jest.Mock<SqlQuery> {
  return jest.fn<SqlQuery>(async (sql) => {
    const route = routes.find(([pattern]) => pattern.test(sql));
    if (!route) throw new Error(`requête inattendue : ${sql}`);
    return route[1]();
  });
}

let connection: ReturnType<typeof connectionMock>;

function install(poolRoutes: Route[], connectionRoutes: Route[]) {
  connection = connectionMock();
  connection.execute = routed(connectionRoutes);
  jest.mocked(getDatabase).mockResolvedValue(
    fakePool({ execute: routed(poolRoutes), getConnection: async () => fakeConnection(connection) }),
  );
}

const manager: Route = [/SELECT roles_json\s+FROM bg_team_members/, () => [[{ roles_json: JSON.stringify(["MANAGER"]) }]]];
const lockLogo = (logo: string | null): Route => [/SELECT logo_url FROM bg_teams WHERE id = \? FOR UPDATE/, () => [[{ logo_url: logo }]]];

beforeEach(() => {
  jest.clearAllMocks();
});

describe("updateTeamLogo", () => {
  it("updateTeamLogo_newLogo_returnsLogoReadUnderLock", async () => {
    install([manager], [lockLogo("/api/uploads/teams/old.webp"), [/UPDATE bg_teams SET logo_url = \?/, () => [{}]]]);

    const result = await updateTeamLogo(1, 7, "/api/uploads/teams/new.webp");

    expect(result).toEqual({ previousLogoUrl: "/api/uploads/teams/old.webp" });
  });

  it("updateTeamLogo_newLogo_locksBeforeWritingInOneTransaction", async () => {
    install([manager], [lockLogo(null), [/UPDATE bg_teams SET logo_url = \?/, () => [{}]]]);

    await updateTeamLogo(1, 7, "/api/uploads/teams/new.webp");

    const statements = connection.execute.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toMatch(/FOR UPDATE/);
    expect(statements[1]).toMatch(/UPDATE bg_teams SET logo_url = \?/);
    expect(connection.execute.mock.calls[1][1]).toEqual(["/api/uploads/teams/new.webp", 7]);
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("updateTeamLogo_teamWithoutLogo_returnsNullPrevious", async () => {
    install([manager], [lockLogo(null), [/UPDATE bg_teams SET logo_url = \?/, () => [{}]]]);

    expect(await updateTeamLogo(1, 7, null)).toEqual({ previousLogoUrl: null });
  });

  it("updateTeamLogo_committed_invalidatesIdentityViewsAfterCommit", async () => {
    install([manager], [lockLogo(null), [/UPDATE bg_teams SET logo_url = \?/, () => [{}]]]);

    await updateTeamLogo(1, 7, "/api/uploads/teams/new.webp");

    expect(invalidateTeamIdentityViews).toHaveBeenCalledTimes(1);
    expect(jest.mocked(invalidateTeamIdentityViews).mock.invocationCallOrder[0]).toBeGreaterThan(
      connection.commit.mock.invocationCallOrder[0],
    );
  });

  it("updateTeamLogo_removingAbsentLogo_invalidatesNothing", async () => {
    install([manager], [lockLogo(null), [/UPDATE bg_teams SET logo_url = \?/, () => [{}]]]);

    await updateTeamLogo(1, 7, null);

    expect(invalidateTeamIdentityViews).not.toHaveBeenCalled();
  });

  it("updateTeamLogo_removingExistingLogo_invalidatesIdentityViews", async () => {
    install([manager], [lockLogo("/api/uploads/teams/old.webp"), [/UPDATE bg_teams SET logo_url = \?/, () => [{}]]]);

    await updateTeamLogo(1, 7, null);

    expect(invalidateTeamIdentityViews).toHaveBeenCalledTimes(1);
  });

  it("updateTeamLogo_writeFails_rollsBackAndInvalidatesNothing", async () => {
    install(
      [manager],
      [
        lockLogo("/api/uploads/teams/old.webp"),
        [
          /UPDATE bg_teams SET logo_url = \?/,
          () => {
            throw new Error("ER_LOCK_DEADLOCK");
          },
        ],
      ],
    );

    await expect(updateTeamLogo(1, 7, null)).rejects.toThrow("ER_LOCK_DEADLOCK");
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(invalidateTeamIdentityViews).not.toHaveBeenCalled();
  });

  it("updateTeamLogo_notAManager_throwsForbiddenWithoutOpeningTransaction", async () => {
    install(
      [
        [/SELECT roles_json\s+FROM bg_team_members/, () => [[]]],
        [/SELECT is_ghost, deleted_at FROM bg_teams/, () => [[{ is_ghost: 0, deleted_at: null }]]],
      ],
      [],
    );

    await expect(updateTeamLogo(1, 7, null)).rejects.toThrow("FORBIDDEN");
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(invalidateTeamIdentityViews).not.toHaveBeenCalled();
  });
});

describe("syncSoloEntryIdentity", () => {
  const user: Route = [
    /SELECT pseudo, avatar_url, visible_avatar, is_deleted\s+FROM bg_users/,
    () => [[{ pseudo: "Nova", avatar_url: null, visible_avatar: null, is_deleted: 0 }]],
  ];

  it("syncSoloEntryIdentity_playerWithSoloEntry_invalidatesLandingViews", async () => {
    install([], [[/SELECT id FROM bg_teams WHERE solo_user_id = \?/, () => [[{ id: 40 }]]], user, [/UPDATE bg_teams/, () => [{}]]]);

    await syncSoloEntryIdentity(9);

    expect(invalidateLandingTeamViews).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("syncSoloEntryIdentity_playerWithoutSoloEntry_invalidatesNothing", async () => {
    install([], [[/SELECT id FROM bg_teams WHERE solo_user_id = \?/, () => [[]]]]);

    await syncSoloEntryIdentity(9);

    expect(invalidateLandingTeamViews).not.toHaveBeenCalled();
  });
});
