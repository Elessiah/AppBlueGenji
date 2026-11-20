/**
 * Revue juridique de PLANNING-ADMIN-COMPUTE : le calcul, la confirmation et les
 * réglages du planning sont réservés aux administrateurs (`canComputePlanning`) ;
 * le « caster autonome » réglé pour un autre revient au staff des tournois
 * (SOLO-CASTER-STAFF), et un compte suspendu ne peut plus y être dit caster
 * autonome. /rgpd (FR et EN) et les fiches T11 et T20 du registre le disent.
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";

const source = (file: string) => readFileSync(join(__dirname, "..", "..", "..", file), "utf8").replace(/\s+/g, " ");

/** Tout le texte d'une fiche du registre (finalités, données, destinataires, durées…). */
function activity(lang: "fr" | "en", ref: string): string {
  const list = lang === "fr" ? PROCESSING_ACTIVITIES : PROCESSING_ACTIVITIES_EN;
  const found = list.find((a) => a.ref === ref);
  if (!found) throw new Error(`activité ${ref} absente`);
  return JSON.stringify(found);
}

describe("/rgpd — planning (FR)", () => {
  const fr = source("app/rgpd/page.tsx");

  it("rgpdFr_planning_confirmationByAdministratorOrSite", () => {
    expect(fr).toContain("jusqu&apos;à leur confirmation, par un administrateur ou d&apos;office par le site");
    expect(fr).toContain("une désignation à la main étant ferme d&apos;emblée");
    expect(fr).toContain("sans compte quand le site agit de lui-même");
  });

  it("rgpdFr_planning_soloCasterSetByCasterOrTournamentStaff", () => {
    expect(fr).not.toContain("ce qu&apos;un administrateur peut régler pour lui");
    expect(fr).toContain("s&apos;il diffuse seul (« caster autonome »), ce que le staff des tournois peut régler pour lui, en l&apos;en prévenant.");
  });

  it("rgpdFr_planning_leadTimeAndConfirmationByAdministrator", () => {
    expect(fr).not.toContain("confirmation par le staff des tournois");
    expect(fr).not.toContain("délai réglé par le staff des tournois");
    expect(fr).toContain("délai réglé par un administrateur");
    expect(fr).toContain("comme d&apos;une confirmation par un administrateur");
  });

  it("rgpdFr_suspension_cannotBeMadeSoloCaster", () => {
    expect(fr).toContain("diffusions perdues) et ne peut plus y être dit caster autonome ; ce qui lui était déjà confirmé");
  });

  it("rgpdFr_planningExport_staffActionsOnAssignments", () => {
    expect(fr).toContain("l&apos;export de vos données le contient, gestes faits comme staff sur les attributions compris.");
  });
});

describe("/rgpd — planning (EN)", () => {
  const en = source("app/rgpd/RgpdEn.tsx");

  it("rgpdEn_planning_confirmationByAdministratorOrSite", () => {
    expect(en).toContain("until confirmed, by an administrator or automatically by the site");
    expect(en).toContain("an assignment by hand being firm at once");
    expect(en).toContain("none when the site acts on its own");
  });

  it("rgpdEn_planning_soloCasterSetByCasterOrTournamentStaff", () => {
    expect(en).not.toContain("which an administrator can set for them");
    expect(en).toContain("whether they stream alone (“solo caster”), which the tournament staff can set for them, letting them know.");
  });

  it("rgpdEn_planning_leadTimeAndConfirmationByAdministrator", () => {
    expect(en).not.toContain("tournament staff confirms them");
    expect(en).not.toContain("a lead time set by the tournament staff");
    expect(en).toContain("a lead time set by an administrator");
    expect(en).toContain("as for a confirmation by an administrator");
  });

  it("rgpdEn_suspension_cannotBeMadeSoloCaster", () => {
    expect(en).toContain("lost streams) and can no longer be made a solo caster there; what was already");
  });

  it("rgpdEn_planningExport_staffActionsOnAssignments", () => {
    expect(en).toContain("the export of your data contains it, actions taken as staff on assignments included.");
  });
});

describe("registre T20", () => {
  it("registerT20_fr_adminConfirmsAndSetsLeadTime", () => {
    const text = activity("fr", "T20");
    expect(text).toContain("jusqu'à leur confirmation, par un administrateur ou d'office par le site");
    expect(text).toContain("délai réglé par un administrateur");
    expect(text).toContain("comme d'une confirmation par un administrateur");
    expect(text).not.toContain("confirmation par le staff des tournois");
  });

  it("registerT20_en_adminConfirmsAndSetsLeadTime", () => {
    const text = activity("en", "T20");
    expect(text).toContain("until confirmed, by an administrator or automatically by the site");
    expect(text).toContain("a lead time set by an administrator");
    expect(text).toContain("as for a confirmation by an administrator");
    expect(text).not.toContain("confirmed by the tournament staff");
  });

  it("registerT20_fr_soloSetByCasterOrTournamentStaff", () => {
    const text = activity("fr", "T20");
    expect(text).toContain("réglage posé par le caster ou par le staff des tournois");
    expect(text).not.toContain("réglage posé par le caster ou par un administrateur");
  });

  it("registerT20_en_soloSetByCasterOrTournamentStaff", () => {
    const text = activity("en", "T20");
    expect(text).toContain("a setting made by the caster or by the tournament staff");
    expect(text).not.toContain("a setting made by the caster or by an administrator");
  });

  it("registerT20_fr_suspendedCannotBeMadeSoloCaster", () => {
    expect(activity("fr", "T20")).toContain("diffusions perdues) et ne peut plus y être dit caster autonome ;");
  });

  it("registerT20_en_suspendedCannotBeMadeSoloCaster", () => {
    expect(activity("en", "T20")).toContain("lost streams) and can no longer be made a solo caster there;");
  });

  it("registerT20_fr_exportStaffActionsOnAssignments", () => {
    expect(activity("fr", "T20")).toContain("les gestes qu'il a faits comme staff sur les attributions (sans l'identifiant de la personne visée)");
  });

  it("registerT20_en_exportStaffActionsOnAssignments", () => {
    expect(activity("en", "T20")).toContain("the actions it took as staff on assignments (without the identifier of the person concerned)");
  });
});

describe("registre T11", () => {
  it("registerT11_fr_suspendedCannotBeMadeSoloCaster", () => {
    expect(activity("fr", "T11")).toContain("diffusions perdues) et ne peut plus y être dit caster autonome ;");
  });

  it("registerT11_en_suspendedCannotBeMadeSoloCaster", () => {
    expect(activity("en", "T11")).toContain("lost streams) and can no longer be made a solo caster there;");
  });
});
