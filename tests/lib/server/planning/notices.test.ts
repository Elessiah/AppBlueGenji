import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/notify");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/database");
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://bluegenji.test" }));

import { sendBotLog } from "@/lib/server/bot-integration";
import { getDatabase } from "@/lib/server/database";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { announceAssignments, announceWithdrawal, loadTournamentStaffIds, noticeEntry } from "@/lib/server/planning/notices";
import { loadedEntry } from "../../../helpers/planning";
import { fakePool, type SqlQuery } from "../../../helpers/sql-double";

/** Annonces du planning (`CAST_PLANNING.md` § Notifications) : à qui, sur quel sujet, sans nommer personne. */

const query = jest.fn<SqlQuery>();
/** Comptes du staff que rend la base : 1 admin, 2 arbitre (`tournaments`), 3 caster seul, 4 l'arbitre qui se désiste. */
const STAFF_ROWS = [
  { id: 1, is_admin: 1, platform_roles_json: null },
  { id: 2, is_admin: 0, platform_roles_json: '["ARBITRE"]' },
  { id: 3, is_admin: 0, platform_roles_json: '["CASTER"]' },
  { id: 4, is_admin: 0, platform_roles_json: '["ARBITRE"]' },
];

beforeEach(() => {
  jest.clearAllMocks();
  query.mockResolvedValue([STAFF_ROWS]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));
  jest.mocked(loadNotificationRecipients).mockImplementation(async (ids) => ids.map((userId) => ({ userId, discord: null })));
  jest.mocked(notifyUsers).mockResolvedValue({ discord: null, discordUnreachedUserIds: [], pushed: 0 });
});

const withdrawal = (overrides: Partial<Parameters<typeof announceWithdrawal>[0]> = {}) => ({
  entry: loadedEntry(),
  role: "CASTER" as const,
  late: false,
  withdrawnUserId: 4,
  replacementId: null,
  unfilled: true,
  coAssignedIds: [],
  ...overrides,
});

const sent = () => jest.mocked(notifyUsers).mock.calls.map(([recipients, notification]) => [recipients.map((r) => r.userId), notification.topic]);

describe("noticeEntry", () => {
  it("noticeEntry_soloEntrant_flaggedSolo", () => {
    const entry = loadedEntry({ team1: { teamId: 100, name: "Joueur", soloUserId: 55 } });

    expect(noticeEntry(entry).solo).toBe(true);
  });
});

describe("announceAssignments", () => {
  it("announceAssignments_actorAndOthers_oneMessagePerOtherUser", async () => {
    const entry = loadedEntry();
    const other = loadedEntry({ key: "m:2", matchId: 2 });

    await announceAssignments(
      [
        { userId: 9, entry, role: "REFEREE" },
        { userId: 4, entry, role: "CASTER" },
        { userId: 4, entry: other, role: "CASTER" },
      ],
      { actorId: 9 },
    );

    expect(jest.mocked(loadNotificationRecipients).mock.calls[0]).toEqual([[4], "proven"]);
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(jest.mocked(notifyUsers).mock.calls[0][1]).toMatchObject({ topic: "PLANNING_ASSIGNED", dmFollowsTopic: true });
  });

  it("announceAssignments_onlyTheActor_sendsNothing", async () => {
    await announceAssignments([{ userId: 9, entry: loadedEntry(), role: "REFEREE" }], { actorId: 9 });

    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("announceAssignments_notifyFails_neverThrows", async () => {
    jest.mocked(notifyUsers).mockRejectedValue(new Error("ECONNRESET"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(announceAssignments([{ userId: 4, entry: loadedEntry(), role: "CASTER" }])).resolves.toBeUndefined();
    error.mockRestore();
  });
});

describe("announceWithdrawal", () => {
  it("announceWithdrawal_replaced_coAssignedWarnedAndReplacementAssigned", async () => {
    await announceWithdrawal(withdrawal({ replacementId: 6, unfilled: false, coAssignedIds: [3, 6] }));

    expect(sent()).toEqual([
      [[3], "PLANNING_WITHDRAWAL"],
      [[6], "PLANNING_ASSIGNED"],
    ]);
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("announceWithdrawal_noReplacement_tournamentStaffWarnedWithoutTheWithdrawer", async () => {
    await announceWithdrawal(withdrawal({ role: "PROD", late: true }));

    expect(sent()).toEqual([[[1, 2], "PLANNING_UNFILLED"]]);
    expect(jest.mocked(notifyUsers).mock.calls[0][1]).toMatchObject({ dmFollowsTopic: true, discord: { context: "planning-unfilled" } });
  });

  it("announceWithdrawal_noReplacement_dmInRecipientLanguageNamesNoStaff", async () => {
    await announceWithdrawal(withdrawal({ late: true }));

    const message = jest.mocked(notifyUsers).mock.calls[0][1].discord?.message;
    expect(message?.("fr")).toContain("un caster s'est désisté de Alpha contre Bravo — Coupe");
    expect(message?.("en")).toContain("a caster withdrew from Alpha vs Bravo — Coupe");
    expect(message?.("en")).toContain("late withdrawal");
  });

  it("announceWithdrawal_staffLog_namesNoStaffAndFlagsLate", async () => {
    await announceWithdrawal(withdrawal({ late: true }));

    const [line, scope] = jest.mocked(sendBotLog).mock.calls[0];
    expect(line).toContain("un caster s'est désisté de Alpha contre Bravo — Coupe");
    expect(line).toContain("désistement tardif");
    expect(scope).toEqual({ tournamentId: 10, category: "referees" });
  });

  it("announceWithdrawal_slotHeldByMatchReferee_noOpenSlotAlert", async () => {
    await announceWithdrawal(withdrawal({ role: "REFEREE", unfilled: false, coAssignedIds: [3] }));

    expect(sent()).toEqual([[[3], "PLANNING_WITHDRAWAL"]]);
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("announceWithdrawal_withdrawerAmongCoAssigned_neverWarnedOfOwnGesture", async () => {
    await announceWithdrawal(withdrawal({ unfilled: false, coAssignedIds: [4, 3] }));

    expect(sent()).toEqual([[[3], "PLANNING_WITHDRAWAL"]]);
  });

  it("announceWithdrawal_unfilledNoOtherStaff_logSentWithoutNotification", async () => {
    query.mockResolvedValue([[{ id: 4, is_admin: 0, platform_roles_json: '["ARBITRE"]' }]]);

    await announceWithdrawal(withdrawal());

    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("announceWithdrawal_staffReadFails_neverThrows", async () => {
    query.mockRejectedValue(new Error("ECONNRESET"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(announceWithdrawal(withdrawal())).resolves.toBeUndefined();
    expect(notifyUsers).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("loadTournamentStaffIds", () => {
  it("loadTournamentStaffIds_keepsTournamentsPermissionOnly", async () => {
    await expect(loadTournamentStaffIds()).resolves.toEqual([1, 2, 4]);
  });

  it("loadTournamentStaffIds_excludedAccounts_left", async () => {
    await expect(loadTournamentStaffIds([2, 4])).resolves.toEqual([1]);
  });

  it("loadTournamentStaffIds_skipsDeletedAndSuspendedInSql", async () => {
    await loadTournamentStaffIds();

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("u.is_deleted = 0");
    expect(sql).toContain("bg_account_suspensions");
  });
});
