import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/stats-service");

import { getDatabase } from "@/lib/server/database";
import { getPlayerEntityStats } from "@/lib/server/stats-service";
import { clearCache } from "@/lib/server/cache";
import { invalidateProfilelessPlayers, invalidateTeamIdentityViews, invalidateTeamRanking, invalidateTeamRankingForScore } from "@/lib/server/ranking-cache";
import { anonymizedAccountHasNoPage, loadProfilelessPlayerIds, loadProfilelessPlayerIdsForClient, PROFILELESS_PLAYERS_TTL_MS, PROFILELESS_PLAYERS_MAX, PROFILELESS_FAILURE_BACKOFF_MS, resetProfilelessFailureForTests } from "@/lib/server/users/profileless-players";
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
    if (sql.includes("u.is_deleted = 1")) return [played ? [] : [{ id: 7 }]];
    if (sql.includes("FROM bg_users WHERE id = ? LIMIT 1")) return [[row]];
    return [[]];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  resetProfilelessFailureForTests();
  jest.mocked(getPlayerEntityStats).mockResolvedValue({ stats: emptyDeepStats(), tournaments: [] });
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

  it("loadProfilelessPlayerIds_afterScore_keepsCachedList", async () => {
    const execute = mockDb(() => [[{ id: 3 }]]);

    await loadProfilelessPlayerIds();
    invalidateTeamRankingForScore();
    const ids = await loadProfilelessPlayerIds();

    expect(ids).toEqual([3]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  // EF-62 cycle 1 : un tournoi supprimé peut retirer son seul match joué.
  it("loadProfilelessPlayerIds_afterTournamentDeletionInvalidation_reloads", async () => {
    const execute = mockDb(() => [[{ id: 3 }]]);

    await loadProfilelessPlayerIds();
    invalidateTeamRanking();
    await loadProfilelessPlayerIds();

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("loadProfilelessPlayerIds_afterTtl_reloads", async () => {
    const execute = mockDb(() => [[{ id: 3 }]]);
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      await loadProfilelessPlayerIds();
      now.mockReturnValue(1_000_000 + PROFILELESS_PLAYERS_TTL_MS - 1);
      await loadProfilelessPlayerIds();
      expect(execute).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_000_000 + PROFILELESS_PLAYERS_TTL_MS + 1);
      await loadProfilelessPlayerIds();
      expect(execute).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });
});

describe("anonymizedAccountHasNoPage (EF-62 cycle 1)", () => {
  it("anonymizedAccountHasNoPage_idInCachedList_returnsTrue", async () => {
    mockDb(() => [[{ id: 7 }]]);

    expect(await anonymizedAccountHasNoPage(7)).toBe(true);
  });

  it("anonymizedAccountHasNoPage_idNotInList_returnsFalse", async () => {
    mockDb(() => [[{ id: 3 }]]);

    expect(await anonymizedAccountHasNoPage(7)).toBe(false);
  });

  it("anonymizedAccountHasNoPage_idAtEachEndOfSortedList_returnsTrue", async () => {
    mockDb(() => [[{ id: 2 }, { id: 5 }, { id: 7 }, { id: 11 }, { id: 40 }]]);

    expect(await anonymizedAccountHasNoPage(2)).toBe(true);
    expect(await anonymizedAccountHasNoPage(40)).toBe(true);
  });

  // Revue standard cycle 4 : la liste est triée dans le code, pas seulement par la requête.
  it("loadProfilelessPlayerIds_unsortedRows_returnsAscendingIds", async () => {
    mockDb(() => [[{ id: 9 }, { id: 2 }, { id: 5 }]]);

    expect(await loadProfilelessPlayerIds()).toEqual([2, 5, 9]);
    expect(await anonymizedAccountHasNoPage(2)).toBe(true);
  });

  it("anonymizedAccountHasNoPage_idBetweenListedIds_returnsFalse", async () => {
    mockDb(() => [[{ id: 2 }, { id: 5 }, { id: 11 }, { id: 40 }]]);

    expect(await anonymizedAccountHasNoPage(7)).toBe(false);
  });

  it("anonymizedAccountHasNoPage_listFailsAndNeverPlayed_returnsTrueFromLiveQuery", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const execute = mockDb((sql) => {
      if (sql.includes("u.is_deleted = 1")) throw new Error("LIST_DOWN");
      return [[{ played: 0 }]];
    });

    expect(await anonymizedAccountHasNoPage(7)).toBe(true);
    expect(execute).toHaveBeenLastCalledWith(expect.stringContaining("AS played"), [7]);
  });

  it("anonymizedAccountHasNoPage_listFailsAndPlayed_returnsFalse", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockDb((sql) => {
      if (sql.includes("u.is_deleted = 1")) throw new Error("LIST_DOWN");
      return [[{ played: 1 }]];
    });

    expect(await anonymizedAccountHasNoPage(7)).toBe(false);
  });

  // Revue standard cycle 2 : une double panne ferme la fiche (404), sans lever.
  it("anonymizedAccountHasNoPage_listAndLiveQueryFail_returnsTrue", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockDb(() => {
      throw new Error("DB_DOWN");
    });

    expect(await anonymizedAccountHasNoPage(7)).toBe(true);
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
    expect(execute.mock.calls.some(([sql]) => String(sql).includes("u.is_deleted = 1"))).toBe(false);
  });
});

describe("getPlayerPageIdentity — compte supprimé (D13)", () => {
  function identityDb(isDeleted: number, played: number, pending = false) {
    return mockDb((sql) => {
      if (sql.includes("u.is_deleted = 1")) return [played ? [] : [{ id: 7 }]];
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
    expect(layout).toContain("user ? loadProfilelessPlayerIdsForClient() : Promise.resolve(NO_PROFILELESS_PLAYERS)");
    expect(layout).toContain("<ProfilelessPlayersProvider ids={profilelessPlayers} refresh={user !== null}>");
  });
});

describe("loadProfilelessPlayerIds — panne de lecture (EF-62, revue performance)", () => {
  it("loadProfilelessPlayerIds_failureThenCallInBackoff_noSecondQuery", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const execute = mockDb(() => {
      throw new Error("LOCK_WAIT");
    });

    expect(await loadProfilelessPlayerIds()).toEqual([]);
    expect(await loadProfilelessPlayerIds()).toEqual([]);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("loadProfilelessPlayerIds_afterBackoff_retriesAndRecovers", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    let healthy = false;
    const execute = mockDb(() => {
      if (!healthy) throw new Error("LOCK_WAIT");
      return [[{ id: 3 }]];
    });
    await loadProfilelessPlayerIds();
    healthy = true;
    now.mockReturnValue(1_000_000 + PROFILELESS_FAILURE_BACKOFF_MS);

    expect(await loadProfilelessPlayerIds()).toEqual([3]);

    expect(execute).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it("loadProfilelessPlayerIds_failureAfterTtlWithStaleList_servesStaleList", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    let healthy = true;
    const execute = mockDb(() => {
      if (!healthy) throw new Error("LOCK_WAIT");
      return [[{ id: 3 }]];
    });
    await loadProfilelessPlayerIds();
    healthy = false;
    now.mockReturnValue(1_000_000 + PROFILELESS_PLAYERS_TTL_MS + 1);

    expect(await loadProfilelessPlayerIds()).toEqual([3]);
    // Pendant le délai de grâce : toujours la liste périmée, sans requête.
    expect(await loadProfilelessPlayerIds()).toEqual([3]);

    expect(execute).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  // Revue sécurité EF-62 cycle 1 : seule la copie du navigateur est tronquée.
  it("loadProfilelessPlayerIds_overCap_keepsFullListAndWarns", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockDb(() => [Array.from({ length: PROFILELESS_PLAYERS_MAX + 3 }, (_, index) => ({ id: index + 1 }))]);

    const ids = await loadProfilelessPlayerIds();

    expect(ids).toHaveLength(PROFILELESS_PLAYERS_MAX + 3);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("loadProfilelessPlayerIdsForClient_overCap_truncatedToMax", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    mockDb(() => [Array.from({ length: PROFILELESS_PLAYERS_MAX + 3 }, (_, index) => ({ id: index + 1 }))]);

    const ids = await loadProfilelessPlayerIdsForClient();

    expect(ids).toHaveLength(PROFILELESS_PLAYERS_MAX);
    // Les plus récents (ids les plus hauts) restent, les plus anciens tombent.
    expect(ids[0]).toBe(4);
    expect(ids[ids.length - 1]).toBe(PROFILELESS_PLAYERS_MAX + 3);
  });

  it("anonymizedAccountHasNoPage_idBeyondClientCap_returnsTrue", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    mockDb(() => [Array.from({ length: PROFILELESS_PLAYERS_MAX + 3 }, (_, index) => ({ id: index + 1 }))]);

    expect(await anonymizedAccountHasNoPage(PROFILELESS_PLAYERS_MAX + 2)).toBe(true);
  });

  it("anonymizedAccountHasNoPage_duringBackoff_readsTheAccountAloneWithoutLogSpam", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const execute = mockDb((sql) => {
      if (sql.includes("WHERE u.is_deleted = 1")) throw new Error("LOCK_WAIT");
      return [[{ played: 1 }]];
    });
    await loadProfilelessPlayerIds();
    error.mockClear();

    expect(await anonymizedAccountHasNoPage(7)).toBe(false);

    expect(error).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe("ranking-cache — clé de la liste", () => {
  it("rankingCache_profilelessKey_declaredBeforeItsFirstUse", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/server/ranking-cache.ts", "utf8");

    expect(source.indexOf("export const PROFILELESS_PLAYERS_CACHE_KEY")).toBeLessThan(
      source.indexOf("invalidateCached(PROFILELESS_PLAYERS_CACHE_KEY)"),
    );
  });
});

describe("ProfilelessRefresh — nouvel essai après un échec", () => {
  it("profilelessRefresh_failedFetch_waitsRetryDelayInsteadOfRetryingAtEveryPage", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("components/profileless-players.tsx", "utf8");
    const { PROFILELESS_REFRESH_MS, PROFILELESS_RETRY_MS } = await import("@/components/profileless-players");

    expect(PROFILELESS_RETRY_MS).toBeGreaterThan(0);
    expect(PROFILELESS_RETRY_MS).toBeLessThan(PROFILELESS_REFRESH_MS);
    expect(source).toContain("PROFILELESS_REFRESH_MS - PROFILELESS_RETRY_MS");
    expect(source).not.toContain("giveBack");
  });
});

// Revue juridique EF-62 cycle 1 : une correction d'arbitrage oublie la liste.
describe("invalidateProfilelessPlayers", () => {
  it("invalidateProfilelessPlayers_cachedList_nextReadRecomputes", async () => {
    const execute = mockDb(() => [[{ id: 3 }]]);

    await loadProfilelessPlayerIds();
    invalidateProfilelessPlayers();
    await loadProfilelessPlayerIds();

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("adminResolveMatchOnce_correctedOutcome_invalidatesProfilelessAfterCommit", () => {
    const source = readSource("lib/server/tournaments/index.ts");
    const commit = source.indexOf("await connection.commit();", source.indexOf("async function adminResolveMatchOnce"));
    const call = source.indexOf('if (dispute?.kind === "corrected") invalidateProfilelessPlayers();');

    expect(call).toBeGreaterThan(commit);
    expect(commit).toBeGreaterThan(0);
  });

  it("loadProfilelessPlayerIdsForClient_underCap_returnsAll", async () => {
    mockDb(() => [[{ id: 3 }, { id: 8 }]]);

    const ids = await loadProfilelessPlayerIdsForClient();

    expect(ids).toEqual([3, 8]);
  });
});
