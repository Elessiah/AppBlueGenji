/**
 * Revue juridique de PLANNING-ADMIN-COMPUTE : le calcul, la confirmation, les
 * réglages du planning et le « caster autonome » réglé pour un autre sont
 * réservés aux administrateurs (`canComputePlanning`). /rgpd (FR et EN) et la
 * fiche T20 du registre le disent, sans plus nommer le staff des tournois
 * comme celui qui confirme ou règle.
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";

const source = (file: string) => readFileSync(join(__dirname, "..", "..", "..", file), "utf8").replace(/\s+/g, " ");

function t20(lang: "fr" | "en"): string {
  const list = lang === "fr" ? PROCESSING_ACTIVITIES : PROCESSING_ACTIVITIES_EN;
  const found = list.find((a) => a.ref === "T20");
  if (!found) throw new Error("activité T20 absente");
  return [...found.subPurposes, ...found.dataCategories].join(" ");
}

describe("/rgpd — planning (FR)", () => {
  const fr = source("app/rgpd/page.tsx");

  it("rgpdFr_planning_confirmationByAdministratorOrSite", () => {
    expect(fr).toContain("jusqu&apos;à leur confirmation, par un administrateur ou d&apos;office par le site");
    expect(fr).toContain("une désignation à la main étant ferme d&apos;emblée");
    expect(fr).toContain("sans compte quand le site agit de lui-même");
  });

  it("rgpdFr_planning_noTournamentStaffAsConfirmerOrSetter", () => {
    expect(fr).not.toContain("confirmation par le staff des tournois");
    expect(fr).not.toContain("délai réglé par le staff des tournois");
    expect(fr).not.toContain("staff des tournois peut régler pour lui");
    expect(fr).toContain("ce qu&apos;un administrateur peut régler pour lui");
    expect(fr).toContain("délai réglé par un administrateur");
    expect(fr).toContain("comme d&apos;une confirmation par un administrateur");
  });
});

describe("/rgpd — planning (EN)", () => {
  const en = source("app/rgpd/RgpdEn.tsx");

  it("rgpdEn_planning_confirmationByAdministratorOrSite", () => {
    expect(en).toContain("until confirmed, by an administrator or automatically by the site");
    expect(en).toContain("an assignment by hand being firm at once");
    expect(en).toContain("none when the site acts on its own");
  });

  it("rgpdEn_planning_noTournamentStaffAsConfirmerOrSetter", () => {
    expect(en).not.toContain("tournament staff confirms them");
    expect(en).not.toContain("a lead time set by the tournament staff");
    expect(en).not.toContain("which the tournament staff can set for them");
    expect(en).toContain("which an administrator can set for them");
    expect(en).toContain("a lead time set by an administrator");
    expect(en).toContain("as for a confirmation by an administrator");
  });
});

describe("registre T20", () => {
  it("registerT20_fr_adminConfirmsSetsSoloAndLeadTime", () => {
    const text = t20("fr");
    expect(text).toContain("jusqu'à leur confirmation, par un administrateur ou d'office par le site");
    expect(text).toContain("réglage posé par le caster ou par un administrateur");
    expect(text).toContain("délai réglé par un administrateur");
    expect(text).toContain("comme d'une confirmation par un administrateur");
    expect(text).not.toContain("confirmation par le staff des tournois");
  });

  it("registerT20_en_adminConfirmsSetsSoloAndLeadTime", () => {
    const text = t20("en");
    expect(text).toContain("until confirmed, by an administrator or automatically by the site");
    expect(text).toContain("a setting made by the caster or by an administrator");
    expect(text).toContain("a lead time set by an administrator");
    expect(text).toContain("as for a confirmation by an administrator");
    expect(text).not.toContain("confirmed by the tournament staff");
  });
});
