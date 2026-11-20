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
  it("planningPlacementEntry_lastEntry_datedWithRegisterForLiveStaff", () => {
    expect(PRIVACY_CHANGES.at(-1)?.id).toBe(ENTRY_ID);
    expect(frEntry().publishedAt).toBe(REGISTER_UPDATED_AT);
    expect(frEntry().audience).toBe("LIVE_STAFF");
    expect(frEntry().asksTermsAcceptance).toBeUndefined();
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
    expect(fr).toContain("Une inscription faite par le caster lui-même n'est jamais touchée");
    expect(en).toContain("to remove it when the person leaves their assignment (withdrawal, removal by hand by the staff), except on a played match");
    expect(en).toContain("A signup made by the caster themselves is never touched");
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
      "Placer sur un match que personne ne caste encore (ni caster inscrit, ni prod placée)",
    );
    expect(sheet(PROCESSING_ACTIVITIES_EN, "T20").subPurposes.join(" ")).toContain(
      "Placing on a match nobody casts yet (no signed-up caster, no placed prod)",
    );
  });

  it("registerT20_frAndEn_linkNoticeDeclared", () => {
    expect(JSON.stringify(sheet(PROCESSING_ACTIVITIES, "T20"))).toContain("aussi d'y donner celui de sa chaîne");
    expect(JSON.stringify(sheet(PROCESSING_ACTIVITIES_EN, "T20"))).toContain("also to add their channel's");
  });

  it("registerT16_frAndEn_plannedMarkDataCategory", () => {
    expect(sheet(PROCESSING_ACTIVITIES, "T16").dataCategories.join(" ")).toContain("Marque d'une inscription de cast posée par le planning (T20)");
    expect(sheet(PROCESSING_ACTIVITIES_EN, "T16").dataCategories.join(" ")).toContain("Mark of a cast signup placed by the schedule (T20)");
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

    expect(fr).toContain("quand personne ne caste encore un match, les casters et la prod qu&apos;une attribution confirmée ou posée à la main y désigne y sont placés");
    expect(fr).toContain("une inscription faite par le caster lui-même reste");
    expect(en).toContain("when nobody casts a match yet, the casters and the prod that an assignment confirmed or set by hand names for it are placed on it");
    expect(en).toContain("a signup made by the caster themselves stays");
  });
});
