import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/planning/auto-assign", () => ({ lockedHolding: jest.fn() }));
jest.mock("@/lib/server/tournaments/cast-eligibility", () => ({ loadCastBlocks: jest.fn() }));
jest.mock("@/lib/server/tournaments/match-casters", () => ({ lockMatchCasters: jest.fn(), lockMatchStreams: jest.fn() }));
jest.mock("@/lib/server/tournaments/match-launch", () => ({ resolveTeamParty: jest.fn(), releasePlannedMatchCast: jest.fn() }));
jest.mock("@/lib/server/tournaments/match-prod", () => ({ releasePlannedProd: jest.fn() }));
jest.mock("@/lib/server/planning/notices", () => ({ announceCastLinkNeeded: jest.fn() }));
jest.mock("@/lib/server/tournaments/notifications", () => ({ publishMatchUpdatedEvent: jest.fn() }));
jest.mock("@/lib/server/tournaments/cast-notices", () => ({ announceCastChange: jest.fn() }));
jest.mock("@/lib/server/tournaments/prod-notices", () => ({ announceProdChange: jest.fn() }));
jest.mock("@/lib/server/staff-audit", () => ({ auditStaffAction: jest.fn() }));

import type { PoolConnection } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { lockedHolding, type HoldingCheck } from "@/lib/server/planning/auto-assign";
import {
  castFreeForPlanning,
  placementAuditLine,
  placementTargets,
  placePlannedCasts,
  releaseAuditLine,
  releasePlannedSeat,
  type PlannedCastLine,
} from "@/lib/server/planning/cast-placement";
import { announceCastLinkNeeded } from "@/lib/server/planning/notices";
import { auditStaffAction } from "@/lib/server/staff-audit";
import { loadCastBlocks } from "@/lib/server/tournaments/cast-eligibility";
import { announceCastChange } from "@/lib/server/tournaments/cast-notices";
import { lockMatchCasters, lockMatchStreams, type MatchCasterLink, type MatchStreamRow } from "@/lib/server/tournaments/match-casters";
import { releasePlannedMatchCast, resolveTeamParty } from "@/lib/server/tournaments/match-launch";
import { releasePlannedProd } from "@/lib/server/tournaments/match-prod";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { announceProdChange } from "@/lib/server/tournaments/prod-notices";
import type { CastBlock } from "@/lib/shared/match-launch";
import type { PlanningRole } from "@/lib/shared/planning";

import { loadedEntry } from "../../../helpers/planning";
import { connectionMock, fakeConnection } from "../../../helpers/sql-double";

/**
 * Placement du cast d'un match par le planning (`CAST_PLANNING.md` § Placement
 * sur le match) : base simulée, une transaction par match.
 */

const connection = connectionMock();
const { execute } = connection;
const ENTRY = loadedEntry({ key: "m:1", matchId: 1 });
const STAFF = { id: 9, pseudo: "Staff" };
const CASTER_A = 4;
const CASTER_B = 5;
const PROD = 6;
const PAIRING = { team1Id: 100, team2Id: 200 };

type MatchRowState = {
  status?: string;
  is_bye?: number;
  launched_at?: string | null;
  prod_user_id?: number | null;
  missing?: boolean;
};

type HeldRow = { user_id: number; role: "CASTER" | "PROD" };

const DEFAULT_HELD: HeldRow[] = [
  { user_id: CASTER_A, role: "CASTER" },
  { user_id: CASTER_B, role: "CASTER" },
  { user_id: PROD, role: "PROD" },
];

function matchRow(id: number, state: MatchRowState) {
  return {
    id,
    tournament_id: 10,
    status: state.status ?? "PENDING",
    is_bye: state.is_bye ?? 0,
    team1_id: 100,
    team2_id: 200,
    launched_at: state.launched_at ?? null,
    prod_user_id: state.prod_user_id ?? null,
  };
}

/** Base simulée : le match (`FOR UPDATE`), les lignes tenues, le jeu du tournoi, les écritures. */
function route(options: { match?: MatchRowState; held?: HeldRow[]; failMatchIds?: number[]; tournamentState?: string } = {}) {
  execute.mockImplementation(async (sql: string, params?: unknown) => {
    if (sql.includes("FROM bg_matches WHERE id = ?")) {
      const id = Number((params as number[])[0]);
      if (options.failMatchIds?.includes(id)) throw new Error("ER_LOCK_WAIT_TIMEOUT");
      return [options.match?.missing ? [] : [matchRow(id, options.match ?? {})]];
    }
    if (sql.includes("FROM bg_planning_assignments")) return [options.held ?? DEFAULT_HELD];
    if (sql.includes("SELECT game, state FROM bg_tournaments")) return [[{ game: "OW", state: options.tournamentState ?? "RUNNING" }]];
    if (sql.startsWith("INSERT INTO bg_match_streams")) return [{ affectedRows: 1, insertId: 77 }];
    return [{ affectedRows: 1 }];
  });
}

function caster(userId: number, streamId: number): MatchCasterLink {
  return { matchId: 1, userId, streamId, readyAt: null };
}

function stream(id: number, staff: boolean, liveUrl: string | null = staff ? "https://www.twitch.tv/bluegenjiesport" : null): MatchStreamRow {
  return { id, matchId: 1, liveUrl, staff };
}

function line(userId: number, role: PlanningRole, entry = ENTRY): PlannedCastLine {
  return { entry, userId, role };
}

/** Les écritures jouées sur le cast du match (début de l'instruction, paramètres). */
function castWrites(): { sql: string; params: unknown }[] {
  return execute.mock.calls
    .filter(([sql]) => /^(INSERT INTO bg_match_casters|INSERT INTO bg_match_streams|UPDATE bg_matches)/.test(sql))
    .map(([sql, params]) => ({ sql: sql.slice(0, 30), params }));
}

const allowed: HoldingCheck = () => null;

beforeEach(() => {
  jest.clearAllMocks();
  route();
  connection.beginTransaction.mockResolvedValue(undefined);
  connection.commit.mockResolvedValue(undefined);
  connection.rollback.mockResolvedValue(undefined);
  jest.mocked(withConnection).mockImplementation(<T>(run: (c: PoolConnection) => Promise<T>) => run(fakeConnection(connection)));
  jest.mocked(lockedHolding).mockResolvedValue(allowed);
  jest.mocked(lockMatchCasters).mockResolvedValue([]);
  jest.mocked(lockMatchStreams).mockResolvedValue([]);
  jest.mocked(resolveTeamParty).mockResolvedValue(null);
  jest.mocked(loadCastBlocks).mockImplementation(async (_executor, ids) => new Map(ids.map((id): [number, CastBlock | null] => [id, null])));
});

describe("placementTargets", () => {
  it("placementTargets_mixedLines_groupsCasterAndProdByMatch", () => {
    const other = loadedEntry({ key: "m:2", matchId: 2 });

    const targets = placementTargets([line(CASTER_A, "CASTER"), line(PROD, "PROD"), line(CASTER_B, "CASTER", other)]);

    expect([...targets.entries()].map(([matchId, target]) => [matchId, target.casterIds, target.prodIds])).toEqual([
      [1, [CASTER_A], [PROD]],
      [2, [CASTER_B], []],
    ]);
  });

  it("placementTargets_refereeOrTournamentEntry_ignored", () => {
    const tournament = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });

    const targets = placementTargets([line(CASTER_A, "REFEREE"), line(CASTER_B, "CASTER", tournament)]);

    expect(targets.size).toBe(0);
  });

  it("placementTargets_duplicateLine_keptOnce", () => {
    const targets = placementTargets([line(CASTER_A, "CASTER"), line(CASTER_A, "CASTER")]);

    expect(targets.get(1)?.casterIds).toEqual([CASTER_A]);
  });
});

describe("castFreeForPlanning", () => {
  const held = { casterIds: new Set([CASTER_A]), prodIds: new Set([PROD]) };

  it("castFreeForPlanning_emptyCast_true", () => {
    expect(castFreeForPlanning([], null, held)).toBe(true);
  });

  it("castFreeForPlanning_castersAndProdAllHeld_true", () => {
    expect(castFreeForPlanning([CASTER_A], PROD, held)).toBe(true);
  });

  it("castFreeForPlanning_selfSignedCaster_false", () => {
    expect(castFreeForPlanning([CASTER_B], null, held)).toBe(false);
  });

  it("castFreeForPlanning_prodPlacedOutsidePlanning_false", () => {
    expect(castFreeForPlanning([], CASTER_B, held)).toBe(false);
  });
});

describe("placementAuditLine", () => {
  it("placementAuditLine_castersAndProd_namesIdsOnly", () => {
    expect(placementAuditLine({ matchId: 1, casterIds: [4, 5], prodId: 6 })).toBe(
      "cast du match #1 posé depuis le planning : caster(s) #4, #5 ; prod #6",
    );
  });

  it("placementAuditLine_prodOnly_omitsCasters", () => {
    expect(placementAuditLine({ matchId: 1, casterIds: [], prodId: 6 })).toBe("cast du match #1 posé depuis le planning : prod #6");
  });
});

describe("releaseAuditLine", () => {
  it("releaseAuditLine_caster_namesIdsOnly", () => {
    expect(releaseAuditLine(1, 4, "CASTER")).toContain("#1");
    expect(releaseAuditLine(1, 4, "CASTER")).toContain("#4");
  });
});

describe("placePlannedCasts — marque et lien de diffusion", () => {
  it("placePlannedCasts_emptyCast_insertsCastersMarkedPlanned", async () => {
    await placePlannedCasts([line(CASTER_A, "CASTER")], STAFF);

    const insert = execute.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO bg_match_casters"));
    expect(insert?.[0]).toBe("INSERT INTO bg_match_casters (match_id, user_id, stream_id, ready_at, planned) VALUES (?, ?, ?, NULL, 1)");
  });

  it("placePlannedCasts_newStreamWithoutLink_announcesLinkNeeded", async () => {
    await placePlannedCasts([line(CASTER_A, "CASTER")], STAFF);

    expect(announceCastLinkNeeded).toHaveBeenCalledWith([CASTER_A], ENTRY);
  });

  it("placePlannedCasts_staffStreamWithLink_noLinkNotice", async () => {
    jest.mocked(lockMatchStreams).mockResolvedValue([stream(31, true)]);

    const placed = await placePlannedCasts([line(CASTER_A, "CASTER")], STAFF);

    expect(placed).toEqual([{ matchId: 1, casterIds: [CASTER_A], prodId: null, linkNeeded: false }]);
    expect(announceCastLinkNeeded).not.toHaveBeenCalled();
  });

  it("placePlannedCasts_staffStreamWithoutLink_linkNeeded", async () => {
    jest.mocked(lockMatchStreams).mockResolvedValue([stream(31, true, null)]);

    const placed = await placePlannedCasts([line(CASTER_A, "CASTER")], STAFF);

    expect(placed[0]?.linkNeeded).toBe(true);
  });

  it("placePlannedCasts_sharedStreamWithLink_noLinkNotice", async () => {
    jest.mocked(lockMatchCasters).mockResolvedValue([caster(CASTER_A, 40)]);
    jest.mocked(lockMatchStreams).mockResolvedValue([stream(40, false, "https://www.twitch.tv/test_caster")]);

    const placed = await placePlannedCasts([line(CASTER_A, "CASTER"), line(CASTER_B, "CASTER")], STAFF);

    expect(placed).toEqual([{ matchId: 1, casterIds: [CASTER_B], prodId: null, linkNeeded: false }]);
    expect(announceCastLinkNeeded).not.toHaveBeenCalled();
  });

  it("placePlannedCasts_prodOnly_noLinkNotice", async () => {
    await placePlannedCasts([line(PROD, "PROD")], STAFF);

    expect(announceCastLinkNeeded).not.toHaveBeenCalled();
  });

  it("placePlannedCasts_tournamentNotRunning_prodNotPlacedCastersPlaced", async () => {
    route({ tournamentState: "REGISTRATION" });

    const placed = await placePlannedCasts([line(CASTER_A, "CASTER"), line(PROD, "PROD")], STAFF);

    expect(placed).toEqual([{ matchId: 1, casterIds: [CASTER_A], prodId: null, linkNeeded: true }]);
    expect(castWrites().some((write) => write.sql.startsWith("UPDATE bg_matches"))).toBe(false);
    expect(announceProdChange).not.toHaveBeenCalled();
  });
});

describe("releasePlannedSeat", () => {
  beforeEach(() => {
    jest.mocked(releasePlannedMatchCast).mockResolvedValue(true);
    jest.mocked(releasePlannedProd).mockResolvedValue(true);
  });

  it("releasePlannedSeat_casterByMember_releasesWithoutStaffAndNoAudit", async () => {
    const released = await releasePlannedSeat(ENTRY, CASTER_A, "CASTER", null);

    expect(released).toBe(true);
    expect(releasePlannedMatchCast).toHaveBeenCalledWith(1, CASTER_A, false);
    expect(auditStaffAction).not.toHaveBeenCalled();
  });

  it("releasePlannedSeat_prodByStaff_releasesByStaffAndAudits", async () => {
    const released = await releasePlannedSeat(ENTRY, PROD, "PROD", STAFF);

    expect(released).toBe(true);
    expect(releasePlannedProd).toHaveBeenCalledWith(1, PROD, true);
    expect(auditStaffAction).toHaveBeenCalledWith(releaseAuditLine(1, PROD, "PROD"), STAFF);
  });

  it("releasePlannedSeat_nothingReleased_noAudit", async () => {
    jest.mocked(releasePlannedMatchCast).mockResolvedValue(false);

    const released = await releasePlannedSeat(ENTRY, CASTER_A, "CASTER", STAFF);

    expect(released).toBe(false);
    expect(auditStaffAction).not.toHaveBeenCalled();
  });

  it("releasePlannedSeat_refereeRole_nothingCalled", async () => {
    expect(await releasePlannedSeat(ENTRY, CASTER_A, "REFEREE", STAFF)).toBe(false);
    expect(releasePlannedMatchCast).not.toHaveBeenCalled();
    expect(releasePlannedProd).not.toHaveBeenCalled();
  });

  it("releasePlannedSeat_tournamentEntry_nothingCalled", async () => {
    const tournament = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });

    expect(await releasePlannedSeat(tournament, CASTER_A, "CASTER", null)).toBe(false);
    expect(releasePlannedMatchCast).not.toHaveBeenCalled();
  });

  it("releasePlannedSeat_releaseThrows_logsAndReturnsFalse", async () => {
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(releasePlannedProd).mockRejectedValue(new Error("ER_LOCK_WAIT_TIMEOUT"));

    const released = await releasePlannedSeat(ENTRY, PROD, "PROD", STAFF);

    expect(released).toBe(false);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("place du match #1 non rendue"));
    errorLog.mockRestore();
  });
});

describe("placePlannedCasts", () => {
  it("placePlannedCasts_emptyCast_placesCastersOnNewStreamAndProd", async () => {
    const placed = await placePlannedCasts([line(CASTER_A, "CASTER"), line(CASTER_B, "CASTER"), line(PROD, "PROD")], STAFF);

    expect(placed).toEqual([{ matchId: 1, casterIds: [CASTER_A, CASTER_B], prodId: PROD, linkNeeded: true }]);
    expect(castWrites()).toEqual([
      { sql: "UPDATE bg_matches SET prod_use", params: [PROD, 1] },
      { sql: "INSERT INTO bg_match_streams (", params: [1] },
      { sql: "INSERT INTO bg_match_casters (", params: [1, CASTER_A, 77] },
      { sql: "INSERT INTO bg_match_casters (", params: [1, CASTER_B, 77] },
    ]);
  });

  it("placePlannedCasts_staffStreamExists_castersJoinIt", async () => {
    jest.mocked(lockMatchStreams).mockResolvedValue([stream(31, true)]);

    await placePlannedCasts([line(CASTER_A, "CASTER")], STAFF);

    expect(castWrites()).toEqual([{ sql: "INSERT INTO bg_match_casters (", params: [1, CASTER_A, 31] }]);
  });

  it("placePlannedCasts_plannedCasterAlreadyOnMatch_addsSecondOnSameStream", async () => {
    jest.mocked(lockMatchCasters).mockResolvedValue([caster(CASTER_A, 40)]);
    jest.mocked(lockMatchStreams).mockResolvedValue([stream(31, true), stream(40, false)]);

    const placed = await placePlannedCasts([line(CASTER_A, "CASTER"), line(CASTER_B, "CASTER")], STAFF);

    expect(placed).toEqual([{ matchId: 1, casterIds: [CASTER_B], prodId: null, linkNeeded: true }]);
    expect(castWrites()).toEqual([{ sql: "INSERT INTO bg_match_casters (", params: [1, CASTER_B, 40] }]);
  });

  it("placePlannedCasts_selfSignedCaster_placesNothing", async () => {
    jest.mocked(lockMatchCasters).mockResolvedValue([caster(42, 40)]);

    const placed = await placePlannedCasts([line(CASTER_A, "CASTER"), line(PROD, "PROD")], STAFF);

    expect(placed).toEqual([]);
    expect(castWrites()).toEqual([]);
  });

  it("placePlannedCasts_prodSetByStaff_placesNothing", async () => {
    route({ match: { prod_user_id: 42 } });

    const placed = await placePlannedCasts([line(CASTER_A, "CASTER")], STAFF);

    expect(placed).toEqual([]);
    expect(castWrites()).toEqual([]);
  });

  it("placePlannedCasts_matchCompleted_placesNothing", async () => {
    route({ match: { status: "COMPLETED" } });

    expect(await placePlannedCasts([line(CASTER_A, "CASTER")], STAFF)).toEqual([]);
    expect(castWrites()).toEqual([]);
  });

  it("placePlannedCasts_matchIsBye_placesNothing", async () => {
    route({ match: { is_bye: 1 } });

    expect(await placePlannedCasts([line(CASTER_A, "CASTER")], STAFF)).toEqual([]);
    expect(castWrites()).toEqual([]);
  });

  it("placePlannedCasts_matchLaunched_placesNothing", async () => {
    route({ match: { launched_at: "2026-11-23 20:00:00" } });

    expect(await placePlannedCasts([line(CASTER_A, "CASTER")], STAFF)).toEqual([]);
    expect(castWrites()).toEqual([]);
  });

  it("placePlannedCasts_matchMissing_placesNothing", async () => {
    route({ match: { missing: true } });

    expect(await placePlannedCasts([line(CASTER_A, "CASTER")], STAFF)).toEqual([]);
    expect(castWrites()).toEqual([]);
  });

  it("placePlannedCasts_lineNoLongerHeld_notPlaced", async () => {
    route({ held: [{ user_id: PROD, role: "PROD" }] });

    const placed = await placePlannedCasts([line(CASTER_A, "CASTER"), line(PROD, "PROD")], STAFF);

    expect(placed).toEqual([{ matchId: 1, casterIds: [], prodId: PROD, linkNeeded: false }]);
  });

  it("placePlannedCasts_memberCannotHold_notPlaced", async () => {
    jest.mocked(lockedHolding).mockResolvedValue((userId) => (userId === CASTER_A ? "PLANNING_ROLE_NOT_HELD" : null));

    const placed = await placePlannedCasts([line(CASTER_A, "CASTER"), line(CASTER_B, "CASTER")], STAFF);

    expect(placed).toEqual([{ matchId: 1, casterIds: [CASTER_B], prodId: null, linkNeeded: true }]);
  });

  it("placePlannedCasts_casterCastBlocked_notPlaced", async () => {
    jest.mocked(loadCastBlocks).mockResolvedValue(
      new Map<number, CastBlock | null>([
        [CASTER_A, "CASTER_DISCORD_REQUIRED"],
        [CASTER_B, null],
      ]),
    );

    const placed = await placePlannedCasts([line(CASTER_A, "CASTER"), line(CASTER_B, "CASTER")], STAFF);

    expect(placed).toEqual([{ matchId: 1, casterIds: [CASTER_B], prodId: null, linkNeeded: true }]);
  });

  it("placePlannedCasts_casterPlaysMatch_notPlaced", async () => {
    jest.mocked(resolveTeamParty).mockImplementation(async (_connection, _match, userId) =>
      userId === CASTER_A ? { role: "TEAM1", canDeclareReady: true } : null,
    );

    const placed = await placePlannedCasts([line(CASTER_A, "CASTER"), line(PROD, "PROD")], STAFF);

    expect(placed).toEqual([{ matchId: 1, casterIds: [], prodId: PROD, linkNeeded: false }]);
  });

  it("placePlannedCasts_prodPlaysMatch_notPlaced", async () => {
    jest.mocked(resolveTeamParty).mockImplementation(async (_connection, _match, userId) =>
      userId === PROD ? { role: "TEAM2", canDeclareReady: true } : null,
    );

    const placed = await placePlannedCasts([line(CASTER_A, "CASTER"), line(PROD, "PROD")], STAFF);

    expect(placed).toEqual([{ matchId: 1, casterIds: [CASTER_A], prodId: null, linkNeeded: true }]);
  });

  it("placePlannedCasts_noneEligible_placesNothingAndPublishesNothing", async () => {
    jest.mocked(lockedHolding).mockResolvedValue(() => "PLANNING_ROLE_NOT_HELD");

    const placed = await placePlannedCasts([line(CASTER_A, "CASTER"), line(PROD, "PROD")], STAFF);

    expect(placed).toEqual([]);
    expect(castWrites()).toEqual([]);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("placePlannedCasts_twoProdLines_onlyLowestIdPlaced", async () => {
    route({ held: [{ user_id: PROD, role: "PROD" }, { user_id: 7, role: "PROD" }] });

    const placed = await placePlannedCasts([line(7, "PROD"), line(PROD, "PROD")], STAFF);

    expect(placed).toEqual([{ matchId: 1, casterIds: [], prodId: PROD, linkNeeded: false }]);
  });

  it("placePlannedCasts_placed_announcesAnonymousLogsProdNoticeAndAudit", async () => {
    await placePlannedCasts([line(CASTER_A, "CASTER"), line(PROD, "PROD")], STAFF);

    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(10, { landingLive: true });
    expect(announceCastChange).toHaveBeenCalledWith({ kind: "PLANNED", matchId: 1, casterId: CASTER_A, pairing: PAIRING });
    expect(announceProdChange).toHaveBeenCalledWith({
      matchId: 1,
      log: "PLANNED",
      notices: [{ userId: PROD, kind: "PLANNED" }],
      pairing: PAIRING,
    });
    expect(auditStaffAction).toHaveBeenCalledWith("cast du match #1 posé depuis le planning : caster(s) #4 ; prod #6", STAFF);
  });

  it("placePlannedCasts_actorIsTheProd_noProdNotice", async () => {
    route({ held: [{ user_id: STAFF.id, role: "PROD" }] });

    await placePlannedCasts([line(STAFF.id, "PROD")], STAFF);

    expect(announceProdChange).toHaveBeenCalledWith(expect.objectContaining({ notices: [] }));
  });

  it("placePlannedCasts_autoConfirmWithoutActor_noAudit", async () => {
    await placePlannedCasts([line(CASTER_A, "CASTER")], null);

    expect(announceCastChange).toHaveBeenCalledTimes(1);
    expect(auditStaffAction).not.toHaveBeenCalled();
  });

  it("placePlannedCasts_transactionFails_logsAndContinuesWithNextMatch", async () => {
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
    route({ failMatchIds: [1] });
    const other = loadedEntry({ key: "m:2", matchId: 2 });

    const placed = await placePlannedCasts([line(CASTER_A, "CASTER"), line(CASTER_A, "CASTER", other)], STAFF);

    expect(placed).toEqual([{ matchId: 2, casterIds: [CASTER_A], prodId: null, linkNeeded: true }]);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("cast du match #1 non placé"));
    errorLog.mockRestore();
  });
});
