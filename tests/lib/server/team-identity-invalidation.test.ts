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
const lockTeam = (row: { logo_url: string | null; deleted_at: Date | null; is_ghost: 0 | 1 } | null): Route => [
  /SELECT logo_url, deleted_at, is_ghost FROM bg_teams WHERE id = \? FOR UPDATE/,
  () => [row ? [row] : []],
];
const lockLogo = (logo: string | null): Route => lockTeam({ logo_url: logo, deleted_at: null, is_ghost: 0 });
const lockedRoles = (roles: string[] | null): Route => [
  /SELECT roles_json\s+FROM bg_team_members[\s\S]*FOR UPDATE/,
  () => [roles ? [{ roles_json: JSON.stringify(roles) }] : []],
];
const writeLogo: Route = [/UPDATE bg_teams SET logo_url = \?/, () => [{}]];
const notMember: Route = [/SELECT roles_json\s+FROM bg_team_members/, () => [[]]];
const ghostBeforeLock: Route = [/SELECT is_ghost, deleted_at FROM bg_teams/, () => [[{ is_ghost: 1, deleted_at: null }]]];

beforeEach(() => {
  jest.clearAllMocks();
});

describe("updateTeamLogo", () => {
  it("updateTeamLogo_newLogo_returnsLogoReadUnderLock", async () => {
    install([manager], [lockedRoles(["MANAGER"]), lockLogo("/api/uploads/teams/old.webp"), [/UPDATE bg_teams SET logo_url = \?/, () => [{}]]]);

    const result = await updateTeamLogo(1, 7, "/api/uploads/teams/new.webp");

    expect(result).toEqual({ previousLogoUrl: "/api/uploads/teams/old.webp" });
  });

  it("updateTeamLogo_managerUnderLock_locksTeamThenMemberBeforeWriting", async () => {
    install([manager], [lockedRoles(["MANAGER"]), lockLogo(null), [/UPDATE bg_teams SET logo_url = \?/, () => [{}]]]);

    await updateTeamLogo(1, 7, "/api/uploads/teams/new.webp");

    const statements = connection.execute.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toMatch(/FROM bg_teams WHERE id = \? FOR UPDATE/);
    expect(statements[1]).toMatch(/FROM bg_team_members[\s\S]*FOR UPDATE/);
    expect(statements[2]).toMatch(/UPDATE bg_teams SET logo_url = \?/);
    expect(connection.execute.mock.calls[2][1]).toEqual(["/api/uploads/teams/new.webp", 7]);
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("updateTeamLogo_teamWithoutLogo_returnsNullPrevious", async () => {
    install([manager], [lockedRoles(["MANAGER"]), lockLogo(null), [/UPDATE bg_teams SET logo_url = \?/, () => [{}]]]);

    expect(await updateTeamLogo(1, 7, null)).toEqual({ previousLogoUrl: null });
  });

  it("updateTeamLogo_committed_invalidatesIdentityViewsAfterCommit", async () => {
    install([manager], [lockedRoles(["MANAGER"]), lockLogo(null), [/UPDATE bg_teams SET logo_url = \?/, () => [{}]]]);

    await updateTeamLogo(1, 7, "/api/uploads/teams/new.webp");

    expect(invalidateTeamIdentityViews).toHaveBeenCalledTimes(1);
    expect(jest.mocked(invalidateTeamIdentityViews).mock.invocationCallOrder[0]).toBeGreaterThan(
      connection.commit.mock.invocationCallOrder[0],
    );
  });

  it("updateTeamLogo_removingAbsentLogo_invalidatesNothing", async () => {
    install([manager], [lockedRoles(["MANAGER"]), lockLogo(null), [/UPDATE bg_teams SET logo_url = \?/, () => [{}]]]);

    await updateTeamLogo(1, 7, null);

    expect(invalidateTeamIdentityViews).not.toHaveBeenCalled();
  });

  it("updateTeamLogo_removingExistingLogo_invalidatesIdentityViews", async () => {
    install([manager], [lockedRoles(["MANAGER"]), lockLogo("/api/uploads/teams/old.webp"), [/UPDATE bg_teams SET logo_url = \?/, () => [{}]]]);

    await updateTeamLogo(1, 7, null);

    expect(invalidateTeamIdentityViews).toHaveBeenCalledTimes(1);
  });

  it("updateTeamLogo_writeFails_rollsBackAndInvalidatesNothing", async () => {
    install(
      [manager],
      [
        lockedRoles(["MANAGER"]),
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

/**
 * Le droit se rejuge sous le verrou de la ligne d'équipe : un envoi croisé
 * avec une dissolution, une rétrogradation ou la reprise d'une fantôme
 * n'écrit rien.
 */
describe("updateTeamLogo — droit rejugé sous verrou", () => {
  function expectRefusedWithoutWrite() {
    const statements = connection.execute.mock.calls.map(([sql]) => sql);
    expect(statements.some((sql) => /UPDATE bg_teams SET logo_url/.test(sql))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(invalidateTeamIdentityViews).not.toHaveBeenCalled();
  }

  it("updateTeamLogo_teamDissolvedBeforeLock_throwsForbiddenAndRollsBack", async () => {
    install(
      [manager],
      [lockTeam({ logo_url: null, deleted_at: new Date("2026-10-29T10:00:00Z"), is_ghost: 0 }), lockedRoles(["MANAGER"]), writeLogo],
    );

    await expect(updateTeamLogo(1, 7, "/api/uploads/teams/new.webp")).rejects.toThrow("FORBIDDEN");
    expectRefusedWithoutWrite();
  });

  it("updateTeamLogo_teamRowMissingUnderLock_throwsForbidden", async () => {
    install([manager], [lockTeam(null), lockedRoles(["MANAGER"]), writeLogo]);

    await expect(updateTeamLogo(1, 7, null)).rejects.toThrow("FORBIDDEN");
    expectRefusedWithoutWrite();
  });

  it("updateTeamLogo_managerDemotedBeforeLock_throwsForbidden", async () => {
    install([manager], [lockLogo("/api/uploads/teams/old.webp"), lockedRoles(["TANK"]), writeLogo]);

    await expect(updateTeamLogo(1, 7, "/api/uploads/teams/new.webp")).rejects.toThrow("FORBIDDEN");
    expectRefusedWithoutWrite();
  });

  it("updateTeamLogo_memberLeftBeforeLock_throwsForbidden", async () => {
    install([manager], [lockLogo("/api/uploads/teams/old.webp"), lockedRoles(null), writeLogo]);

    await expect(updateTeamLogo(1, 7, null)).rejects.toThrow("FORBIDDEN");
    expectRefusedWithoutWrite();
  });

  it("updateTeamLogo_ghostTakenOverBeforeLock_throwsForbidden", async () => {
    install([notMember, ghostBeforeLock], [lockTeam({ logo_url: null, deleted_at: null, is_ghost: 0 }), writeLogo]);

    await expect(updateTeamLogo(1, 7, "/api/uploads/teams/new.webp", true)).rejects.toThrow("FORBIDDEN");
    expectRefusedWithoutWrite();
  });

  it("updateTeamLogo_staffOnGhostUnderLock_writesWithoutMemberLock", async () => {
    install([notMember, ghostBeforeLock], [lockTeam({ logo_url: "/api/uploads/teams/old.webp", deleted_at: null, is_ghost: 1 }), writeLogo]);

    const result = await updateTeamLogo(1, 7, "/api/uploads/teams/new.webp", true);

    expect(result).toEqual({ previousLogoUrl: "/api/uploads/teams/old.webp" });
    const statements = connection.execute.mock.calls.map(([sql]) => sql);
    expect(statements.some((sql) => /bg_team_members/.test(sql))).toBe(false);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });
});
