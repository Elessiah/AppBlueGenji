import { describe, expect, it } from "@jest/globals";
import enPush from "@/messages/en/push.json";
import frPush from "@/messages/fr/push.json";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN, REGISTER_UPDATED_AT } from "@/lib/shared/processing-register";
import { PUSH_TOPICS } from "@/lib/shared/push-notifications";
import { readSource } from "../../helpers/read-source";

/**
 * SCHEDULE-DEADLINE, revue juridique 1 : textes légaux généraux (ni règle
 * d'heure par défaut ni mécanique du calcul), double forfait possible et non
 * certain, sujet push qui coupe aussi le message privé, auteur du staff dans
 * les seuls journaux du serveur, tout créneau du planning confirmé d'office.
 */
const ENTRY_ID = "2026-11-date-butoir-planification";
const entryFr = PRIVACY_CHANGES.find((c) => c.id === ENTRY_ID);
const entryEn = PRIVACY_CHANGES_EN[ENTRY_ID];
const flat = (text: string) => text.replace(/&apos;/g, "'").replace(/\s+/g, " ");
const rgpdFr = flat(readSource("app/rgpd/page.tsx"));
const rgpdEn = flat(readSource("app/rgpd/RgpdEn.tsx"));
const registerFr = JSON.stringify(PROCESSING_ACTIVITIES);
const registerEn = JSON.stringify(PROCESSING_ACTIVITIES_EN);
const entryTextFr = [entryFr?.summary ?? "", ...(entryFr?.details ?? [])].join(" ");
const entryTextEn = [entryEn?.summary ?? "", ...(entryEn?.details ?? [])].join(" ");

const activity = (activities: typeof PROCESSING_ACTIVITIES, ref: string) => activities.find((a) => a.ref === ref);

describe("entrée PRIVACY_CHANGES de la date butoir de planification", () => {
  it("privacyChange_deadlineEntry_followedByImpersonationAndGuestsDated20261121WithEnParity", () => {
    // Suivie de l'incarnation d'un rôle (ROLE-IMPERSONATE), puis des invités du planning (PLANNING-GUESTS).
    expect(PRIVACY_CHANGES.at(-7)?.id).toBe(ENTRY_ID);
    expect(entryFr?.publishedAt).toBe("2026-11-21");
    expect(REGISTER_UPDATED_AT >= "2026-11-21").toBe(true);
    expect(entryEn?.details).toHaveLength(entryFr?.details.length ?? -1);
    expect(entryEn?.linkLabels).toHaveLength(entryFr?.links?.length ?? -1);
  });

  it("privacyChange_deadlineEntry_forfeitWordedAsPossibleFrAndEn", () => {
    expect(entryFr?.summary).toContain("le match peut être clos en double forfait");
    expect(entryEn?.summary).toContain("the match may be closed as a double forfeit");
    expect(entryTextFr).not.toContain("le match est clos");
    expect(entryTextEn).not.toContain("the match is closed");
  });

  it("privacyChange_deadlineEntry_topicAlsoCutsDmAndStaffInServerLogsFrAndEn", () => {
    expect(entryTextFr).toContain("« Date butoir de planification », qui coupe aussi ces messages privés");
    expect(entryTextFr).toContain("sans nommer son auteur ; les journaux du serveur gardent son auteur (T05)");
    expect(entryTextEn).toContain("“Scheduling deadline” topic, which also turns these direct messages off");
    expect(entryTextEn).toContain("without naming its author; the server logs keep its author (T05)");
  });
});

describe("textes légaux généraux", () => {
  it.each([
    ["/rgpd FR", rgpdFr],
    ["/rgpd EN", rgpdEn],
    ["registre FR", registerFr],
    ["registre EN", registerEn],
    ["entrée FR", entryTextFr],
    ["entrée EN", entryTextEn],
  ])("legalTexts_deadline_noDefaultHourNorPlannerMechanics (%s)", (_name, text) => {
    expect(text).not.toMatch(/par défaut 21:00|by default 21:00/);
    expect(text).not.toMatch(/le calcul refait d'abord|the calculation first redoes|propositions provisoires de la semaine autour/);
  });

  it("legalTexts_autoConfirm_coversEverySlotNotOnlyMatch", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T20")?.subPurposes.join(" ")).toContain("Confirmer d'office chaque créneau du planning");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T20")?.subPurposes.join(" ")).toContain("Automatically confirming each schedule slot");
    expect(rgpdFr).toContain("Chaque créneau du planning se confirme d'office");
    expect(rgpdEn).toContain("Each schedule slot is confirmed automatically");
    expect(entryTextFr).toContain("chaque créneau s'y confirme désormais d'office");
    expect(entryTextEn).toContain("each slot is now confirmed automatically");
    expect(entryTextFr).not.toContain("créneau de match");
  });
});

describe("registre", () => {
  it("register_deadline_noticeRecordsListPairingAndDelivery", () => {
    const fr = activity(PROCESSING_ACTIVITIES, "T04")?.dataCategories.join(" ") ?? "";
    const en = activity(PROCESSING_ACTIVITIES_EN, "T04")?.dataCategories.join(" ") ?? "";
    expect(fr).toContain("traces de ses avis (match et affiche, palier");
    expect(fr).toContain("remise ou non");
    expect(en).toContain("records of its notices (match and pairing, step");
    expect(en).toContain("whether it was delivered");
  });

  it("register_deadline_staffTraceabilityListsDeadlines", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T05")?.subPurposes.join(" ")).toContain(
      "horaires de match et dates butoirs de planification posés, changés ou retirés",
    );
    expect(activity(PROCESSING_ACTIVITIES_EN, "T05")?.subPurposes.join(" ")).toContain(
      "match times and scheduling deadlines set, changed or removed",
    );
  });
});

describe("/rgpd", () => {
  it("rgpdPage_deadline_topicCutsDmAndStaffSentenceFrAndEn", () => {
    expect(rgpdFr).toContain("le sujet push « Date butoir de planification » coupe aussi ces messages privés");
    expect(rgpdFr).toContain(
      "Une date butoir de planification posée, changée ou retirée par le staff est notée au journal du staff sur Discord (le tournoi et le match) sans nommer son auteur ; les journaux du serveur gardent son auteur",
    );
    expect(rgpdEn).toContain("the “Scheduling deadline” push topic also turns these direct messages off");
    expect(rgpdEn).toContain(
      "A scheduling deadline set, changed or removed by the staff is noted in the staff log on Discord (the tournament and the match) without naming its author; the server logs keep its author",
    );
  });
});

describe("sujet push SCHEDULE_DEADLINE", () => {
  it("pushTopic_scheduleDeadline_namesStaffAndLeadersNotReferees", () => {
    const fr = frPush.topics.SCHEDULE_DEADLINE.description;
    const en = enPush.topics.SCHEDULE_DEADLINE.description;
    expect(fr).toContain("Un match que tu mènes (capitaine, manager, propriétaire, ou joueur d'un tournoi individuel) a reçu du staff");
    expect(en).toContain("A match you lead (captain, manager or owner, or player of a solo tournament) was given a deadline by the staff");
    expect(PUSH_TOPICS.SCHEDULE_DEADLINE.description).toBe(fr);
    expect(fr).not.toMatch(/l'arbitrage|Ton équipe gère/);
    expect(en).not.toMatch(/the referees|Your team manages/);
  });
});
