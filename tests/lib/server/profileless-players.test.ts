import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/stats-service");

import { getDatabase } from "@/lib/server/database";
import { getPlayerEntityStats } from "@/lib/server/stats-service";
import { clearCache } from "@/lib/server/cache";
import { invalidateTeamIdentityViews, invalidateTeamRanking } from "@/lib/server/ranking-cache";
import { deletedAccountHasStats, loadProfilelessPlayerIds } from "@/lib/server/users/profileless-players";
import { getFullProfile, getPlayerPageIdentity } from "@/lib/server/users/full-profile";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";
import { readSource } from "../../helpers/read-source";
import { emptyDeepStats } from "@/lib/shared/stats";

/**
 * D13 : la fiche d'un compte supprimé ne reste que s'il a joué ; sinon elle
 * répond comme un compte inconnu, et la liste des comptes sans fiche nourrit
 * les liens rendus en texte.
 */
function mockDb(handler: (sql: string, params?: unknown) => unknown) {
  const execute = jest.fn<SqlQuery>(async (sql, params) => handler(String(sql).replace(/\s+/g, " ").trim(), params));
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute;
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    pseudo: "Renard Pâle",
    avatar_url: null,
    overwatch_battletag: null,
    marvel_rivals_tag: null,
    discord_pseudo: null,
    discord_verified_at: null,
    blizzard_linked: 0,
    is_adult: null,
    visible_avatar: 0,
    visible_overwatch: 0,
    visible_marvel: 0,
    visible_major: 0,
    visible_discord: 0,
    open_to_recruitment: 0,
    is_admin: 0,
    platform_roles_json: null,
    is_deleted: 1,
    locale: "fr",
    created_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

/** Base d'une fiche : la ligne du compte, la trace « a joué », le reste vide. */
function profileDb(row: Record<string, unknown>, played: number) {
  return mockDb((sql) => {
    if (sql.includes("AS played")) return [[{ played }]];
    if (sql.includes("FROM bg_users WHERE id = ? LIMIT 1")) return [[row]];
    return [[]];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  jest.mocked(getPlayerEntityStats).mockResolvedValue({ stats: emptyDeepStats(), tournaments: [] });
});

describe("deletedAccountHasStats", () => {
  it("deletedAccountHasStats_playedTrue_returnsTrue", async () => {
    const execute = mockDb(() => [[{ played: 1 }]]);

    expect(await deletedAccountHasStats(7)).toBe(true);
    expect(execute.mock.calls[0][1]).toEqual([7]);
  });

  it("deletedAccountHasStats_playedFalse_returnsFalse", async () => {
    mockDb(() => [[{ played: 0 }]]);

    expect(await deletedAccountHasStats(7)).toBe(false);
  });
});

describe("loadProfilelessPlayerIds", () => {
  it("loadProfilelessPlayerIds_rows_returnsIds", async () => {
    const execute = mockDb(() => [[{ id: 3 }, { id: 12 }]]);

    expect(await loadProfilelessPlayerIds()).toEqual([3, 12]);
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toContain("u.is_deleted = 1");
    // Un compte en attente de suppression n'a pas de fiche, même s'il a joué.
    expect(sql).toContain("u.deletion_requested_at IS NOT NULL OR NOT");
  });

  it("loadProfilelessPlayerIds_dbFails_returnsEmpty", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.mocked(getDatabase).mockRejectedValue(new Error("DB_DOWN"));

    expect(await loadProfilelessPlayerIds()).toEqual([]);
  });

  it("loadProfilelessPlayerIds_cached_secondCallNoQuery", async () => {
    const execute = mockDb(() => [[{ id: 3 }]]);

    await loadProfilelessPlayerIds();
    await loadProfilelessPlayerIds();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("loadProfilelessPlayerIds_afterAccountDeletionInvalidation_reloads", async () => {
    const execute = mockDb(() => [[{ id: 3 }]]);

    await loadProfilelessPlayerIds();
    invalidateTeamIdentityViews();
    await loadProfilelessPlayerIds();

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("loadProfilelessPlayerIds_afterScore_reloads", async () => {
    const execute = mockDb(() => [[{ id: 3 }]]);

    await loadProfilelessPlayerIds();
    invalidateTeamRanking();
    await loadProfilelessPlayerIds();

    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe("getFullProfile — compte supprimé (D13)", () => {
  it("getFullProfile_deletedWithoutStats_returnsNull", async () => {
    profileDb(userRow(), 0);

    expect(await getFullProfile({ id: 1 }, 7)).toBeNull();
  });

  it("getFullProfile_deletedWithStats_returnsProfile", async () => {
    profileDb(userRow(), 1);

    const profile = await getFullProfile({ id: 1 }, 7);

    expect(profile?.profile.isDeleted).toBe(true);
  });

  it("getFullProfile_pendingDeletionWithStats_returnsNull", async () => {
    // ERASURE-D2 : invisible pendant les trente jours, son vrai pseudo est encore là.
    profileDb(userRow({ deletion_requested_at: "2026-11-01 10:00:00" }), 1);

    expect(await getFullProfile({ id: 1 }, 7)).toBeNull();
  });

  it("getFullProfile_liveAccount_neverAsksForStats", async () => {
    const execute = profileDb(userRow({ is_deleted: 0, pseudo: "Vivant" }), 0);

    const profile = await getFullProfile({ id: 1 }, 7);

    expect(profile?.profile.isDeleted).toBe(false);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes("AS played"))).toBe(false);
  });
});

describe("getPlayerPageIdentity — compte supprimé (D13)", () => {
  function identityDb(isDeleted: number, played: number, pending = false) {
    return mockDb((sql) => {
      if (sql.includes("AS played")) return [[{ played }]];
      return [[{ pseudo: "Renard Pâle", is_deleted: isDeleted, deletion_requested_at: pending ? "2026-11-01 10:00:00" : null }]];
    });
  }

  it("getPlayerPageIdentity_deletedWithoutStats_returnsNull", async () => {
    identityDb(1, 0);

    expect(await getPlayerPageIdentity(7)).toBeNull();
  });

  it("getPlayerPageIdentity_pendingDeletionWithStats_returnsNull", async () => {
    identityDb(1, 1, true);

    expect(await getPlayerPageIdentity(7)).toBeNull();
  });

  it("getPlayerPageIdentity_deletedWithStats_returnsIdentity", async () => {
    identityDb(1, 1);

    expect(await getPlayerPageIdentity(7)).toEqual({ pseudo: "Renard Pâle", isDeleted: true });
  });
});

describe("branchements D13", () => {
  it("api_players_id_noProfile_returns404PlayerNotFound", () => {
    // La route rend 404 dès que `getFullProfile` ne rend rien : la fiche d'un
    // compte supprimé sans statistiques répond comme un compte inconnu.
    const route = readSource("app/api/players/[id]/route.ts");
    expect(route).toContain('if (!profile) return fail("PLAYER_NOT_FOUND", 404);');
  });

  it("landing_entrantHrefFor_profilelessSolo_returnsNoHref", () => {
    const landing = readSource("lib/server/landing-service.ts");
    expect(landing).toContain("if (soloUserId !== null && profileless.has(Number(soloUserId))) return null;");
    expect(landing).toContain("entrantHrefFor(row.team1_id, row.team1_solo_user_id, profileless)");
    expect(landing).toContain("entrantHrefFor(row.team2_id, row.team2_solo_user_id, profileless)");
  });

  it("layout_signedInVisitor_providesProfilelessPlayers", () => {
    const layout = readSource("app/layout.tsx");
    expect(layout).toContain("user ? loadProfilelessPlayerIds() : Promise.resolve(NO_PROFILELESS_PLAYERS)");
    expect(layout).toContain("<ProfilelessPlayersProvider ids={profilelessPlayers}>");
  });
});
