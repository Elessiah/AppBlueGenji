import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database", () => ({ withConnection: jest.fn() }));
jest.mock("@/lib/server/cache", () => ({ cached: jest.fn(), invalidateCached: jest.fn(), invalidateCachedPrefix: jest.fn() }));
jest.mock("@/lib/server/tournaments/notifications", () => ({ publishMatchUpdatedEvent: jest.fn() }));

import { cached, invalidateCached, invalidateCachedPrefix } from "@/lib/server/cache";
import { withConnection } from "@/lib/server/database";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import {
  forgetLiveRefereeNames,
  forgetRefereeNames,
  forgetRefereeNamesOf,
  loadLiveRefereeNames,
  loadRefereeNames,
  markViewerReferee,
  refereeKey,
  refereeKeySecret,
  REFEREE_RENAME_BATCH_DELAY_MS,
  viewerDesignated,
  withoutRefereeKeys,
  type RefereeNamesRead,
} from "@/lib/server/tournaments/referee-names";
import { bracketMatch } from "../../../helpers/bracket-match";
import { connectionMock, fakeConnection } from "../../../helpers/sql-double";
import { tournamentCard } from "../../../helpers/tournament-card";
import { tournamentSnapshot } from "../../../helpers/tournament-detail";

/** Pseudos d'arbitre pour les membres connectés (MATCH-UI-NAMES, décision 52). */

const connection = connectionMock();

function snapshotWith(...matches: ReturnType<typeof bracketMatch>[]) {
  return tournamentSnapshot({ card: tournamentCard({ id: 7 }), version: "v9", matches });
}

function rows(...value: { id: number; referee_user_id: number; pseudo: string }[]) {
  connection.query.mockResolvedValue([value]);
}

/** Ligne de la lecture directe : arbitre éligible en Marvel Rivals (tag Discord certifié, rôle staff). */
function liveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    status: "READY",
    team1_id: 1,
    team2_id: 2,
    launch_pairing: null,
    launched_at: null,
    referee_user_id: 9,
    referee_pseudo: "Alpha",
    referee_discord_verified_at: new Date("2026-01-01T00:00:00Z"),
    referee_discord_pseudo: "alpha",
    referee_blizzard_sub: null,
    referee_overwatch_battletag: null,
    referee_overwatch_battletag_typed: 0,
    referee_is_deleted: 0,
    referee_is_admin: 1,
    referee_platform_roles_json: "[]",
    referee_objection_at: null,
    referee_plays_match: 0,
    ...overrides,
  };
}

const READ: RefereeNamesRead = {
  names: [{ matchId: 5, refereeKey: "k5", pseudo: "Arbitre" }],
  designations: [
    { matchId: 5, refereeKey: "k5", pseudo: "Arbitre", refereeUserId: 3 },
    { matchId: 6, refereeKey: "k6", pseudo: "", refereeUserId: 9 },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(cached).mockImplementation((_key, _ttl, loader) => loader());
  jest.mocked(withConnection).mockImplementation((run) => run(fakeConnection(connection)));
});

describe("refereeKey", () => {
  it("refereeKey_samePseudo_returnsSameStable16CharKey", () => {
    const first = refereeKey(5, 9, "Alpha");
    const second = refereeKey(5, 9, "Alpha");

    expect(first).toBe(second);
    expect(first).toMatch(/^[\w-]{16}$/);
  });

  it("refereeKey_otherUserOrOtherMatch_returnsDifferentKey", () => {
    const keys = new Set([refereeKey(5, 9, "A"), refereeKey(5, 10, "A"), refereeKey(6, 9, "A")]);

    expect(keys.size).toBe(3);
  });

  it("refereeKey_otherPseudo_returnsDifferentKey", () => {
    expect(refereeKey(5, 9, "Nouveau")).not.toBe(refereeKey(5, 9, "Ancien"));
  });

  it("refereeKey_moduleReevaluated_keepsSameKey", () => {
    const before = refereeKey(5, 9, "A");
    let again: typeof import("@/lib/server/tournaments/referee-names") | undefined;
    jest.isolateModules(() => {
      again = jest.requireActual<typeof import("@/lib/server/tournaments/referee-names")>("@/lib/server/tournaments/referee-names");
    });

    expect(again?.refereeKey(5, 9, "A")).toBe(before);
  });
});

describe("refereeKeySecret", () => {
  it("refereeKeySecret_sameConfiguredSalt_returnsSameSecret", () => {
    const env = { NODE_ENV: "test", VISIT_HASH_SALT: "sel" } as NodeJS.ProcessEnv;

    expect(refereeKeySecret(env).equals(refereeKeySecret(env))).toBe(true);
  });

  it("refereeKeySecret_botTokenOnly_derivesStableSecretDistinctFromToken", () => {
    const env = { NODE_ENV: "test", BOT_INTERNAL_TOKEN: "jeton" } as NodeJS.ProcessEnv;

    const secret = refereeKeySecret(env);

    expect(secret.equals(refereeKeySecret(env))).toBe(true);
    expect(secret.toString("utf8")).not.toBe("jeton");
  });

  it("refereeKeySecret_noSecretInProduction_warns", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    refereeKeySecret({ NODE_ENV: "production" } as NodeJS.ProcessEnv);

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("refereeKeySecret_noSecretOutsideProduction_staysSilent", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    refereeKeySecret({ NODE_ENV: "development" } as NodeJS.ProcessEnv);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("refereeKeySecret_noSecretConfigured_returnsRandomSecret", () => {
    const env = { NODE_ENV: "test" } as NodeJS.ProcessEnv;

    expect(refereeKeySecret(env).equals(refereeKeySecret(env))).toBe(false);
  });
});

describe("loadRefereeNames", () => {
  it("loadRefereeNames_noShownKey_returnsEmptyWithoutQuery", async () => {
    const read = await loadRefereeNames(snapshotWith(bracketMatch({ id: 5, refereeKey: null })));

    expect(read).toEqual({ names: [], designations: [] });
    expect(cached).not.toHaveBeenCalled();
    expect(withConnection).not.toHaveBeenCalled();
  });

  it("loadRefereeNames_rowKeyMatchesSnapshot_returnsNamesAndDesignations", async () => {
    rows({ id: 5, referee_user_id: 9, pseudo: "Alpha" });

    const read = await loadRefereeNames(snapshotWith(bracketMatch({ id: 5, refereeKey: refereeKey(5, 9, "Alpha") })));

    expect(read).toEqual({
      names: [{ matchId: 5, refereeKey: refereeKey(5, 9, "Alpha"), pseudo: "Alpha" }],
      designations: [{ matchId: 5, refereeKey: refereeKey(5, 9, "Alpha"), pseudo: "Alpha", refereeUserId: 9 }],
    });
  });

  it("loadRefereeNames_rowFromNewerDesignation_isSkipped", async () => {
    rows({ id: 5, referee_user_id: 10, pseudo: "Nouveau" });

    const read = await loadRefereeNames(snapshotWith(bracketMatch({ id: 5, refereeKey: refereeKey(5, 9, "Alpha") })));

    expect(read.designations).toEqual([]);
  });

  it("loadRefereeNames_refereeRenamedSinceSnapshot_isSkipped", async () => {
    rows({ id: 5, referee_user_id: 9, pseudo: "Renommé" });

    const read = await loadRefereeNames(snapshotWith(bracketMatch({ id: 5, refereeKey: refereeKey(5, 9, "Alpha") })));

    expect(read.designations).toEqual([]);
  });

  it("loadRefereeNames_matchNotShownInSnapshot_isSkipped", async () => {
    rows({ id: 6, referee_user_id: 9, pseudo: "Caché" });

    const read = await loadRefereeNames(
      snapshotWith(bracketMatch({ id: 5, refereeKey: refereeKey(5, 9, "A") }), bracketMatch({ id: 6, refereeKey: null })),
    );

    expect(read.designations).toEqual([]);
  });

  it("loadRefereeNames_onlyScoreDeclaredMatches_returnsEmptyWithoutQuery", async () => {
    const read = await loadRefereeNames(
      snapshotWith(bracketMatch({ id: 5, status: "AWAITING_CONFIRMATION", refereeKey: refereeKey(5, 9, "A") })),
    );

    expect(read.names).toEqual([]);
    expect(connection.query).not.toHaveBeenCalled();
  });

  it("loadRefereeNames_blankOrInvisiblePseudo_keptInDesignationsOnly", async () => {
    rows({ id: 5, referee_user_id: 9, pseudo: "​​" });

    const read = await loadRefereeNames(snapshotWith(bracketMatch({ id: 5, refereeKey: refereeKey(5, 9, "​​") })));

    expect(read.names).toEqual([]);
    expect(read.designations).toEqual([{ matchId: 5, refereeKey: refereeKey(5, 9, "​​"), pseudo: "", refereeUserId: 9 }]);
  });

  it("loadRefereeNames_query_excludesUpheldObjectionAndDeletedAccounts", async () => {
    rows();

    await loadRefereeNames(snapshotWith(bracketMatch({ id: 5, refereeKey: refereeKey(5, 9, "A") })));

    const sql = String(connection.query.mock.calls[0][0]);
    expect(sql).toContain("u.referee_objection_at IS NULL");
    expect(sql).toContain("u.is_deleted = 0");
  });

  it("loadRefereeNames_cachesPerTournamentAndVersion", async () => {
    rows();

    await loadRefereeNames(snapshotWith(bracketMatch({ id: 5, refereeKey: refereeKey(5, 9, "A") })));

    expect(jest.mocked(cached).mock.calls[0].slice(0, 2)).toEqual(["referee-names:7:v9", 30_000]);
    expect(connection.query.mock.calls[0][1]).toEqual([7, 5]);
  });

  it("loadRefereeNames_query_readsOnlyShownMatches", async () => {
    rows();

    await loadRefereeNames(
      snapshotWith(
        bracketMatch({ id: 5, refereeKey: refereeKey(5, 9, "A") }),
        bracketMatch({ id: 6, refereeKey: refereeKey(6, 9, "A") }),
        bracketMatch({ id: 8, status: "COMPLETED", refereeKey: refereeKey(8, 9, "A") }),
      ),
    );

    expect(String(connection.query.mock.calls[0][0])).toContain("m.id IN (?, ?)");
    expect(connection.query.mock.calls[0][1]).toEqual([7, 5, 6]);
  });
});

describe("loadLiveRefereeNames", () => {
  const card = { id: 7, game: "MR" as const, state: "RUNNING" as const };

  it("loadLiveRefereeNames_finishedTournament_returnsEmptyWithoutQuery", async () => {
    const read = await loadLiveRefereeNames({ ...card, state: "FINISHED" });

    expect(read).toEqual({ names: [], designations: [] });
    expect(withConnection).not.toHaveBeenCalled();
  });

  it("loadLiveRefereeNames_eligibleReferee_returnsKeyedName", async () => {
    connection.query.mockResolvedValue([[liveRow()]]);

    const read = await loadLiveRefereeNames(card);

    expect(read.names).toEqual([{ matchId: 5, refereeKey: refereeKey(5, 9, "Alpha"), pseudo: "Alpha" }]);
    expect(jest.mocked(cached).mock.calls[0][0]).toBe("referee-names:7:live");
    expect(connection.query.mock.calls[0][1]).toEqual([7]);
  });

  it("loadLiveRefereeNames_refereePlaysMatchBeforeLaunch_isSkipped", async () => {
    connection.query.mockResolvedValue([[liveRow({ referee_plays_match: 1 })]]);

    const read = await loadLiveRefereeNames(card);

    expect(read.designations).toEqual([]);
  });

  it("loadLiveRefereeNames_refereeWithoutPermission_isSkipped", async () => {
    connection.query.mockResolvedValue([[liveRow({ referee_is_admin: 0 })]]);

    const read = await loadLiveRefereeNames(card);

    expect(read.designations).toEqual([]);
  });

  it("loadLiveRefereeNames_query_readsMatchesToPlayWithoutObjection", async () => {
    connection.query.mockResolvedValue([[]]);

    await loadLiveRefereeNames(card);

    const sql = String(connection.query.mock.calls[0][0]);
    expect(sql).toContain("m.status IN ('PENDING', 'READY')");
    expect(sql).toContain("ru.referee_objection_at IS NULL");
  });
});

describe("withoutRefereeKeys", () => {
  it("withoutRefereeKeys_pendingMatchWithKey_nullsKeyKeepsOtherFields", () => {
    const keyed = bracketMatch({ id: 5, status: "READY", refereeKey: "k-arbitre", refereeAssigned: true });
    const unkeyed = bracketMatch({ id: 6, refereeKey: null });

    const actual = withoutRefereeKeys([keyed, unkeyed]);

    expect(actual).toEqual([{ ...keyed, refereeKey: null }, unkeyed]);
  });

  it("withoutRefereeKeys_awaitingConfirmationMatch_keepsKey", () => {
    const matches = [bracketMatch({ id: 5, status: "AWAITING_CONFIRMATION", refereeKey: "k-arbitre" })];

    expect(withoutRefereeKeys(matches)).toBe(matches);
  });

  it("withoutRefereeKeys_noKeys_returnsSameArray", () => {
    const matches = [bracketMatch({ id: 5, refereeKey: null })];

    expect(withoutRefereeKeys(matches)).toBe(matches);
  });
});

describe("markViewerReferee", () => {
  it("markViewerReferee_viewerDesignatedAndEligible_marksMineIncludingEmptyPseudo", () => {
    expect(markViewerReferee(READ, 9, true)).toEqual([
      { matchId: 5, refereeKey: "k5", pseudo: "Arbitre" },
      { matchId: 6, refereeKey: "k6", pseudo: "", mine: true },
    ]);
  });

  it("markViewerReferee_viewerDesignatedNotEligible_returnsCommonList", () => {
    expect(markViewerReferee(READ, 9, false)).toBe(READ.names);
  });

  it("markViewerReferee_viewerNotDesignated_returnsCommonList", () => {
    expect(markViewerReferee(READ, 4, true)).toBe(READ.names);
  });
});

describe("viewerDesignated", () => {
  it("viewerDesignated_viewerRefereesAMatch_returnsTrue", () => {
    expect(viewerDesignated(READ, 9)).toBe(true);
  });

  it("viewerDesignated_viewerRefereesNothing_returnsFalse", () => {
    expect(viewerDesignated(READ, 4)).toBe(false);
  });
});

describe("forgetRefereeNames", () => {
  it("forgetRefereeNames_called_invalidatesRefereeNamesPrefix", () => {
    forgetRefereeNames();

    expect(invalidateCachedPrefix).toHaveBeenCalledWith("referee-names:");
  });

  it("forgetLiveRefereeNames_called_invalidatesLiveKey", () => {
    forgetLiveRefereeNames(7);

    expect(invalidateCached).toHaveBeenCalledWith("referee-names:7:live");
  });
});

describe("forgetRefereeNamesOf", () => {
  it("forgetRefereeNamesOf_refereesShownMatches_invalidatesAndRepublishesTheirTournaments", async () => {
    connection.query.mockResolvedValue([[{ tournament_id: 7 }, { tournament_id: 9 }]]);

    await forgetRefereeNamesOf(4);

    expect(connection.query).toHaveBeenCalledWith(expect.stringContaining("m.referee_user_id = ? AND m.status <> 'COMPLETED' AND t.state <> 'FINISHED'"), [4]);
    expect(connection.query).toHaveBeenCalledWith(expect.stringMatching(/LIMIT 500$/), [4]);
    expect(jest.mocked(invalidateCachedPrefix).mock.calls).toEqual([["referee-names:7:"], ["referee-names:9:"]]);
    expect(jest.mocked(publishMatchUpdatedEvent).mock.calls).toEqual([[7], [9]]);
  });

  it("forgetRefereeNamesOf_moreThanOneBatch_publishesFirst50NowAndTheRestAfterDelay", async () => {
    jest.useFakeTimers();
    const ids = Array.from({ length: 60 }, (_, index) => 100 - index);
    connection.query.mockResolvedValue([ids.map((id) => ({ tournament_id: id }))]);

    await forgetRefereeNamesOf(4);
    const publishedAtOnce = jest.mocked(publishMatchUpdatedEvent).mock.calls.length;
    jest.advanceTimersByTime(REFEREE_RENAME_BATCH_DELAY_MS);
    jest.useRealTimers();

    expect(publishedAtOnce).toBe(50);
    expect(jest.mocked(publishMatchUpdatedEvent).mock.calls.slice(50)).toEqual(ids.slice(50).map((id) => [id]));
    expect(invalidateCachedPrefix).toHaveBeenCalledTimes(60);
  });

  it("forgetRefereeNamesOf_publishThrows_logsAndStillPublishesNextBatch", async () => {
    jest.useFakeTimers();
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const ids = Array.from({ length: 51 }, (_, index) => index + 1);
    connection.query.mockResolvedValue([ids.map((id) => ({ tournament_id: id }))]);
    jest.mocked(publishMatchUpdatedEvent).mockImplementationOnce(() => {
      throw new Error("listener");
    });

    await forgetRefereeNamesOf(4);
    jest.advanceTimersByTime(REFEREE_RENAME_BATCH_DELAY_MS);
    jest.useRealTimers();

    expect(errorLog).toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).toHaveBeenLastCalledWith(51);
    errorLog.mockRestore();
  });

  it("forgetRefereeNamesOf_refereesNothingShown_keepsCacheAndPublishesNothing", async () => {
    connection.query.mockResolvedValue([[]]);

    await forgetRefereeNamesOf(4);

    expect(invalidateCachedPrefix).not.toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("forgetRefereeNamesOf_readFails_invalidatesWholeCache", async () => {
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
    connection.query.mockRejectedValue(new Error("ECONNRESET"));

    await forgetRefereeNamesOf(4);

    expect(invalidateCachedPrefix).toHaveBeenCalledWith("referee-names:");
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
