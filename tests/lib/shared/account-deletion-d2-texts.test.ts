import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { TERMS_SECTIONS } from "@/lib/shared/terms-of-use";
import { TERMS_SECTIONS_EN } from "@/lib/shared/terms-of-use-en";
import frLogin from "@/messages/fr/login.json";
import enLogin from "@/messages/en/login.json";
import frProfile from "@/messages/fr/profile.json";
import enProfile from "@/messages/en/profile.json";
import { readSource } from "../../helpers/read-source";

/*
 * ERASURE-D2 — les textes de la suppression différée, en français et en
 * anglais : écran de réactivation, confirmation, conditions v9, /rgpd et
 * l'historique des changements.
 */

const TERMS_V9_ID = "2026-11-conditions-v9-contacts-et-suppression";
const section = (sections: typeof TERMS_SECTIONS, id: string) =>
  sections.find((s) => s.id === id)?.paragraphs.join("\n") ?? "";

describe("écran de réactivation", () => {
  it("reactivationMessages_frAndEn_sameKeys", () => {
    expect(Object.keys(enLogin.reactivation).sort()).toEqual(Object.keys(frLogin.reactivation).sort());
  });

  it("reactivationMessages_lead_carriesDatePlaceholderInBothLanguages", () => {
    expect(frLogin.reactivation.lead).toContain("{date}");
    expect(enLogin.reactivation.lead).toContain("{date}");
  });

  it("reactivationMessages_notUndone_saysHandoversStay", () => {
    expect(frLogin.reactivation.notUndone).toContain("n'est pas annulé");
    expect(enLogin.reactivation.notUndone).toContain("not undone");
  });
});

describe("confirmation de suppression", () => {
  it("deletionMessages_handoverAndWindow_presentInBothLanguages", () => {
    expect(frProfile.deletion.handover).toBeTruthy();
    expect(enProfile.deletion.handover).toBeTruthy();
    expect(frProfile.deletion.irreversible).toContain("30");
    expect(enProfile.deletion.irreversible).toContain("30");
  });
});

describe("conditions v9 — section « Compte »", () => {
  it("termsAccount_fr_describesThirtyDayWindowAndHandover", () => {
    const fr = section(TERMS_SECTIONS, "compte");

    expect(fr).toContain("définitive qu'au bout de 30 jours");
    expect(fr).toContain("La réactivation ne défait pas ces gestes.");
  });

  it("termsAccount_en_describesThirtyDayWindowAndHandover", () => {
    const en = section(TERMS_SECTIONS_EN, "compte");

    expect(en).toContain("final after 30 days");
    expect(en).toContain("Reactivation does not undo these steps.");
  });
});

describe("/rgpd et historique", () => {
  it("rgpdPage_accountDeletionParagraph_frAndEn", () => {
    expect(readSource("app/rgpd/page.tsx")).toContain('id="suppression-du-compte"');
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain('id="suppression-du-compte"');
  });

  it("rgpdPage_reactivationCookie_listedFrAndEn", () => {
    expect(readSource("app/rgpd/page.tsx")).toContain("<strong>__Host-bg_reactivation</strong>");
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain("<strong>__Host-bg_reactivation</strong>");
  });

  it("privacyChangesV9_detailsDeferredDeletion_frAndEn", () => {
    const fr = PRIVACY_CHANGES.find((c) => c.id === TERMS_V9_ID);

    expect(fr?.details.join("\n")).toContain("ne devient définitive qu'au bout de 30 jours");
    expect(PRIVACY_CHANGES_EN[TERMS_V9_ID].details.join("\n")).toContain("only becomes final after 30 days");
  });
});
