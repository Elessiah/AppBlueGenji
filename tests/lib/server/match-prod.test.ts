import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/notify");
jest.mock("@/lib/server/coalescer");
jest.mock("@/lib/server/tournaments/transaction");
jest.mock("@/lib/server/tournaments/match-launch");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/match-players");
jest.mock("@/lib/server/tournaments/match-log-subject", () => ({
  ...jest.requireActual<typeof import("@/lib/server/tournaments/match-log-subject")>(
    "@/lib/server/tournaments/match-log-subject",
  ),
  loadMatchLogRow: jest.fn(),
}));
jest.mock("@/lib/server/suspension-sql", () => ({
  ...jest.requireActual<typeof import("@/lib/server/suspension-sql")>("@/lib/server/suspension-sql"),
  lockedSuspendedUserIds: jest.fn(),
}));

import { sendBotLog } from "@/lib/server/bot-integration";
import { trackAnnouncement } from "@/lib/server/coalescer";
import { withConnection } from "@/lib/server/database";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { lockedSuspendedUserIds } from "@/lib/server/suspension-sql";
import { assertMatchTournamentOpen, releaseUnfitProd, resolveTeamParty } from "@/lib/server/tournaments/match-launch";
import { loadMatchLogRow, type MatchLogRow } from "@/lib/server/tournaments/match-log-subject";
import { loadMatchPlayerIds } from "@/lib/server/tournaments/match-players";
import {
  announceProdWithdrawals,
  assignMatchProd,
  claimMatchProd,
  formatProdNotice,
  loadProdPanel,
  prodLogCategory,
  releaseMatchProd,
  releasePlannedProd,
  staffProdAuditLine,
  withdrawLostProdPlaces,
} from "@/lib/server/tournaments/match-prod";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { discardProdChanges, flushProdChanges, queueProdChange } from "@/lib/server/tournaments/prod-notices";
import { inTransaction } from "@/lib/server/tournaments/transaction";
import type { ProdNoticeMatch } from "@/lib/shared/match-prod";
import { authUser } from "../../helpers/auth-user";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/**
 * La prod d'un match (`lib/server/tournaments/match-prod.ts`,
 * `docs/features/MATCH_PROD.md`) : se placer, se retirer, placement par le
 * staff, places rendues à la perte du rôle, fenêtre du staff, avis.
 */

const PROD_ID = 5;
const OTHER_PROD_ID = 6;
const STAFF_ID = 1;
const STAFF = { id: STAFF_ID, pseudo: "Test_Staff" };

type Account = { is_deleted: number; holds_prod: number };

let match: Record<string, unknown> | null;
let accounts: Map<number, Account>;
let casterIds: number[];
let plannedCasterIds: number[];
let plannedOtherProd: boolean;
/** Comptes suspendus parmi ceux qui tiennent une ligne PROD au planning (lecture ordinaire). */
let suspendedHolders: number[];
let execute: jest.Mock<SqlQuery>;
let announcements: Promise<void>[];

/** Lignes du planning relues par la prise de place (prod d'un autre, caster tenu) ; `null` pour le reste. */
function readPlannedRows(sql: string, values: unknown[]): [unknown[], []] | null {
  if (sql.includes("role = 'PROD' AND user_id <> ?")) return [plannedOtherProd ? [{ user_id: OTHER_PROD_ID }] : [], []];
  if (sql.startsWith("SELECT u.id FROM bg_users u") && sql.includes("u.id IN (")) {
    // Le titulaire de la ligne PROD peut-il encore faire la prod ?
    const fit = values.map(Number).filter((id) => {
      const account = accounts.get(id);
      return account?.is_deleted === 0 && account.holds_prod === 1 && !suspendedHolders.includes(id);
    });
    return [fit.slice(0, 1).map((id) => ({ id })), []];
  }
  if (sql.includes("FROM bg_planning_assignments") && sql.includes("role = 'CASTER'")) {
    return [plannedCasterIds.includes(Number(values[1])) ? [{ 1: 1 }] : [], []];
  }
  return null;
}

function updatesOfProd() {
  return execute.mock.calls.filter(([sql]) => sql.startsWith("UPDATE bg_matches SET prod_user_id"));
}

const LOG_ROW = {
  id: 42,
  bracket: "UPPER",
  round_number: 2,
  swiss_round: null,
  team1_name: "Alpha",
  team2_name: "Beta",
  team1_id: 10,
  team2_id: 11,
  tournament_id: 7,
  tournament_name: "Coupe",
  participant_type: "TEAM",
} as MatchLogRow;

beforeEach(() => {
  jest.clearAllMocks();
  match = {
    id: 42,
    tournament_id: 7,
    status: "READY",
    is_bye: 0,
    team1_id: 10,
    team2_id: 11,
    prod_user_id: null,
  };
  accounts = new Map([
    [PROD_ID, { is_deleted: 0, holds_prod: 1 }],
    [OTHER_PROD_ID, { is_deleted: 0, holds_prod: 1 }],
  ]);
  casterIds = [];
  plannedCasterIds = [];
  plannedOtherProd = false;
  suspendedHolders = [];
  announcements = [];
  execute = jest.fn<SqlQuery>(async (sql, params) => {
    const values = params as unknown[];
    const planned = readPlannedRows(sql, values);
    if (planned) return planned;
    if (sql.includes("FROM bg_users u WHERE u.id = ?") && sql.includes("LOCK IN SHARE MODE")) {
      const account = accounts.get(Number(values[0]));
      return [account ? [account] : [], []];
    }
    if (sql.includes("FROM bg_matches WHERE id = ? LIMIT 1 FOR UPDATE")) return [match ? [match] : [], []];
    if (sql.includes("FROM bg_match_casters WHERE match_id = ? AND user_id = ?")) {
      return [casterIds.includes(Number(values[1])) ? [{ 1: 1 }] : [], []];
    }
    if (sql.startsWith("UPDATE bg_matches SET prod_user_id")) return [{ affectedRows: 1 }, []];
    if (sql.startsWith("UPDATE bg_matches SET prod_planned = 0")) return [{ affectedRows: 1 }, []];
    throw new Error(`requête inattendue : ${sql}`);
  });
  jest.mocked(inTransaction).mockImplementation((run) => run(fakeConnection({ execute })));
  jest.mocked(resolveTeamParty).mockResolvedValue(null);
  jest.mocked(lockedSuspendedUserIds).mockResolvedValue(new Set());
  jest.mocked(trackAnnouncement).mockImplementation((announcement) => {
    announcements.push(announcement);
    return announcement;
  });
  jest.mocked(loadMatchLogRow).mockResolvedValue(LOG_ROW);
  jest.mocked(loadNotificationRecipients).mockImplementation(async (ids) =>
    ids.map((userId) => ({ userId, discord: null, locale: "fr" as const })),
  );
});

async function settle() {
  await Promise.all(announcements);
}

const prodActor = authUser({ id: PROD_ID, roles: ["PROD"] });

describe("claimMatchProd", () => {
  it("claimMatchProd_freePlace_writesProdAndAnnouncesClaimed", async () => {
    await claimMatchProd(42, prodActor);
    await settle();

    expect(updatesOfProd()).toEqual([[expect.any(String), [PROD_ID, 42]]]);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { landingLive: true });
    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("claimMatchProd_accountWithoutProd_throwsNotProd", async () => {
    accounts.set(PROD_ID, { is_deleted: 0, holds_prod: 0 });

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("NOT_PROD");
    expect(updatesOfProd()).toHaveLength(0);
  });

  it("claimMatchProd_deletedAccount_throwsNotProd", async () => {
    accounts.set(PROD_ID, { is_deleted: 1, holds_prod: 1 });

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("NOT_PROD");
  });

  it("claimMatchProd_alreadyOwnPlace_noWriteNoAnnouncement", async () => {
    match = { ...match, prod_user_id: PROD_ID };

    await claimMatchProd(42, prodActor);

    expect(updatesOfProd()).toHaveLength(0);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
    expect(trackAnnouncement).not.toHaveBeenCalled();
  });

  it("claimMatchProd_ownPlannedPlace_clearsPlannedMarkOnly", async () => {
    match = { ...match, prod_user_id: PROD_ID, prod_planned: 1 };

    await claimMatchProd(42, prodActor);

    expect(execute.mock.calls.filter(([sql]) => sql.startsWith("UPDATE bg_matches SET prod_planned = 0"))).toEqual([
      [expect.any(String), [42]],
    ]);
    expect(updatesOfProd()).toHaveLength(0);
    expect(trackAnnouncement).not.toHaveBeenCalled();
  });

  it("claimMatchProd_ownPlaceNotPlanned_noMarkWrite", async () => {
    match = { ...match, prod_user_id: PROD_ID, prod_planned: 0 };

    await claimMatchProd(42, prodActor);

    expect(execute.mock.calls.filter(([sql]) => sql.startsWith("UPDATE bg_matches SET prod_planned"))).toHaveLength(0);
  });

  it("claimMatchProd_takenByOther_throwsMatchProdTaken", async () => {
    match = { ...match, prod_user_id: OTHER_PROD_ID };

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("MATCH_PROD_TAKEN");
  });

  it("claimMatchProd_missingMatch_throwsMatchNotFound", async () => {
    match = null;

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("MATCH_NOT_FOUND");
  });

  it("claimMatchProd_completedMatch_throwsMatchAlreadyCompleted", async () => {
    match = { ...match, status: "COMPLETED" };

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("MATCH_ALREADY_COMPLETED");
  });

  it("claimMatchProd_byeMatch_throwsMatchNotLaunchable", async () => {
    match = { ...match, is_bye: 1 };

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("MATCH_NOT_LAUNCHABLE");
  });

  it("claimMatchProd_claimerIsCaster_throwsProdIsCaster", async () => {
    casterIds = [PROD_ID];

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("PROD_IS_CASTER");
    expect(updatesOfProd()).toHaveLength(0);
  });

  it("claimMatchProd_claimerPlays_throwsProdIsPlayer", async () => {
    jest.mocked(resolveTeamParty).mockResolvedValue({ role: "TEAM1", canDeclareReady: true });

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("PROD_IS_PLAYER");
  });

  it("claimMatchProd_suspendedAccount_throwsProdSuspended", async () => {
    jest.mocked(lockedSuspendedUserIds).mockResolvedValue(new Set([PROD_ID]));

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("PROD_SUSPENDED");
    expect(updatesOfProd()).toHaveLength(0);
  });

  it("claimMatchProd_heldPlanningProdOfOther_throwsMatchProdTaken", async () => {
    plannedOtherProd = true;

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("MATCH_PROD_TAKEN");
    expect(updatesOfProd()).toHaveLength(0);
    // Lecture courante et verrouillée : une confirmation concurrente du planning est attendue.
    const prodQuery = execute.mock.calls.find(([sql]) => sql.includes("role = 'PROD' AND user_id <> ?"));
    expect(prodQuery?.[0]).toContain("LOCK IN SHARE MODE");
    expect(prodQuery?.[0]).toContain("(source = 'MANUAL' OR confirmed = 1)");
  });

  it("claimMatchProd_heldPlanningProdOfSuspendedAccount_writesClaimant", async () => {
    plannedOtherProd = true;
    suspendedHolders = [OTHER_PROD_ID];

    await claimMatchProd(42, prodActor);

    expect(updatesOfProd()).toEqual([[expect.any(String), [PROD_ID, 42]]]);
  });

  it("claimMatchProd_heldPlanningProdOfAccountWithoutRole_writesClaimant", async () => {
    plannedOtherProd = true;
    accounts.set(OTHER_PROD_ID, { is_deleted: 0, holds_prod: 0 });

    await claimMatchProd(42, prodActor);

    expect(updatesOfProd()).toEqual([[expect.any(String), [PROD_ID, 42]]]);
  });

  it("claimMatchProd_heldPlanningProdOfDeletedAccount_writesClaimant", async () => {
    plannedOtherProd = true;
    accounts.set(OTHER_PROD_ID, { is_deleted: 1, holds_prod: 1 });

    await claimMatchProd(42, prodActor);

    expect(updatesOfProd()).toEqual([[expect.any(String), [PROD_ID, 42]]]);
  });

  it("claimMatchProd_heldPlanningProdOfFitAccount_holderReadWithoutLock", async () => {
    plannedOtherProd = true;

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("MATCH_PROD_TAKEN");
    // Le compte de l'autre prod, lu après le verrou du match : sans verrou (ordre compte → matchs).
    const holderQuery = execute.mock.calls.find(([sql]) => sql.startsWith("SELECT u.id FROM bg_users u"));
    expect(holderQuery?.[1]).toEqual([OTHER_PROD_ID]);
    expect(holderQuery?.[0]).not.toMatch(/LOCK IN SHARE MODE|FOR UPDATE/);
  });

  it("claimMatchProd_heldPlanningCaster_throwsProdIsCaster", async () => {
    plannedCasterIds = [PROD_ID];

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("PROD_IS_CASTER");
    expect(updatesOfProd()).toHaveLength(0);
    const plannedQuery = execute.mock.calls.find(
      ([sql]) => sql.includes("FROM bg_planning_assignments") && sql.includes("role = 'CASTER'"),
    );
    expect(plannedQuery?.[0]).toContain("LOCK IN SHARE MODE");
    expect(plannedQuery?.[0]).toContain("(source = 'MANUAL' OR confirmed = 1)");
  });

  it("claimMatchProd_playerView_throwsPlayerViewActive", async () => {
    const impersonating = authUser({ id: PROD_ID, isAdmin: true, playerView: true, roles: [] });

    await expect(claimMatchProd(42, impersonating)).rejects.toThrow("PLAYER_VIEW_ACTIVE");
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("releaseMatchProd", () => {
  it("releaseMatchProd_ownPlace_resetsPlannedMarker", async () => {
    match = { ...match, prod_user_id: PROD_ID, prod_planned: 1 };

    await releaseMatchProd(42, prodActor);

    expect(updatesOfProd()[0]?.[0]).toContain("prod_planned = 0");
  });

  it("releaseMatchProd_ownPlace_clearsProd", async () => {
    match = { ...match, prod_user_id: PROD_ID };

    await releaseMatchProd(42, prodActor);
    await settle();

    expect(updatesOfProd()).toEqual([[expect.any(String), [null, 42]]]);
    expect(sendBotLog).toHaveBeenCalledWith(expect.any(String), { tournamentId: 7, category: "staff-removal" });
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("releaseMatchProd_completedMatch_throwsMatchAlreadyCompleted", async () => {
    match = { ...match, prod_user_id: PROD_ID, status: "COMPLETED" };

    await expect(releaseMatchProd(42, prodActor)).rejects.toThrow("MATCH_ALREADY_COMPLETED");
    expect(updatesOfProd()).toHaveLength(0);
  });

  it("releaseMatchProd_notOwnPlace_throwsNotMatchProd", async () => {
    match = { ...match, prod_user_id: OTHER_PROD_ID };

    await expect(releaseMatchProd(42, prodActor)).rejects.toThrow("NOT_MATCH_PROD");
    expect(updatesOfProd()).toHaveLength(0);
  });
});

describe("releasePlannedProd", () => {
  it("releasePlannedProd_memberHolds_clearedWithoutNotice", async () => {
    match = { ...match, prod_user_id: PROD_ID, prod_planned: 1 };

    const released = await releasePlannedProd(42, PROD_ID, false);
    await settle();

    expect(released).toBe(true);
    expect(updatesOfProd()).toEqual([[expect.any(String), [null, 42]]]);
    expect(sendBotLog).toHaveBeenCalledWith(expect.stringContaining("Prod retirée"), { tournamentId: 7, category: "staff-removal" });
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("releasePlannedProd_plannedProd_clearedAndMarkerReset", async () => {
    match = { ...match, prod_user_id: PROD_ID, prod_planned: 1 };

    await releasePlannedProd(42, PROD_ID, false);

    expect(updatesOfProd()[0]?.[0]).toContain("prod_planned = 0");
  });

  it("releasePlannedProd_prodTakenOutsidePlanning_kept", async () => {
    match = { ...match, prod_user_id: PROD_ID, prod_planned: 0 };

    const released = await releasePlannedProd(42, PROD_ID, false);
    await settle();

    expect(released).toBe(false);
    expect(updatesOfProd()).toHaveLength(0);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("releasePlannedProd_byStaff_prodNotified", async () => {
    match = { ...match, prod_user_id: PROD_ID, prod_planned: 1 };

    await releasePlannedProd(42, PROD_ID, true);
    await settle();

    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(jest.mocked(notifyUsers).mock.calls[0][0]).toEqual([expect.objectContaining({ userId: PROD_ID })]);
  });

  it("releasePlannedProd_otherProd_untouched", async () => {
    match = { ...match, prod_user_id: OTHER_PROD_ID, prod_planned: 1 };

    const released = await releasePlannedProd(42, PROD_ID, false);

    expect(released).toBe(false);
    expect(updatesOfProd()).toHaveLength(0);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("releasePlannedProd_matchCompleted_kept", async () => {
    match = { ...match, prod_user_id: PROD_ID, prod_planned: 1, status: "COMPLETED" };

    expect(await releasePlannedProd(42, PROD_ID, false)).toBe(false);
    expect(updatesOfProd()).toHaveLength(0);
  });

  it("releasePlannedProd_matchMissing_false", async () => {
    match = null;

    expect(await releasePlannedProd(42, PROD_ID, false)).toBe(false);
  });
});

describe("claimMatchProd — tournoi ouvert", () => {
  it("claimMatchProd_checksTournamentOpenAndRunning", async () => {
    await claimMatchProd(42, prodActor);

    expect(assertMatchTournamentOpen).toHaveBeenCalledWith(expect.anything(), 7, false, true);
  });

  it("claimMatchProd_managerFlag_isForwarded", async () => {
    await claimMatchProd(42, prodActor, true);

    expect(assertMatchTournamentOpen).toHaveBeenCalledWith(expect.anything(), 7, true, true);
  });

  it("claimMatchProd_tournamentClosed_writesNothing", async () => {
    jest.mocked(assertMatchTournamentOpen).mockRejectedValueOnce(new Error("MATCH_NOT_FOUND"));

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("MATCH_NOT_FOUND");
    expect(updatesOfProd()).toHaveLength(0);
    expect(trackAnnouncement).not.toHaveBeenCalled();
  });
});

describe("claimMatchProd — publication avant tout refus du match", () => {
  it("claimMatchProd_unpublishedCompletedMatch_throwsMatchNotFound", async () => {
    match = { ...match, status: "COMPLETED" };
    jest.mocked(assertMatchTournamentOpen).mockRejectedValueOnce(new Error("MATCH_NOT_FOUND"));

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("MATCH_NOT_FOUND");
  });

  it("claimMatchProd_unpublishedByeMatch_throwsMatchNotFound", async () => {
    match = { ...match, is_bye: 1 };
    jest.mocked(assertMatchTournamentOpen).mockRejectedValueOnce(new Error("MATCH_NOT_FOUND"));

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("MATCH_NOT_FOUND");
  });
});

describe("claimMatchProd — prod tue qui tenait la place", () => {
  it("claimMatchProd_unfitHolderReleased_writesClaimant", async () => {
    match = { ...match, prod_user_id: OTHER_PROD_ID };
    jest.mocked(releaseUnfitProd).mockImplementationOnce(async (_connection, row) => {
      row.prod_user_id = null;
      return true;
    });

    await claimMatchProd(42, prodActor);

    expect(updatesOfProd()).toEqual([[expect.any(String), [PROD_ID, 42]]]);
    // Lecture ordinaire du compte de l'autre prod : aucun verrou pris après le match.
    expect(releaseUnfitProd).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 42 }), false);
  });

  it("claimMatchProd_fitHolderKept_throwsMatchProdTaken", async () => {
    match = { ...match, prod_user_id: OTHER_PROD_ID };
    jest.mocked(releaseUnfitProd).mockResolvedValueOnce(false);

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("MATCH_PROD_TAKEN");
    expect(updatesOfProd()).toHaveLength(0);
  });

  it("claimMatchProd_ownPlace_doesNotJudgeItself", async () => {
    match = { ...match, prod_user_id: PROD_ID };

    await claimMatchProd(42, prodActor);

    expect(releaseUnfitProd).not.toHaveBeenCalled();
  });
});

describe("announceProdWithdrawals — suspension", () => {
  it("announceProdWithdrawals_unavailable_logsAndNoticesWithoutReason", async () => {
    announceProdWithdrawals(PROD_ID, [{ matchId: 42, tournamentId: 7, pairing: { team1Id: 10, team2Id: 11 } }], "UNAVAILABLE");
    await settle();

    expect(jest.mocked(sendBotLog).mock.calls[0][0]).toContain("la prod ne remplit plus les conditions");
    const message = jest.mocked(notifyUsers).mock.calls[0][1].discord?.message("fr");
    expect(message).toContain("Ton compte ne peut plus faire la prod pour le moment");
    expect(message).not.toContain("suspendu");
  });
});

describe("assignMatchProd — audit du staff", () => {
  it("assignMatchProd_assigned_auditsStaffInServerLog", async () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);

    await assignMatchProd(42, STAFF, PROD_ID, null);

    expect(info).toHaveBeenCalledWith(
      "[staff-audit] compte #5 placé comme prod du match #42 — auteur : Test_Staff (#1)",
    );
    info.mockRestore();
  });

  it("assignMatchProd_noChange_writesNoAudit", async () => {
    match = { ...match, prod_user_id: PROD_ID };
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);

    await assignMatchProd(42, STAFF, PROD_ID, PROD_ID);

    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("staffProdAuditLine_released_namesTheFormerAccount", () => {
    expect(staffProdAuditLine(42, "RELEASED_BY_STAFF", 5, null)).toBe("place de prod du match #42 retirée au compte #5");
  });

  it("staffProdAuditLine_replaced_namesBothAccounts", () => {
    expect(staffProdAuditLine(42, "REPLACED", 6, 5)).toBe("prod du match #42 changée : compte #6 → compte #5");
  });
});

describe("assignMatchProd", () => {
  it("assignMatchProd_emptyPlace_assignsAndNotifiesAssigned", async () => {
    await assignMatchProd(42, STAFF, PROD_ID, null);
    await settle();

    expect(updatesOfProd()).toEqual([[expect.any(String), [PROD_ID, 42]]]);
    expect(sendBotLog).toHaveBeenCalledWith(expect.any(String), { tournamentId: 7, category: "casts" });
    expect(loadNotificationRecipients).toHaveBeenCalledTimes(1);
    expect(loadNotificationRecipients).toHaveBeenCalledWith([PROD_ID], "certified", { matchDm: true });
    expect(notifyUsers).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ topic: "MATCH_PROD" }));
  });

  it("assignMatchProd_byeMatch_throwsMatchNotLaunchable", async () => {
    match = { ...match, is_bye: 1 };

    await expect(assignMatchProd(42, STAFF, PROD_ID, null)).rejects.toThrow("MATCH_NOT_LAUNCHABLE");
    expect(updatesOfProd()).toHaveLength(0);
  });

  it("assignMatchProd_replace_notifiesBothAndLogsReplaced", async () => {
    match = { ...match, prod_user_id: OTHER_PROD_ID };

    await assignMatchProd(42, STAFF, PROD_ID, OTHER_PROD_ID);
    await settle();

    expect(loadNotificationRecipients).toHaveBeenNthCalledWith(1, [OTHER_PROD_ID], "certified", { matchDm: true });
    expect(loadNotificationRecipients).toHaveBeenNthCalledWith(2, [PROD_ID], "certified", { matchDm: true });
    expect(sendBotLog).toHaveBeenCalledWith(expect.any(String), { tournamentId: 7, category: "casts" });
  });

  it("assignMatchProd_remove_logsReleasedByStaffAndNotifiesReleased", async () => {
    match = { ...match, prod_user_id: PROD_ID };

    await assignMatchProd(42, STAFF, null, PROD_ID);
    await settle();

    expect(updatesOfProd()).toEqual([[expect.any(String), [null, 42]]]);
    expect(sendBotLog).toHaveBeenCalledWith(expect.any(String), { tournamentId: 7, category: "staff-removal" });
    expect(loadNotificationRecipients).toHaveBeenCalledWith([PROD_ID], "certified", { matchDm: true });
    expect(execute.mock.calls.some(([sql]) => sql.includes("LOCK IN SHARE MODE"))).toBe(false);
  });

  it("assignMatchProd_staffAssignsSelf_noNotice", async () => {
    accounts.set(STAFF_ID, { is_deleted: 0, holds_prod: 1 });

    await assignMatchProd(42, STAFF, STAFF_ID, null);
    await settle();

    expect(updatesOfProd()).toHaveLength(1);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("assignMatchProd_expectedDiffers_throwsProdChanged", async () => {
    match = { ...match, prod_user_id: OTHER_PROD_ID };

    await expect(assignMatchProd(42, STAFF, PROD_ID, null)).rejects.toThrow("PROD_CHANGED");
    expect(updatesOfProd()).toHaveLength(0);
  });

  it("assignMatchProd_sameAsCurrent_noWrite", async () => {
    match = { ...match, prod_user_id: PROD_ID };

    await assignMatchProd(42, STAFF, PROD_ID, null);

    expect(updatesOfProd()).toHaveLength(0);
    expect(trackAnnouncement).not.toHaveBeenCalled();
  });

  it("assignMatchProd_samePlannedProd_clearsPlannedMarkOnly", async () => {
    match = { ...match, prod_user_id: PROD_ID, prod_planned: 1 };

    await assignMatchProd(42, STAFF, PROD_ID, null);

    expect(execute.mock.calls.filter(([sql]) => sql.startsWith("UPDATE bg_matches SET prod_planned = 0"))).toEqual([
      [expect.any(String), [42]],
    ]);
    expect(updatesOfProd()).toHaveLength(0);
    expect(trackAnnouncement).not.toHaveBeenCalled();
  });

  it("assignMatchProd_targetWithoutProd_throwsNotProd", async () => {
    accounts.set(PROD_ID, { is_deleted: 0, holds_prod: 0 });

    await expect(assignMatchProd(42, STAFF, PROD_ID)).rejects.toThrow("PROD_NOT_ELIGIBLE");
  });

  it("assignMatchProd_suspendedTarget_throwsProdUnavailable", async () => {
    jest.mocked(lockedSuspendedUserIds).mockResolvedValue(new Set([PROD_ID]));

    await expect(assignMatchProd(42, STAFF, PROD_ID)).rejects.toThrow("PROD_UNAVAILABLE");
    expect(updatesOfProd()).toHaveLength(0);
  });

  it("assignMatchProd_targetIsCaster_throwsProdIsCaster", async () => {
    casterIds = [PROD_ID];

    await expect(assignMatchProd(42, STAFF, PROD_ID)).rejects.toThrow("PROD_IS_CASTER");
  });
});

describe("withdrawLostProdPlaces", () => {
  it("withdrawLostProdPlaces_openPlaces_clearsAndReturnsThem", async () => {
    const lost = jest.fn<SqlQuery>(async (sql) => {
      if (sql.startsWith("SELECT")) return [[{ ...match, prod_user_id: PROD_ID }], []];
      return [{ affectedRows: 1 }, []];
    });

    const released = await withdrawLostProdPlaces(fakeConnection({ execute: lost }), PROD_ID);

    expect(released).toEqual([{ matchId: 42, tournamentId: 7, pairing: { team1Id: 10, team2Id: 11 } }]);
    expect(lost).toHaveBeenLastCalledWith(expect.stringContaining("SET prod_user_id = NULL"), [PROD_ID, 42]);
  });

  it("withdrawLostProdPlaces_locksOnlyTheFilteredMatchesInIdOrder", async () => {
    const lost = jest.fn<SqlQuery>(async (sql) => {
      if (sql.startsWith("SELECT id FROM")) return [[{ id: 40 }, { id: 42 }], []];
      if (sql.startsWith("SELECT")) return [[{ ...match, prod_user_id: PROD_ID }], []];
      return [{ affectedRows: 1 }, []];
    });

    await withdrawLostProdPlaces(fakeConnection({ execute: lost }), PROD_ID);

    const [ids, locking] = lost.mock.calls.map(([sql]) => sql.replace(/\s+/g, " "));
    expect(ids).not.toContain("FOR UPDATE");
    expect(locking).toContain("id IN (?, ?)");
    expect(locking).toContain("ORDER BY id FOR UPDATE");
    expect(lost.mock.calls[1][1]).toEqual([40, 42, PROD_ID]);
  });

  it("withdrawLostProdPlaces_lockedRows_selectLaunchedAt", async () => {
    const lost = jest.fn<SqlQuery>(async (sql) => {
      if (sql.startsWith("SELECT id FROM")) return [[{ id: 42 }], []];
      if (sql.startsWith("SELECT")) return [[{ ...match, prod_user_id: PROD_ID, launched_at: null }], []];
      return [{ affectedRows: 1 }, []];
    });

    await withdrawLostProdPlaces(fakeConnection({ execute: lost }), PROD_ID);

    expect(lost.mock.calls[1][0]).toContain("launched_at, prod_user_id");
  });

  it("withdrawLostProdPlaces_launchedMatch_notSelected", async () => {
    const lost = jest.fn<SqlQuery>(async () => [[], []]);

    await withdrawLostProdPlaces(fakeConnection({ execute: lost }), PROD_ID);

    expect(lost.mock.calls[0][0]).toContain("launched_at IS NULL");
  });
});

describe("announceProdWithdrawals", () => {
  it("announceProdWithdrawals_roleLost_logsIneligibleAndDmGivesReason", async () => {
    announceProdWithdrawals(PROD_ID, [{ matchId: 42, tournamentId: 7, pairing: { team1Id: 10, team2Id: 11 } }]);
    await settle();

    expect(jest.mocked(sendBotLog).mock.calls[0][0]).toContain("la prod ne remplit plus les conditions");
    expect(jest.mocked(notifyUsers).mock.calls[0][1].discord?.message("fr")).toContain("Tu n'as plus le rôle prod");
  });

  it("announceProdWithdrawals_manyMatches_oneLogEachButOneNoticeToTheAccount", async () => {
    const pairing = { team1Id: 10, team2Id: 11 };
    announceProdWithdrawals(PROD_ID, [
      { matchId: 42, tournamentId: 7, pairing },
      { matchId: 43, tournamentId: 7, pairing },
      { matchId: 44, tournamentId: 8, pairing },
    ]);
    await settle();

    expect(jest.mocked(sendBotLog)).toHaveBeenCalledTimes(3);
    expect(jest.mocked(notifyUsers)).toHaveBeenCalledTimes(1);
  });

  it("withdrawLostProdPlaces_none_returnsEmptyWithoutUpdate", async () => {
    const lost = jest.fn<SqlQuery>(async () => [[], []]);

    expect(await withdrawLostProdPlaces(fakeConnection({ execute: lost }), PROD_ID)).toEqual([]);
    expect(lost).toHaveBeenCalledTimes(1);
  });
});

describe("loadProdPanel", () => {
  let panelMatch: Record<string, unknown> | null;
  let users: Record<string, unknown>[];
  let panelCasters: number[];
  let panelExecute: jest.Mock<SqlQuery>;

  beforeEach(() => {
    panelMatch = { id: 42, team1_id: 10, team2_id: 11, prod_user_id: null };
    users = [
      { id: PROD_ID, pseudo: "Prod" },
      { id: OTHER_PROD_ID, pseudo: "Prod2" },
      { id: 8, pseudo: "Joueuse" },
    ];
    panelCasters = [];
    panelExecute = jest.fn<SqlQuery>(async (sql) => {
      if (sql.includes("FROM bg_matches")) return [panelMatch ? [panelMatch] : [], []];
      if (sql.includes("FROM bg_match_casters")) {
        expect(sql).toContain("bg_planning_assignments");
        return [panelCasters.map((user_id) => ({ user_id })), []];
      }
      if (sql.includes("WHERE id = ? LIMIT 1")) return [[{ id: 9, pseudo: "Ancienne" }], []];
      if (sql.includes("FROM bg_users u")) return [users, []];
      throw new Error(`requête inattendue : ${sql}`);
    });
    jest.mocked(withConnection).mockImplementation((run) => run(fakeConnection({ execute: panelExecute })));
    jest.mocked(loadMatchPlayerIds).mockResolvedValue(new Set([8]));
  });

  it("loadProdPanel_missingMatch_returnsNull", async () => {
    panelMatch = null;

    expect(await loadProdPanel(42)).toBeNull();
  });

  it("loadProdPanel_marksPlayersAndCasters_blocks", async () => {
    panelCasters = [OTHER_PROD_ID];

    expect(await loadProdPanel(42)).toEqual({
      matchId: 42,
      prod: null,
      candidates: [
        { userId: PROD_ID, pseudo: "Prod", block: null },
        { userId: OTHER_PROD_ID, pseudo: "Prod2", block: "PROD_IS_CASTER" },
        { userId: 8, pseudo: "Joueuse", block: "PROD_IS_PLAYER" },
      ],
    });
  });

  it("loadProdPanel_currentProdIsCandidate_namesIt", async () => {
    panelMatch = { ...panelMatch, prod_user_id: PROD_ID };

    expect((await loadProdPanel(42))?.prod).toEqual({ userId: PROD_ID, pseudo: "Prod" });
  });

  it("loadProdPanel_currentProdNotCandidate_readsPseudo", async () => {
    panelMatch = { ...panelMatch, prod_user_id: 9 };

    expect((await loadProdPanel(42))?.prod).toEqual({ userId: 9, pseudo: "Ancienne" });
  });
});

describe("prodLogCategory", () => {
  it("prodLogCategory_losses_areStaffRemoval", () => {
    expect(prodLogCategory("RELEASED")).toBe("staff-removal");
    expect(prodLogCategory("RELEASED_BY_STAFF")).toBe("staff-removal");
    expect(prodLogCategory("INELIGIBLE")).toBe("staff-removal");
  });

  it("prodLogCategory_joinedTeamAndAccountDeletion_areStaffRemoval", () => {
    expect(prodLogCategory("JOINED_TEAM")).toBe("staff-removal");
    expect(prodLogCategory("ACCOUNT_DELETION")).toBe("staff-removal");
  });

  it("prodLogCategory_gains_areCasts", () => {
    expect(prodLogCategory("CLAIMED")).toBe("casts");
    expect(prodLogCategory("ASSIGNED")).toBe("casts");
    expect(prodLogCategory("REPLACED")).toBe("casts");
  });

  it("prodLogCategory_planned_isCasts", () => {
    expect(prodLogCategory("PLANNED")).toBe("casts");
  });
});

describe("queueProdChange", () => {
  const joined = {
    matchId: 42,
    log: "JOINED_TEAM" as const,
    notices: [{ userId: PROD_ID, kind: "JOINED_TEAM" as const }],
    pairing: { team1Id: 10, team2Id: 11 },
  };

  it("flushProdChanges_queuedChange_announcesAfterCommit", async () => {
    const connection = fakeConnection({ execute });
    queueProdChange(connection, joined);

    flushProdChanges(connection);
    await settle();

    expect(jest.mocked(sendBotLog).mock.calls[0][0]).toContain("la prod joue désormais le match");
    expect(notifyUsers).toHaveBeenCalledTimes(1);
  });

  it("discardProdChanges_queuedChange_nothingAnnounced", async () => {
    const connection = fakeConnection({ execute });
    queueProdChange(connection, joined);

    discardProdChanges(connection);
    flushProdChanges(connection);
    await settle();

    expect(sendBotLog).not.toHaveBeenCalled();
  });
});

describe("formatProdNotice", () => {
  const notice: ProdNoticeMatch = {
    tournamentId: 7,
    tournamentName: "Coupe",
    matchId: 42,
    bracket: "UPPER",
    roundNumber: 2,
    team1Name: "Alpha",
    team2Name: "Beta",
    solo: false,
    kind: "ASSIGNED",
  };

  it("formatProdNotice_unavailable_frAndEn", () => {
    const url = "https://bluegenji.test/tournois/7#match-42";

    expect(formatProdNotice({ ...notice, kind: "UNAVAILABLE" }, url, "fr")).toContain(
      "Ton compte ne peut plus faire la prod pour le moment",
    );
    expect(formatProdNotice({ ...notice, kind: "UNAVAILABLE" }, url, "en")).toContain("Your account cannot be a prod for now");
  });

  it("formatProdNotice_teamMatchFr_namesTeams", () => {
    const text = formatProdNotice(notice, "https://bluegenji.test/tournois/7#match-42", "fr");

    expect(text).toContain("Le staff te place comme prod du match");
    expect(text).toContain("Alpha");
    expect(text).toContain("Beta");
    expect(text).toContain("https://bluegenji.test/tournois/7#match-42");
  });

  it("formatProdNotice_soloEn_saysAMatch", () => {
    const text = formatProdNotice(
      { ...notice, solo: true, kind: "RELEASED", team1Name: "Pseudo1", team2Name: "Pseudo2" },
      "https://bluegenji.test/tournois/7#match-42",
      "en",
    );

    expect(text).toContain("The staff removed you as the prod of a match");
    expect(text).not.toContain("Pseudo1");
    expect(text).not.toContain("Pseudo2");
  });

  it("formatProdNotice_plannedFrAndEn_saysThePlanning", () => {
    const url = "https://bluegenji.test/tournois/7#match-42";

    expect(formatProdNotice({ ...notice, kind: "PLANNED" }, url, "fr")).toContain("Le planning te place comme prod du match");
    expect(formatProdNotice({ ...notice, kind: "PLANNED" }, url, "en")).toContain("The planning made you the prod of the match");
  });

  it("formatProdNotice_joinedTeamEn_saysNowPlayer", () => {
    const text = formatProdNotice({ ...notice, kind: "JOINED_TEAM" }, "https://bluegenji.test/tournois/7#match-42", "en");

    expect(text).toContain("You are now one of the players: you are no longer the prod of the match");
  });
});
