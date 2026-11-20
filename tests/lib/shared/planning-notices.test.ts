import { describe, expect, it } from "@jest/globals";
import {
  formatPlanningAssignedDm,
  formatPlanningCastLinkDm,
  formatPlanningNewEntriesDm,
  formatPlanningSoloCasterDm,
  formatPlanningUnfilledDm,
  formatPlanningUnfilledLine,
  formatPlanningWithdrawalDm,
  PLANNING_DM_MAX_LINES,
  planningEntryLabel,
  type PlanningNoticeAssignment,
  type PlanningNoticeEntry,
  type PlanningWithdrawalNotice,
} from "@/lib/shared/planning-notices";
import {
  planningAssignedPush,
  planningCastLinkPush,
  planningNewEntriesPush,
  planningSoloCasterPush,
  planningUnfilledPush,
  planningWithdrawalPush,
} from "@/lib/shared/push-messages";
import { PUSH_TOPICS } from "@/lib/shared/push-notifications";
import enPlanning from "@/messages/en/planning.json";
import enPush from "@/messages/en/push.json";
import enPushMessages from "@/messages/en/pushMessages.json";
import frPlanning from "@/messages/fr/planning.json";
import frPush from "@/messages/fr/push.json";
import frPushMessages from "@/messages/fr/pushMessages.json";

/** Notifications du planning (`CAST_PLANNING.md` § Notifications) : messages privés et push, sans pseudo ni staff nommé. */

const SITE = "https://bluegenji.test";

function noticeEntry(overrides: Partial<PlanningNoticeEntry> = {}): PlanningNoticeEntry {
  return {
    key: "m:12",
    kind: "MATCH",
    tournamentId: 3,
    tournamentName: "Coupe",
    team1Name: "Renards",
    team2Name: "Nova",
    solo: false,
    // Mardi 24 novembre 2026, 20 h à Paris.
    startAt: "2026-11-24T19:00:00.000Z",
    ...overrides,
  };
}

const assignment = (overrides: Partial<PlanningNoticeAssignment> = {}): PlanningNoticeAssignment => ({
  ...noticeEntry(),
  role: "CASTER",
  ...overrides,
});

const withdrawal = (overrides: Partial<PlanningWithdrawalNotice> = {}): PlanningWithdrawalNotice => ({
  ...noticeEntry(),
  role: "CASTER",
  replaced: false,
  late: false,
  ...overrides,
});

describe("formatPlanningNewEntriesDm", () => {
  it("formatPlanningNewEntriesDm_teamMatchFr_listsTeamsTimeAndLink", () => {
    const message = formatPlanningNewEntriesDm([noticeEntry()], SITE, "fr");

    expect(message).toContain("Un nouveau match est au planning");
    expect(message).toContain("Renards contre Nova — Coupe");
    expect(message).toContain("20:00");
    expect(message).toContain(`${SITE}/planning`);
  });

  it("formatPlanningNewEntriesDm_english_linksEnglishPlanning", () => {
    const message = formatPlanningNewEntriesDm([noticeEntry()], SITE, "en");

    expect(message).toContain("Renards vs Nova — Coupe");
    expect(message).toContain(`${SITE}/en/planning`);
  });

  it("formatPlanningNewEntriesDm_soloEntry_neverWritesEntrantName", () => {
    const message = formatPlanningNewEntriesDm([noticeEntry({ solo: true, team1Name: "JoueurUn", team2Name: "JoueurDeux" })], SITE, "fr");

    expect(message).toContain("Un match — Coupe");
    expect(message).not.toContain("JoueurUn");
    expect(message).not.toContain("JoueurDeux");
  });

  it("formatPlanningNewEntriesDm_overMaxLines_summarisesTheRest", () => {
    const entries = Array.from({ length: PLANNING_DM_MAX_LINES + 2 }, (_, index) => noticeEntry({ key: `m:${index + 1}` }));

    const message = formatPlanningNewEntriesDm(entries, SITE, "fr");

    expect(message.split("\n").filter((line) => line.startsWith("• "))).toHaveLength(PLANNING_DM_MAX_LINES);
    expect(message).toContain("… et 2 autres");
  });
});

describe("planningEntryLabel", () => {
  it("planningEntryLabel_tournamentEntry_wholeEvent", () => {
    expect(planningEntryLabel(noticeEntry({ kind: "TOURNAMENT", key: "t:3" }), "fr")).toBe("Coupe (tout l'événement)");
  });

  it("planningEntryLabel_emptySeat_tbd", () => {
    expect(planningEntryLabel(noticeEntry({ team2Name: null }), "fr")).toBe("Renards contre TBD — Coupe");
  });
});

describe("formatPlanningAssignedDm", () => {
  it("formatPlanningAssignedDm_single_listsRoleAndEntry", () => {
    const message = formatPlanningAssignedDm([assignment({ role: "REFEREE" })], SITE, "fr");

    expect(message).toContain("Tu es affecté au planning");
    expect(message).toContain("arbitre — Renards contre Nova — Coupe");
  });

  it("formatPlanningAssignedDm_replacement_saysStaffWithdrewWithoutName", () => {
    const message = formatPlanningAssignedDm([assignment()], SITE, "fr", true);

    expect(message).toContain("Un membre du staff s'est désisté");
  });
});

describe("formatPlanningWithdrawalDm", () => {
  it("formatPlanningWithdrawalDm_replaced_anonymousWithReplacement", () => {
    const message = formatPlanningWithdrawalDm(withdrawal({ replaced: true }), SITE, "fr");

    expect(message).toContain("Un caster s'est désisté de Renards contre Nova — Coupe");
    expect(message).toContain("Un remplaçant a été affecté.");
  });

  it("formatPlanningWithdrawalDm_stillHeldNonCasterRole_saysSlotOpen", () => {
    const message = formatPlanningWithdrawalDm(withdrawal({ role: "REFEREE", stillHeld: true }), SITE, "fr");

    expect(message).toContain("à pourvoir");
    expect(message).not.toContain("Un autre");
  });

  it("formatPlanningWithdrawalDm_stillHeldFr_saysAnotherCasterAssigned", () => {
    const message = formatPlanningWithdrawalDm(withdrawal({ stillHeld: true }), SITE, "fr");

    expect(message).toContain("Un autre caster reste affecté.");
    expect(message).not.toContain("à pourvoir");
  });

  it("formatPlanningWithdrawalDm_stillHeldEn_saysAnotherCasterAssigned", () => {
    const message = formatPlanningWithdrawalDm(withdrawal({ stillHeld: true }), SITE, "en");

    expect(message).toContain("Another caster is still assigned.");
  });

  it("formatPlanningWithdrawalDm_selfHeldFr_saysRecipientStaysAssigned", () => {
    const message = formatPlanningWithdrawalDm(withdrawal({ stillHeld: true, selfHeld: true }), SITE, "fr");

    expect(message).toContain("Tu restes affecté comme caster.");
    expect(message).not.toContain("Un autre caster");
  });

  it("formatPlanningWithdrawalDm_selfHeldEn_saysRecipientStaysAssigned", () => {
    const message = formatPlanningWithdrawalDm(withdrawal({ stillHeld: true, selfHeld: true }), SITE, "en");

    expect(message).toContain("You remain assigned as caster.");
  });

  it("formatPlanningWithdrawalDm_open_saysSlotOpen", () => {
    const message = formatPlanningWithdrawalDm(withdrawal(), SITE, "en");

    expect(message).toContain("A caster withdrew");
    expect(message).toContain("The slot is open.");
  });
});

describe("formatPlanningUnfilledDm", () => {
  it("formatPlanningUnfilledDm_englishNotLate_noLateFlag", () => {
    const dm = formatPlanningUnfilledDm(withdrawal(), SITE, "en");

    expect(dm).toContain("no replacement found, the slot is open.");
    expect(dm).toContain(`${SITE}/en/planning`);
    expect(dm).not.toContain("late withdrawal");
  });
});

describe("diffusion perdue", () => {
  it("formatPlanningWithdrawalDm_streamLostFr_saysProdOrSoloNeeded", () => {
    const message = formatPlanningWithdrawalDm(withdrawal({ streamLost: true }), SITE, "fr");

    expect(message).toContain("La diffusion est perdue : il manque un prod ou un caster autonome.");
    expect(message).not.toContain("La place est à pourvoir.");
  });

  it("formatPlanningWithdrawalDm_streamLostEn_saysProdOrSoloNeeded", () => {
    expect(formatPlanningWithdrawalDm(withdrawal({ streamLost: true }), SITE, "en")).toContain(
      "The stream is lost: a prod or a solo caster is needed.",
    );
  });

  it("formatPlanningUnfilledDm_streamLostFr_saysStreamLost", () => {
    expect(formatPlanningUnfilledDm(withdrawal({ streamLost: true }), SITE, "fr")).toContain(
      "aucun remplaçant trouvé, diffusion perdue (il manque un prod ou un caster autonome).",
    );
  });

  it("formatPlanningUnfilledDm_streamLostEn_saysStreamLost", () => {
    expect(formatPlanningUnfilledDm(withdrawal({ streamLost: true }), SITE, "en")).toContain(
      "no replacement found, the stream is lost (a prod or a solo caster is needed).",
    );
  });

  it("planningWithdrawalPush_streamLost_bodyStreamLost", () => {
    const notice = withdrawal({ streamLost: true });

    expect(planningWithdrawalPush(notice, "fr").body).toContain("la diffusion est perdue");
    expect(planningWithdrawalPush(notice, "en").body).toContain("the stream is lost");
  });

  it("planningUnfilledPush_streamLostNotLate_bodyStreamLost", () => {
    const push = planningUnfilledPush(withdrawal({ streamLost: true }), "en");

    expect(push.body).toContain("the stream is lost");
    expect(push.body).not.toContain("less than 24 hours");
  });

  it("planningUnfilledPush_streamLostLate_bodyStreamLostLate", () => {
    const push = planningUnfilledPush(withdrawal({ streamLost: true, late: true }), "fr");

    expect(push.body).toContain("diffusion perdue");
    expect(push.body).toContain("moins de 24 h avant");
  });
});

describe("formatPlanningUnfilledLine", () => {
  it("formatPlanningUnfilledLine_late_flagsLateWithdrawal", () => {
    expect(formatPlanningUnfilledLine(withdrawal({ late: true }), SITE)).toContain("désistement tardif");
  });

  it("formatPlanningUnfilledLine_notLate_noLateFlag", () => {
    expect(formatPlanningUnfilledLine(withdrawal(), SITE)).not.toContain("tardif");
  });
});

describe("push du planning", () => {
  it("planningNewEntriesPush_twoEntries_pluralTitleAndPlanningUrl", () => {
    const push = planningNewEntriesPush([noticeEntry(), noticeEntry({ key: "m:13" })], "fr");

    expect(push.url).toBe("/planning");
    expect(push.body).toContain("Renards");
    expect(push.title).toContain("2");
  });

  it("planningNewEntriesPush_english_englishUrl", () => {
    expect(planningNewEntriesPush([noticeEntry()], "en").url).toBe("/en/planning");
  });

  it("planningAssignedPush_replacement_usesReplacementTitle", () => {
    const push = planningAssignedPush([assignment()], "fr", true);

    expect(push.title).toBe(frPushMessages.planning.assigned.titleReplacement);
  });

  it("planningWithdrawalPush_replacedThenOpen_picksBody", () => {
    const replaced = planningWithdrawalPush(withdrawal({ replaced: true }), "fr");
    const open = planningWithdrawalPush(withdrawal(), "fr");

    expect(replaced.body).not.toBe(open.body);
    expect(replaced.tag).toBe("planning-withdrawal-m:12-CASTER");
  });

  it("planningWithdrawalPush_stillHeld_bodyStillHeld", () => {
    expect(planningWithdrawalPush(withdrawal({ stillHeld: true }), "fr").body).toContain("un autre caster reste affecté");
    expect(planningWithdrawalPush(withdrawal({ stillHeld: true }), "en").body).toContain("another caster is still assigned");
  });

  it("planningWithdrawalPush_selfHeld_bodySelfHeld", () => {
    const notice = withdrawal({ stillHeld: true, selfHeld: true });

    expect(planningWithdrawalPush(notice, "fr").body).toContain("tu restes affecté comme caster");
    expect(planningWithdrawalPush(notice, "en").body).toContain("you remain assigned as caster");
  });

  it("planningUnfilledPush_late_usesLateBody", () => {
    const late = planningUnfilledPush(withdrawal({ late: true }), "fr");
    const early = planningUnfilledPush(withdrawal(), "fr");

    expect(late.body).not.toBe(early.body);
  });

  it("planningPushes_soloEntry_neverWriteEntrantName", () => {
    const solo = noticeEntry({ solo: true, team1Name: "JoueurUn" });

    expect(planningNewEntriesPush([solo], "fr").body).not.toContain("JoueurUn");
    expect(planningWithdrawalPush({ ...solo, role: "PROD", replaced: false, late: false }, "fr").body).not.toContain("JoueurUn");
  });
});

describe("sortie d'un invité par le staff (`released`)", () => {
  it("formatPlanningWithdrawalDm_released_saysRemovedFromSchedule", () => {
    const notice = withdrawal({ released: true, replaced: true });

    expect(formatPlanningWithdrawalDm(notice, SITE, "fr")).toContain("Un caster a été retiré du planning pour");
    expect(formatPlanningWithdrawalDm(notice, SITE, "en")).toContain("A caster was removed from the schedule for");
    expect(formatPlanningWithdrawalDm(notice, SITE, "fr")).not.toContain("désisté");
  });

  it("formatPlanningUnfilledDm_released_saysRemovedFromSchedule", () => {
    const notice = withdrawal({ released: true });

    expect(formatPlanningUnfilledDm(notice, SITE, "fr")).toContain("un caster a été retiré du planning pour");
    expect(formatPlanningUnfilledDm(notice, SITE, "en")).toContain("a caster was removed from the schedule for");
    expect(formatPlanningUnfilledLine(notice, SITE)).toContain("retiré du planning");
  });

  it("planningWithdrawalPush_released_releasedTitleAndBody", () => {
    const notice = withdrawal({ released: true, replaced: true });

    expect(planningWithdrawalPush(notice, "fr")).toMatchObject({ title: "Retrait du planning sur ton match" });
    expect(planningWithdrawalPush(notice, "fr").body).toContain("a été retiré du planning pour");
    expect(planningWithdrawalPush(notice, "en")).toMatchObject({ title: "Removed from the schedule on your match" });
    expect(planningWithdrawalPush(notice, "en").body).toContain("a replacement has been assigned");
  });

  it("planningUnfilledPush_released_releasedBody", () => {
    expect(planningUnfilledPush(withdrawal({ released: true }), "fr").body).toContain("a été retiré du planning pour");
    expect(planningUnfilledPush(withdrawal({ released: true, streamLost: true }), "en").body).toContain(
      "was removed from the schedule for",
    );
    expect(planningUnfilledPush(withdrawal({ released: true, streamLost: true }), "en").body).toContain("the stream is lost");
  });
});

/** Les clés d'un objet de messages, à plat. */
function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

describe("caster placé sur une diffusion sans lien", () => {
  const notice = { ...noticeEntry(), matchId: 12 };

  it("formatPlanningCastLinkDm_fr_saysPlanningAndConfigureButtonWithMatchLink", () => {
    const text = formatPlanningCastLinkDm(notice, SITE, "fr");

    expect(text).toContain("Le planning te place comme caster de ce match");
    expect(text).toContain("« Configurer ma diffusion »");
    expect(text).toContain("Renards");
    expect(text).toContain(`${SITE}/tournois/3`);
    expect(text).not.toContain("/en/");
  });

  it("formatPlanningCastLinkDm_en_englishTextAndEnglishLink", () => {
    const text = formatPlanningCastLinkDm(notice, SITE, "en");

    expect(text).toContain("The planning made you a caster of this match");
    expect(text).toContain("“Configure my broadcast”");
    expect(text).toContain(`${SITE}/en/tournois/3`);
  });

  it("formatPlanningCastLinkDm_soloMatch_noPlayerPseudo", () => {
    const text = formatPlanningCastLinkDm({ ...notice, solo: true, team1Name: "Pseudo1", team2Name: "Pseudo2" }, SITE, "fr");

    expect(text).not.toContain("Pseudo1");
    expect(text).not.toContain("Pseudo2");
  });

  it("planningCastLinkPush_fr_titleBodyUrlAndTag", () => {
    const push = planningCastLinkPush(notice, "fr");

    expect(push.title).toBe(frPushMessages.planning.castLink.title);
    expect(push.body).toContain("« Configurer ma diffusion »");
    expect(push.url).toMatch(/^\/tournois\/3/);
    expect(push.tag).toBe("planning-cast-link-12");
  });

  it("planningCastLinkPush_en_englishTitleAndUrl", () => {
    const push = planningCastLinkPush(notice, "en");

    expect(push.title).toBe(enPushMessages.planning.castLink.title);
    expect(push.body).toContain("“Configure my broadcast”");
    expect(push.url).toMatch(/^\/en\/tournois\/3/);
  });
});

describe("caster autonome réglé par le staff", () => {
  it("formatPlanningSoloCasterDm_turnedOnFr_saysStaffAndLinksPlanning", () => {
    expect(formatPlanningSoloCasterDm(true, "https://bluegenji.test", "fr")).toBe(
      "🎙️ BlueGenji — Le staff a activé ton statut de caster autonome : tu peux diffuser seul, sans prod.\nPlanning : https://bluegenji.test/planning",
    );
  });

  it("formatPlanningSoloCasterDm_turnedOffEn_englishWithEnglishLink", () => {
    expect(formatPlanningSoloCasterDm(false, "https://bluegenji.test", "en")).toBe(
      "🎙️ BlueGenji — The staff turned off your solo caster status: you now need a prod to stream.\nPlanning: https://bluegenji.test/en/planning",
    );
  });

  it("planningSoloCasterPush_turnedOnFr_titleBodyAndPlanningLink", () => {
    expect(planningSoloCasterPush(true, "fr")).toEqual({
      title: "Caster autonome activé",
      body: "Le staff a activé ton statut de caster autonome : tu peux diffuser seul, sans prod.",
      url: "/planning",
      tag: "planning-solo-caster",
    });
  });

  it("planningSoloCasterPush_turnedOffEn_englishTextAndLink", () => {
    expect(planningSoloCasterPush(false, "en")).toMatchObject({
      title: "Solo caster turned off",
      body: "The staff turned off your solo caster status: you now need a prod to stream.",
      url: "/en/planning",
    });
  });
});

describe("textes FR et EN", () => {
  it("planningMessages_withdrawKeys_sameInBothLanguages", () => {
    expect(keys(enPlanning.withdraw)).toEqual(keys(frPlanning.withdraw));
    expect(keys(enPlanning.withdrawals)).toEqual(keys(frPlanning.withdrawals));
    expect(typeof enPlanning.unfilled).toBe("string");
  });

  it("pushMessages_planningKeys_sameInBothLanguages", () => {
    expect(keys(enPushMessages.planning)).toEqual(keys(frPushMessages.planning));
  });

  it("pushTopics_planningTopics_labelledInBothLanguages", () => {
    const planningTopics = Object.keys(PUSH_TOPICS).filter((topic) => topic.startsWith("PLANNING_"));

    expect(planningTopics).toEqual(["PLANNING_NEW_ENTRIES", "PLANNING_ASSIGNED", "PLANNING_WITHDRAWAL", "PLANNING_SOLO_CASTER", "PLANNING_UNFILLED"]);
    expect(Object.keys(enPush.topics)).toEqual(Object.keys(frPush.topics));
  });
});
