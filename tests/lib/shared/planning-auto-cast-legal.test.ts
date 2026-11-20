import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN, REGISTER_UPDATED_AT } from "@/lib/shared/processing-register";
import { readSource } from "../../helpers/read-source";

/**
 * PLANNING-AUTO-CAST (`docs/features/CAST_PLANNING.md` § Placement sur le
 * match) : le planning place casters et prod sur un match sans cast, et les en
 * retire avec l'attribution quittée — tel que l'historique, le registre (T16,
 * T20) et `/rgpd` (FR et EN) le déclarent.
 */
const ENTRY_ID = "2026-11-planning-place-le-cast";

function frEntry() {
  const found = PRIVACY_CHANGES.find((change) => change.id === ENTRY_ID);
  if (!found) throw new Error(`entrée ${ENTRY_ID} absente`);
  return found;
}

function sheet(list: typeof PROCESSING_ACTIVITIES, ref: string) {
  const found = list.find((entry) => entry.ref === ref);
  if (!found) throw new Error(`${ref} absente`);
  return found;
}

const page = (path: string) => readSource(path).replace(/\s+/g, " ");

describe("historique des changements — placement par le planning", () => {
  it("planningPlacementEntry_lastEntry_datedWithRegisterForEveryAccount", () => {
    expect(PRIVACY_CHANGES.at(-1)?.id).toBe(ENTRY_ID);
    expect(frEntry().publishedAt).toBe(REGISTER_UPDATED_AT);
    // Une prod sans permission `live` est placée aussi : l'entrée vise tout le monde.
    expect(frEntry().audience).toBeUndefined();
    expect(frEntry().asksTermsAcceptance).toBeUndefined();
  });

  it("planningPlacementEntry_frAndEn_outsideScheduleAndLegitimateInterest", () => {
    const en = PRIVACY_CHANGES_EN[ENTRY_ID];

    expect(frEntry().summary).toContain("Quand personne ne caste encore un match en dehors du planning");
    expect(en.summary).toContain("When nobody casts a match yet outside the schedule");
    expect(frEntry().details.join(" ")).toContain("Base : l'intérêt légitime de l'association, comme pour le planning, avec droit d'opposition.");
    expect(en.details.join(" ")).toContain("Basis: the association's legitimate interest, as for the schedule, with a right to object.");
    expect(frEntry().details.join(" ")).not.toContain("inchangée");
  });

  it("planningPlacementEntry_linksRegisterT20AndT16", () => {
    expect(frEntry().links?.map((link) => link.href)).toEqual(["/rgpd/registre#t20", "/rgpd/registre#t16"]);
  });

  it("planningPlacementEntry_english_sameShape", () => {
    const en = PRIVACY_CHANGES_EN[ENTRY_ID];

    expect(en.details).toHaveLength(frEntry().details.length);
    expect(en.linkLabels).toHaveLength(frEntry().links?.length ?? -1);
  });

  it("planningPlacementEntry_frAndEn_releaseOnLeavingAndSelfSignupKept", () => {
    const fr = frEntry().details.join(" ");
    const en = PRIVACY_CHANGES_EN[ENTRY_ID].details.join(" ");

    expect(fr).toContain("pour la retirer quand la personne quitte son attribution (désistement, retrait à la main par le staff), sauf sur un match joué");
    expect(fr).toContain("Une inscription faite par le caster lui-même, ou une prod prise par la personne ou posée par le staff depuis le match, n'est jamais touchée");
    expect(en).toContain("to remove it when the person leaves their assignment (withdrawal, removal by hand by the staff), except on a played match");
    expect(en).toContain("A signup made by the caster themselves, or a prod taken by the person or set by the staff from the match, is never touched");
  });

  it("planningPlacementEntry_frAndEn_noticesAndAnonymousStaffLog", () => {
    const fr = frEntry().details.join(" ");
    const en = PRIVACY_CHANGES_EN[ENTRY_ID].details.join(" ");

    expect(fr).toContain("un caster placé sur une diffusion encore sans lien est invité à donner celui de sa chaîne");
    expect(fr).toContain("sans nommer personne");
    expect(en).toContain("a caster placed on a stream with no link yet is asked to add their channel's");
    expect(en).toContain("without naming anyone");
  });
});

describe("registre — T16 et T20 déclarent le placement", () => {
  it("registerT20_frAndEn_placementSubPurpose", () => {
    expect(sheet(PROCESSING_ACTIVITIES, "T20").subPurposes.join(" ")).toContain(
      "Placer sur un match que personne ne caste encore en dehors du planning",
    );
    expect(sheet(PROCESSING_ACTIVITIES_EN, "T20").subPurposes.join(" ")).toContain(
      "Placing on a match nobody casts yet outside the schedule",
    );
  });

  it("registerT20_frAndEn_logsNameAccountsAndGuestKeepsPlacedSeat", () => {
    const fr = sheet(PROCESSING_ACTIVITIES, "T20").subPurposes.join(" ");
    const en = sheet(PROCESSING_ACTIVITIES_EN, "T20").subPurposes.join(" ");

    expect(fr).toContain("le staff auteur et les comptes visés dans les journaux du serveur");
    expect(en).toContain("the acting staff and the accounts concerned in the server logs");
    expect(fr).toContain("comme un désistement (remplaçant cherché de même, sa place déjà posée sur un match restant)");
    expect(en).toContain("as a withdrawal would (a replacement looked for alike, a place already set on a match staying)");
  });

  it("registerT05_frAndEn_scheduleCastsAndServerLogTrace", () => {
    const fr = sheet(PROCESSING_ACTIVITIES, "T05");
    const en = sheet(PROCESSING_ACTIVITIES_EN, "T05");

    expect(fr.subPurposes.join(" ")).toContain("son retrait (par lui-même, par le staff, par le planning ou d'office, avec le motif)");
    expect(en.subPurposes.join(" ")).toContain("its removal (by themselves, by the staff, by the schedule or automatically, with the reason)");
    expect(fr.subPurposes.join(" ")).not.toContain("sans trace dans les journaux du serveur");
    expect(en.subPurposes.join(" ")).not.toContain("without any trace in the server logs");
    expect(fr.subPurposes.join(" ")).toContain("que le staff ou le planning place ou retire, que le staff remplace");
    expect(en.subPurposes.join(" ")).toContain("whom the staff or the schedule places or removes, whom the staff replaces");
  });

  it("registerT05_frAndEn_castersDesignatedInServerLogs", () => {
    const fr = JSON.stringify(sheet(PROCESSING_ACTIVITIES, "T05"));
    const en = JSON.stringify(sheet(PROCESSING_ACTIVITIES_EN, "T05"));

    expect(fr).toContain("désignés dans les journaux du serveur par l'identifiant de leur compte quand le staff les place ou les retire par le planning");
    expect(en).toContain("designated in the server logs by their account identifier when the staff places or removes them through the schedule");
    expect(fr).toContain("ou un caster qu'il place ou retire par le planning, est désigné dans les journaux du serveur");
    expect(en).toContain("or a caster they place or remove through the schedule, is designated in the server logs");
    expect(fr).toContain("pour un geste du staff sur la prod d'un match, ou sur son cast par le planning :");
    expect(en).toContain("for a staff action on a match's prod, or on its cast through the schedule:");
  });

  it("registerT16_frAndEn_scheduleCasterUnderLegitimateInterest", () => {
    const fr = sheet(PROCESSING_ACTIVITIES, "T16").legalBasis;
    const en = sheet(PROCESSING_ACTIVITIES_EN, "T16").legalBasis;

    expect(fr).not.toContain("auquel le planning l'inscrit");
    expect(en).not.toContain("that the schedule registers them for");
    expect(fr).toContain("pour la prod d'un match et le caster que le planning y place, qui peuvent quitter un match pas encore joué et s'y opposer (art. 21)");
    expect(en).toContain("for a match's prod and the caster the schedule places on it, who can leave a match not yet played and object (art. 21)");
  });

  it("registerT20_frAndEn_linkNoticeDeclared", () => {
    expect(JSON.stringify(sheet(PROCESSING_ACTIVITIES, "T20"))).toContain("aussi d'y donner celui de sa chaîne");
    expect(JSON.stringify(sheet(PROCESSING_ACTIVITIES_EN, "T20"))).toContain("also to add their channel's");
  });

  it("registerT16_frAndEn_plannedMarkDataCategory", () => {
    expect(sheet(PROCESSING_ACTIVITIES, "T16").dataCategories.join(" ")).toContain("Marque d'une inscription de cast posée par le planning (T20)");
    expect(sheet(PROCESSING_ACTIVITIES_EN, "T16").dataCategories.join(" ")).toContain("Mark of a cast signup placed by the schedule (T20)");
    expect(sheet(PROCESSING_ACTIVITIES, "T16").dataCategories.join(" ")).toContain("ou d'une place de prod qu'il a posée");
    expect(sheet(PROCESSING_ACTIVITIES_EN, "T16").dataCategories.join(" ")).toContain("or of a prod place it set");
  });

  it("registerT20_frAndEn_prodTakenOrSetFromTheMatchStays", () => {
    expect(JSON.stringify(sheet(PROCESSING_ACTIVITIES, "T20"))).toContain("ou une prod prise par la personne ou posée par le staff depuis le match, restant");
    expect(JSON.stringify(sheet(PROCESSING_ACTIVITIES_EN, "T20"))).toContain("or a prod taken by the person or set by the staff from the match, staying");
  });

  it("registerT16_frAndEn_prodPlacedByThePlanning", () => {
    expect(JSON.stringify(sheet(PROCESSING_ACTIVITIES, "T16"))).toContain("y est placée par le staff ou par le planning (T20)");
    expect(JSON.stringify(sheet(PROCESSING_ACTIVITIES_EN, "T16"))).toContain("is placed on it by the staff or by the schedule (T20)");
  });
});

describe("/rgpd — placement par le planning, en français et en anglais", () => {
  it("rgpdPages_bothLanguages_declarePlacementAndRelease", () => {
    const fr = page("app/rgpd/page.tsx");
    const en = page("app/rgpd/RgpdEn.tsx");

    expect(fr).toContain("quand personne ne caste encore un match en dehors du planning, les casters et la prod qu&apos;une attribution confirmée ou posée à la main y désigne y sont placés");
    expect(fr).toContain("ces gestes sont notés sans nom au journal du staff sur Discord, le staff auteur et les comptes visés dans les journaux du serveur");
    expect(en).toContain("these actions are noted without names in the staff log on Discord, the acting staff and the accounts concerned in the server logs");
    expect(fr).toContain("une inscription faite par le caster lui-même, ou une prod prise par la personne ou posée par le staff depuis le match, reste");
    expect(en).toContain("when nobody casts a match yet outside the schedule, the casters and the prod that an assignment confirmed or set by hand names for it are placed on it");
    expect(en).toContain("a signup made by the caster themselves, or a prod taken by the person or set by the staff from the match, stays");
  });
});

describe("planning board messages (UI review cycle 1)", () => {
  const load = (lang: string) =>
    JSON.parse(readSource(`messages/${lang}/planning.json`)) as { saved: Record<string, string>; withdraw: Record<string, string>; errors: Record<string, string> };

  it.each(["fr", "en"])("%s: removal from a match toast exists and withdrawal dialogs mention the match", (lang) => {
    const messages = load(lang);
    expect(messages.saved.removedFromMatch).toBeTruthy();
    expect(messages.saved.removedFromMatch).not.toBe(messages.saved.removed);
    expect(messages.withdraw.body.length).toBeGreaterThan(messages.saved.removed.length);
    expect(messages.withdraw.bodyCaster).toBeTruthy();
  });

  it.each(["fr", "en"])("%s: prod-taken and cast-managed refusals point to the planning too", (lang) => {
    const messages = load(lang);
    expect(messages.errors.PLANNING_PROD_TAKEN).toMatch(/planning/i);
    expect(messages.errors.PLANNING_CAST_MANAGED).toMatch(/planning/i);
  });
});
