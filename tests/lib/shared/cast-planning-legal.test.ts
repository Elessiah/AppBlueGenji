import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register";
import { readSource } from "../../helpers/read-source";

/**
 * Planning des casts et arbitres (`docs/features/CAST_PLANNING.md`, § RGPD) :
 * ce que l'historique, le registre (T20) et `/rgpd` en disent doit rester vrai
 * face au code — qui lit quoi, le motif masqué en « Calcul », la désignation
 * d'un arbitre de match (journal Discord sans nom), la garde du réglage
 * « caster autonome » liée au rôle caster, l'export des gestes faits comme staff.
 */
const ENTRY_ID = "2026-11-planning-casts-arbitres";

function frEntry() {
  const found = PRIVACY_CHANGES.find((change) => change.id === ENTRY_ID);
  if (!found) throw new Error(`entrée ${ENTRY_ID} absente`);
  return [found.summary, ...found.details].join(" ");
}

function enEntry() {
  const found = PRIVACY_CHANGES_EN[ENTRY_ID];
  return [found.summary, ...found.details].join(" ");
}

function t20(list: typeof PROCESSING_ACTIVITIES) {
  const found = list.find((entry) => entry.ref === "T20");
  if (!found) throw new Error("T20 absente");
  return found;
}

/** Le `<p id="planning">` d'une page `/rgpd`, espaces écrasés. */
function planningParagraph(path: string): string {
  const source = readSource(path);
  const at = source.indexOf('<p id="planning">');
  if (at < 0) throw new Error(`paragraphe planning absent de ${path}`);
  return source.slice(at, source.indexOf("</p>", at)).replace(/\s+/g, " ");
}

describe("planning — historique des changements", () => {
  it("planningEntry_refereeDesignation_declaresAnonymousDiscordLineInBothLanguages", () => {
    expect(frEntry()).toContain("le journal du staff sur Discord le note sans nommer personne");
    expect(frEntry()).toContain("Rien d'autre du planning n'est publié sur Discord.");
    expect(enEntry()).toContain("the staff log on Discord notes it without naming anyone");
    expect(enEntry()).toContain("Nothing else from the schedule is published on Discord.");
  });

  it("planningEntry_neverClaimsNothingIsPublishedOnDiscord", () => {
    expect(frEntry()).not.toContain("Rien n'en est publié sur Discord");
    expect(enEntry()).not.toContain("Nothing about it is published on Discord");
  });

  it("planningEntry_staffReaders_namedRefereesAndAdministrators", () => {
    expect(frEntry()).toContain("seul le staff des tournois (arbitres et administrateurs)");
    expect(enEntry()).toContain("only the tournament staff (referees and administrators)");
  });

  it("planningEntry_calculatedReason_shownAsCalculationToOthers", () => {
    expect(frEntry()).toContain("que comme « Calcul »");
    expect(enEntry()).toContain("only appears as “Calculation”");
  });

  it("planningEntry_soloCasterRetention_tiedToCasterRole", () => {
    expect(frEntry()).toContain("le réglage « caster autonome », tant que le compte tient le rôle caster");
    expect(enEntry()).toContain("the “solo caster” setting, as long as the account holds the caster role");
  });

  it("planningEntry_staffAccount_storedAndExported", () => {
    expect(frEntry()).toContain("avec le compte du staff qui l'a posée");
    expect(frEntry()).toContain("gestes faits comme staff compris");
    expect(enEntry()).toContain("with the staff account that set it");
    expect(enEntry()).toContain("actions taken as staff included");
  });

  it("planningEntry_prodTitle_announcedOnPlayerPage", () => {
    expect(frEntry()).toContain("Le titre « prod » rejoint les titres de rôle de plateforme");
    expect(enEntry()).toContain("The “prod” title joins the platform role titles");
  });

  it("planningEntry_detailsCount_sameInBothLanguages", () => {
    const fr = PRIVACY_CHANGES.find((change) => change.id === ENTRY_ID);
    expect(PRIVACY_CHANGES_EN[ENTRY_ID].details).toHaveLength(fr?.details.length ?? -1);
  });
});

describe("planning — registre T20", () => {
  it("t20_retention_soloCasterTiedToCasterRoleInBothLanguages", () => {
    expect(t20(PROCESSING_ACTIVITIES).retention.join(" ")).toContain("tant que le compte tient le rôle caster");
    expect(t20(PROCESSING_ACTIVITIES_EN).retention.join(" ")).toContain("as long as the account holds the caster role");
  });

  it("t20_retention_exportListsStaffActions", () => {
    expect(t20(PROCESSING_ACTIVITIES).retention.join(" ")).toContain("les gestes qu'il a faits comme staff (sans la personne visée)");
    expect(t20(PROCESSING_ACTIVITIES_EN).retention.join(" ")).toContain("the actions it took as staff (without the person concerned)");
  });

  it("t20_recipients_reasonMaskedAndStaffNamed", () => {
    const fr = t20(PROCESSING_ACTIVITIES).recipients.join(" ");
    const en = t20(PROCESSING_ACTIVITIES_EN).recipients.join(" ");
    expect(fr).toContain("n'y paraît que comme « Calcul »");
    expect(fr).toContain("Staff des tournois (arbitres et administrateurs)");
    expect(en).toContain("only appears there as “Calculation”");
    expect(en).toContain("Tournament staff (referees and administrators)");
  });

  it("t20_recipients_refereeDesignationLoggedWithoutName", () => {
    expect(t20(PROCESSING_ACTIVITIES).recipients.join(" ")).toContain("une ligne sans nom au journal du staff sur Discord");
    expect(t20(PROCESSING_ACTIVITIES_EN).recipients.join(" ")).toContain("a line naming no one in the staff log on Discord");
  });
});

describe("planning — /rgpd", () => {
  it("rgpdPlanning_frParagraph_matchesTheCode", () => {
    const fr = planningParagraph("app/rgpd/page.tsx");
    expect(fr).toContain("le journal du staff sur Discord le note sans nommer personne");
    expect(fr).toContain("par le seul staff des tournois (arbitres et administrateurs)");
    expect(fr).toContain("que comme « Calcul »");
    expect(fr).toContain("quand le compte ne tient plus le rôle caster");
    expect(fr).toContain("gestes faits comme staff compris");
    expect(fr).not.toContain("rien n&apos;en est publié sur Discord");
  });

  it("rgpdPlanning_enParagraph_matchesTheCode", () => {
    const en = planningParagraph("app/rgpd/RgpdEn.tsx");
    expect(en).toContain("the staff log on Discord notes it without naming anyone");
    expect(en).toContain("by the tournament staff only (referees and administrators)");
    expect(en).toContain("as “Calculation”");
    expect(en).toContain("when the account no longer holds the caster role");
    expect(en).toContain("actions taken as staff included");
    expect(en).not.toContain("nothing about it is published on Discord");
  });

  it("rgpdEn_platformRoleList_usesProdLikeTheUi", () => {
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain("(administrator, referee, caster, prod, community");
  });
});
