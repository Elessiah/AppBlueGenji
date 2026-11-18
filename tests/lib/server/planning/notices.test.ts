import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/notify");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://bluegenji.test" }));

import { pushRefereeAlert } from "@/lib/server/bot-integration";
import { loadNotificationRecipients, notifyStaff, notifyUsers } from "@/lib/server/notify";
import { announceAssignments, announceWithdrawal, noticeEntry } from "@/lib/server/planning/notices";
import { loadedEntry } from "../../../helpers/planning";

/** Annonces du planning (`CAST_PLANNING.md` § Notifications) : à qui, sur quel sujet, sans nommer personne. */

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadNotificationRecipients).mockImplementation(async (ids) => ids.map((userId) => ({ userId, discord: null })));
  jest.mocked(notifyUsers).mockResolvedValue({ discord: null, discordUnreachedUserIds: [], pushed: 0 });
  jest.mocked(notifyStaff).mockResolvedValue({ discord: null, discordUnreachedUserIds: [], pushed: 0 });
  jest.mocked(pushRefereeAlert).mockResolvedValue({ sent: 1, unresolved: [], failed: [] });
});

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
    await announceWithdrawal({ entry: loadedEntry(), role: "CASTER", late: false, replacementId: 6, coAssignedIds: [3, 6] });

    expect(jest.mocked(notifyUsers).mock.calls.map(([recipients, notification]) => [recipients.map((r) => r.userId), notification.topic])).toEqual([
      [[3], "PLANNING_WITHDRAWAL"],
      [[6], "PLANNING_ASSIGNED"],
    ]);
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it("announceWithdrawal_noReplacement_staffWarnedOfOpenSlot", async () => {
    await announceWithdrawal({ entry: loadedEntry(), role: "PROD", late: true, replacementId: null, coAssignedIds: [] });

    expect(notifyUsers).not.toHaveBeenCalled();
    expect(jest.mocked(notifyStaff).mock.calls[0][0].topic).toBe("PLANNING_UNFILLED");
  });

  it("announceWithdrawal_staffLine_namesNoStaffAndFlagsLate", async () => {
    jest.mocked(notifyStaff).mockImplementation(async (notification) => {
      await notification.discord?.();
      return { discord: null, discordUnreachedUserIds: [], pushed: 0 };
    });

    await announceWithdrawal({ entry: loadedEntry(), role: "CASTER", late: true, replacementId: null, coAssignedIds: [] });

    const line = jest.mocked(pushRefereeAlert).mock.calls[0][0];
    expect(line).toContain("un caster s'est désisté de Alpha contre Bravo — Coupe");
    expect(line).toContain("désistement tardif");
  });
});
