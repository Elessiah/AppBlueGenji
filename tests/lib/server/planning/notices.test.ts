import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/notify");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/staff-audit");
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://bluegenji.test" }));

import { sendBotLog } from "@/lib/server/bot-integration";
import { loadNotificationRecipients, loadStaffIds, notifyUsers } from "@/lib/server/notify";
import { announceAssignments, announceCastLinkNeeded, announceSoloCasterChange, announceWithdrawal, noticeEntry } from "@/lib/server/planning/notices";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { loadedEntry } from "../../../helpers/planning";

/** Annonces du planning (`CAST_PLANNING.md` § Notifications) : à qui, sur quel sujet, sans nommer personne. */

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadNotificationRecipients).mockImplementation(async (ids) => ids.map((userId) => ({ userId, discord: null })));
  jest.mocked(notifyUsers).mockResolvedValue({ discord: null, discordUnreachedUserIds: [], pushed: 0 });
  // Le staff des tournois (1 admin, 2 arbitre), sans celui qui se désiste (4).
  jest.mocked(loadStaffIds).mockResolvedValue([1, 2]);
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

    expect(jest.mocked(loadNotificationRecipients).mock.calls[0]).toEqual([[4], "proven", { excludeSuspended: true, planningMembersOnly: true }]);
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(jest.mocked(notifyUsers).mock.calls[0][1]).toMatchObject({ topic: "PLANNING_ASSIGNED", dmFollowsTopic: true });
  });

  it("announceAssignments_sameListForTwoUsers_oneSendForBoth", async () => {
    const entry = loadedEntry();

    await announceAssignments([
      { userId: 4, entry, role: "CASTER" },
      { userId: 6, entry, role: "CASTER" },
    ]);

    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(jest.mocked(notifyUsers).mock.calls[0][0].map((recipient) => recipient.userId)).toEqual([4, 6]);
  });

  it("announceAssignments_differentLists_oneSendPerList", async () => {
    await announceAssignments([
      { userId: 4, entry: loadedEntry(), role: "CASTER" },
      { userId: 6, entry: loadedEntry(), role: "PROD" },
    ]);

    expect(notifyUsers).toHaveBeenCalledTimes(2);
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

describe("announceCastLinkNeeded", () => {
  it("announceCastLinkNeeded_placedCasters_notifiedOnAssignedTopicWithMatchLink", async () => {
    await announceCastLinkNeeded([4, 5], loadedEntry());

    expect(jest.mocked(loadNotificationRecipients).mock.calls[0]).toEqual([[4, 5], "proven", { excludeSuspended: true, planningMembersOnly: true }]);
    const notification = jest.mocked(notifyUsers).mock.calls[0][1];
    expect(notification).toMatchObject({ topic: "PLANNING_ASSIGNED", dmFollowsTopic: true });
    expect(notification.discord?.context).toBe("planning-cast-link");
    expect(notification.push?.("fr").tag).toBe("planning-cast-link-1");
    expect(notification.discord?.message("fr")).toContain("https://bluegenji.test/tournois/10");
  });

  it("announceCastLinkNeeded_noRecipients_nothingSent", async () => {
    jest.mocked(loadNotificationRecipients).mockResolvedValue([]);

    await announceCastLinkNeeded([4], loadedEntry());

    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("announceCastLinkNeeded_emptyList_nothingLoaded", async () => {
    await announceCastLinkNeeded([], loadedEntry());

    expect(loadNotificationRecipients).not.toHaveBeenCalled();
  });

  it("announceCastLinkNeeded_sendFails_loggedNeverThrows", async () => {
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(notifyUsers).mockRejectedValue(new Error("BOT_DOWN"));

    await expect(announceCastLinkNeeded([4], loadedEntry())).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("lien de diffusion"), expect.anything());
    errorLog.mockRestore();
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

  it("announceWithdrawal_stillHeld_coAssignedToldNoOpenSlotAlert", async () => {
    await announceWithdrawal(withdrawal({ unfilled: false, stillHeldBy: [6], coAssignedIds: [5] }));

    expect(sent()).toEqual([[[5], "PLANNING_WITHDRAWAL"]]);
    expect(sendBotLog).not.toHaveBeenCalled();
    const message = jest.mocked(notifyUsers).mock.calls[0][1].discord?.message("fr");
    expect(message).toContain("Un autre caster reste affecté.");
  });

  it("announceWithdrawal_stillHeld_remainingCasterGetsSelfText_othersGetOtherText", async () => {
    await announceWithdrawal(withdrawal({ unfilled: false, stillHeldBy: [6], coAssignedIds: [5, 6] }));

    expect(sent()).toEqual([
      [[5], "PLANNING_WITHDRAWAL"],
      [[6], "PLANNING_WITHDRAWAL"],
    ]);
    expect(sendBotLog).not.toHaveBeenCalled();
    const calls = jest.mocked(notifyUsers).mock.calls;
    expect(calls[0][1].discord?.message("fr")).toContain("Un autre caster reste affecté.");
    expect(calls[1][1].discord?.message("fr")).toContain("Tu restes affecté comme caster.");
  });

  it("announceWithdrawal_stillHeldAndOthers_recipientsLoadedOnce", async () => {
    await announceWithdrawal(withdrawal({ unfilled: false, stillHeldBy: [6], coAssignedIds: [5, 6] }));

    expect(jest.mocked(loadNotificationRecipients).mock.calls).toEqual([[[5, 6], "proven", { excludeSuspended: true, planningMembersOnly: true }]]);
  });

  it("announceWithdrawal_unfilledStreamLost_everyoneToldStreamLost", async () => {
    await announceWithdrawal(withdrawal({ unfilled: true, streamLost: true, coAssignedIds: [5] }));

    const calls = jest.mocked(notifyUsers).mock.calls;
    expect(calls[0][1].discord?.message("fr")).toContain("La diffusion est perdue");
    expect(calls[1][1].topic).toBe("PLANNING_UNFILLED");
    expect(calls[1][1].discord?.message("fr")).toContain("diffusion perdue");
  });

  it("announceWithdrawal_staffUnfilledWhileStillHeld_staffNotifiedOthersStillHeld", async () => {
    // Le caster restant (6) est suspendu : les membres lisent « un autre caster reste », le staff est prévenu.
    await announceWithdrawal(withdrawal({ unfilled: false, stillHeldBy: [6], staffUnfilled: { streamLost: false }, coAssignedIds: [5] }));

    const calls = jest.mocked(notifyUsers).mock.calls;
    expect(sent()).toEqual([
      [[5], "PLANNING_WITHDRAWAL"],
      [[1, 2], "PLANNING_UNFILLED"],
    ]);
    expect(calls[0][1].discord?.message("fr")).toContain("Un autre caster reste affecté.");
    expect(calls[1][1].discord?.message("fr")).toContain("place à pourvoir");
  });

  it("announceWithdrawal_staffUnfilledNull_noStaffAlert", async () => {
    await announceWithdrawal(withdrawal({ unfilled: true, staffUnfilled: null, coAssignedIds: [5] }));

    expect(sent()).toEqual([[[5], "PLANNING_WITHDRAWAL"]]);
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("announceWithdrawal_notUnfilledStreamLostFlag_ignored", async () => {
    await announceWithdrawal(withdrawal({ replacementId: 6, unfilled: false, streamLost: true, coAssignedIds: [5] }));

    expect(jest.mocked(notifyUsers).mock.calls[0][1].discord?.message("fr")).toContain("Un remplaçant a été affecté.");
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
    expect(scope).toEqual({ tournamentId: 10, category: "staff-removal" });
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
    jest.mocked(loadStaffIds).mockResolvedValue([]);

    await announceWithdrawal(withdrawal());

    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("announceWithdrawal_staffReadFails_neverThrows", async () => {
    jest.mocked(loadStaffIds).mockRejectedValue(new Error("ECONNRESET"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(announceWithdrawal(withdrawal())).resolves.toBeUndefined();
    expect(notifyUsers).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("announceWithdrawal — destinataires", () => {
  it("announceWithdrawal_unfilled_staffChosenByNotifyStaffRuleWithoutWithdrawer", async () => {
    await announceWithdrawal(withdrawal());

    expect(loadStaffIds).toHaveBeenCalledWith("tournaments", [4]);
  });

  it("announceWithdrawal_unfilledStaffRelease_actorExcludedFromStaff", async () => {
    await announceWithdrawal(withdrawal({ released: true, actorId: 1 }));

    expect(loadStaffIds).toHaveBeenCalledWith("tournaments", [4, 1]);
  });

  it("announceWithdrawal_releasedUnfilled_noDiscordLineButStaffNotified", async () => {
    await announceWithdrawal(withdrawal({ released: true, actorId: 1 }));

    expect(sendBotLog).not.toHaveBeenCalled();
    expect(sent()).toContainEqual([expect.any(Array), "PLANNING_UNFILLED"]);
  });

  it("announceWithdrawal_actorCoAssigned_actorNotNotified", async () => {
    await announceWithdrawal(withdrawal({ unfilled: false, released: true, actorId: 5, coAssignedIds: [3, 5] }));

    expect(sent()).toEqual([[[3], "PLANNING_WITHDRAWAL"]]);
  });

  it("announceWithdrawal_released_noticeCarriesReleased", async () => {
    await announceWithdrawal(withdrawal({ unfilled: false, released: true, actorId: 1, coAssignedIds: [3] }));

    const push = jest.mocked(notifyUsers).mock.calls[0][1].push;
    expect(push("fr").body).toContain("a été retiré du planning");
  });

  it("announceWithdrawal_coAssigned_suspendedAccountsLeftOut", async () => {
    await announceWithdrawal(withdrawal({ unfilled: false, coAssignedIds: [3] }));

    expect(jest.mocked(loadNotificationRecipients).mock.calls[0]).toEqual([[3], "proven", { excludeSuspended: true, planningMembersOnly: true }]);
  });

  it("announceWithdrawal_unfilled_suspendedStaffLeftOut", async () => {
    await announceWithdrawal(withdrawal());

    expect(jest.mocked(loadNotificationRecipients).mock.calls[0]).toEqual([[1, 2], "proven", { excludeSuspended: true, planningMembersOnly: true }]);
  });
});

describe("announceSoloCasterChange", () => {
  const actor = { id: 1, pseudo: "Chef" };

  it("announceSoloCasterChange_reachable_logsAnonymouslyAndNotifiesCaster", async () => {
    await announceSoloCasterChange(5, true, actor);

    expect(publishStaffAction).toHaveBeenCalledWith(
      "🎙️ Caster autonome activé pour un caster du planning, par le staff.",
      actor,
      { category: "casts", auditLine: "🎙️ Caster autonome activé pour un caster du planning, par le staff. (compte #5)" },
    );
    expect(jest.mocked(loadNotificationRecipients).mock.calls[0]).toEqual([[5], "proven", { excludeSuspended: true, planningMembersOnly: true }]);
    expect(jest.mocked(notifyUsers).mock.calls[0][1]).toMatchObject({ topic: "PLANNING_SOLO_CASTER", dmFollowsTopic: true });
  });

  it("announceSoloCasterChange_turnedOff_pushSaysDisabledWithoutStaffName", async () => {
    await announceSoloCasterChange(5, false, actor);

    const notification = jest.mocked(notifyUsers).mock.calls[0][1];
    expect(notification.push("fr").title).toBe("Caster autonome désactivé");
    expect(notification.discord?.message("fr")).not.toContain("Chef");
  });

  it("announceSoloCasterChange_called_logPublishedSynchronouslyBeforeNotice", async () => {
    const done = announceSoloCasterChange(5, true, actor);

    // Écrite dans le tour même (pm2 avant toute attente), l'avis encore à venir.
    expect(publishStaffAction).toHaveBeenCalledTimes(1);
    expect(notifyUsers).not.toHaveBeenCalled();
    await done;
    expect(notifyUsers).toHaveBeenCalledTimes(1);
  });

  it("announceSoloCasterChange_noRecipient_logsWithoutNotifying", async () => {
    jest.mocked(loadNotificationRecipients).mockResolvedValue([]);

    await announceSoloCasterChange(5, true, actor);

    expect(publishStaffAction).toHaveBeenCalledTimes(1);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("announceSoloCasterChange_logThrows_stillNotifiesCaster", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(publishStaffAction).mockImplementationOnce(() => {
      throw new Error("bot batch");
    });

    await expect(announceSoloCasterChange(5, true, actor)).resolves.toBeUndefined();

    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("announceSoloCasterChange_notifyFails_neverThrows", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(notifyUsers).mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(announceSoloCasterChange(5, true, actor)).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("announceSoloCasterChange_rapidToggles_noticesArriveInGestureOrder", async () => {
    let releaseFirst: () => void = () => undefined;
    jest.mocked(notifyUsers).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ discord: null, discordUnreachedUserIds: [], pushed: 0 });
        }),
    );

    const first = announceSoloCasterChange(5, true, actor);
    const second = announceSoloCasterChange(5, false, actor);
    await new Promise((resolve) => setImmediate(resolve));
    // Le second attend le premier : un seul envoi tant que le premier n'est pas parti.
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    releaseFirst();
    await Promise.all([first, second]);

    expect(notifyUsers).toHaveBeenCalledTimes(2);
    expect(jest.mocked(notifyUsers).mock.calls[0][1].push("fr").title).toBe("Caster autonome activé");
    expect(jest.mocked(notifyUsers).mock.calls[1][1].push("fr").title).toBe("Caster autonome désactivé");
  });
});
