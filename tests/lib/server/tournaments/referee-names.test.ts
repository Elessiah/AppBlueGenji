import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database", () => ({ withConnection: jest.fn() }));
jest.mock("@/lib/server/cache", () => ({ cached: jest.fn() }));

import { cached } from "@/lib/server/cache";
import { withConnection } from "@/lib/server/database";
import { loadRefereeNames, markViewerReferee, refereeKey, withoutRefereeKeys } from "@/lib/server/tournaments/referee-names";
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

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(cached).mockImplementation((_key, _ttl, loader) => loader());
  jest.mocked(withConnection).mockImplementation((run) => run(fakeConnection(connection)));
});

describe("refereeKey", () => {
  it("refereeKey_sameMatchAndUser_returnsSameStable16CharKey", () => {
    const first = refereeKey(5, 9);
    const second = refereeKey(5, 9);

    expect(first).toBe(second);
    expect(first).toMatch(/^[\w-]{16}$/);
  });

  it("refereeKey_otherUserOrOtherMatch_returnsDifferentKey", () => {
    const keys = new Set([refereeKey(5, 9), refereeKey(5, 10), refereeKey(6, 9)]);

    expect(keys.size).toBe(3);
  });
});

describe("loadRefereeNames", () => {
  it("loadRefereeNames_noShownKey_returnsEmptyWithoutQuery", async () => {
    const names = await loadRefereeNames(snapshotWith(bracketMatch({ id: 5, refereeKey: null })));

    expect(names).toEqual([]);
    expect(cached).not.toHaveBeenCalled();
    expect(withConnection).not.toHaveBeenCalled();
  });

  it("loadRefereeNames_rowKeyMatchesSnapshot_returnsVisiblePseudo", async () => {
    rows({ id: 5, referee_user_id: 9, pseudo: "Alpha" });

    const names = await loadRefereeNames(snapshotWith(bracketMatch({ id: 5, refereeKey: refereeKey(5, 9) })));

    expect(names).toEqual([{ matchId: 5, refereeKey: refereeKey(5, 9), pseudo: "Alpha" }]);
  });

  it("loadRefereeNames_rowFromNewerDesignation_isSkipped", async () => {
    rows({ id: 5, referee_user_id: 10, pseudo: "Nouveau" });

    const names = await loadRefereeNames(snapshotWith(bracketMatch({ id: 5, refereeKey: refereeKey(5, 9) })));

    expect(names).toEqual([]);
  });

  it("loadRefereeNames_matchNotShownInSnapshot_isSkipped", async () => {
    rows({ id: 6, referee_user_id: 9, pseudo: "Caché" });

    const names = await loadRefereeNames(
      snapshotWith(bracketMatch({ id: 5, refereeKey: refereeKey(5, 9) }), bracketMatch({ id: 6, refereeKey: null })),
    );

    expect(names).toEqual([]);
  });

  it("loadRefereeNames_onlyScoreDeclaredMatches_returnsEmptyWithoutQuery", async () => {
    const names = await loadRefereeNames(
      snapshotWith(bracketMatch({ id: 5, status: "AWAITING_CONFIRMATION", refereeKey: refereeKey(5, 9) })),
    );

    expect(names).toEqual([]);
    expect(connection.query).not.toHaveBeenCalled();
  });

  it("loadRefereeNames_blankOrInvisiblePseudo_isSkipped", async () => {
    rows({ id: 5, referee_user_id: 9, pseudo: "\u200B\u200B" });

    const names = await loadRefereeNames(snapshotWith(bracketMatch({ id: 5, refereeKey: refereeKey(5, 9) })));

    expect(names).toEqual([]);
  });

  it("loadRefereeNames_query_excludesUpheldObjection", async () => {
    rows();

    await loadRefereeNames(snapshotWith(bracketMatch({ id: 5, refereeKey: refereeKey(5, 9) })));

    expect(String(connection.query.mock.calls[0][0])).toContain("u.referee_objection_at IS NULL");
  });

  it("loadRefereeNames_query_excludesDeletedAccounts", async () => {
    rows();

    await loadRefereeNames(snapshotWith(bracketMatch({ id: 5, refereeKey: refereeKey(5, 9) })));

    expect(String(connection.query.mock.calls[0][0])).toContain("u.is_deleted = 0");
  });

  it("loadRefereeNames_cachesPerTournamentAndVersion", async () => {
    rows();

    await loadRefereeNames(snapshotWith(bracketMatch({ id: 5, refereeKey: refereeKey(5, 9) })));

    expect(jest.mocked(cached).mock.calls[0].slice(0, 2)).toEqual(["referee-names:7:v9", 5_000]);
    expect(connection.query.mock.calls[0][1]).toEqual([7]);
  });
});

describe("refereeKey — secret du processus", () => {
  it("refereeKey_moduleReevaluated_keepsSameKey", () => {
    const before = refereeKey(5, 9);
    let again: typeof import("@/lib/server/tournaments/referee-names") | undefined;
    jest.isolateModules(() => {
      again = jest.requireActual<typeof import("@/lib/server/tournaments/referee-names")>("@/lib/server/tournaments/referee-names");
    });

    expect(again?.refereeKey(5, 9)).toBe(before);
  });
});

describe("withoutRefereeKeys", () => {
  it("withoutRefereeKeys_matchesWithKeys_nullsEveryKeyKeepsOtherFields", () => {
    const keyed = bracketMatch({ id: 5, refereeKey: "k-arbitre", refereeAssigned: true });
    const unkeyed = bracketMatch({ id: 6, refereeKey: null });

    const actual = withoutRefereeKeys([keyed, unkeyed]);

    expect(actual).toEqual([{ ...keyed, refereeKey: null }, unkeyed]);
  });

  it("withoutRefereeKeys_noKeys_returnsSameArray", () => {
    const matches = [bracketMatch({ id: 5, refereeKey: null })];

    expect(withoutRefereeKeys(matches)).toBe(matches);
  });
});

describe("markViewerReferee", () => {
  it("markViewerReferee_viewerRefereesOneMatch_marksOnlyThatMatch", () => {
    const names = [
      { matchId: 5, refereeKey: refereeKey(5, 9), pseudo: "Arbitre" },
      { matchId: 6, refereeKey: refereeKey(6, 3), pseudo: "Autre" },
    ];

    expect(markViewerReferee(names, 9, [])).toEqual([
      { matchId: 5, refereeKey: refereeKey(5, 9), pseudo: "Arbitre", mine: true },
      { matchId: 6, refereeKey: refereeKey(6, 3), pseudo: "Autre" },
    ]);
  });

  it("markViewerReferee_viewerRefereeWithoutName_appendsEmptyMineEntry", () => {
    // Son pseudo n'est pas lisible (compte tu) : il se reconnaît quand même.
    const match = bracketMatch({ id: 5, status: "READY", refereeKey: refereeKey(5, 9) });

    expect(markViewerReferee([], 9, [match])).toEqual([{ matchId: 5, refereeKey: refereeKey(5, 9), pseudo: "", mine: true }]);
  });

  it("markViewerReferee_otherRefereesMatch_appendsNothing", () => {
    const names: { matchId: number; refereeKey: string; pseudo: string }[] = [];
    const match = bracketMatch({ id: 5, status: "READY", refereeKey: refereeKey(5, 3) });

    expect(markViewerReferee(names, 9, [match])).toBe(names);
  });

  it("markViewerReferee_viewerRefereesNothing_returnsSameList", () => {
    const names = [{ matchId: 5, refereeKey: refereeKey(5, 9), pseudo: "Arbitre" }];

    expect(markViewerReferee(names, 3, [])).toBe(names);
  });
});
