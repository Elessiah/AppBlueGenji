import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
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

  // Revue juridique #546 : la collecte nouvelle du ticket de réactivation est déclarée.
  it("privacyChangesV9_dataParagraph_declaresReactivationTicketAndCookieFrAndEn", () => {
    const fr = PRIVACY_CHANGES.find((c) => c.id === TERMS_V9_ID)?.details.join("\n") ?? "";
    const en = PRIVACY_CHANGES_EN[TERMS_V9_ID].details.join("\n");

    expect(fr).toContain("ticket de réactivation de 15 minutes (compte, moyen de connexion, échéance et empreinte du jeton)");
    expect(fr).toContain("`__Host-bg_reactivation`");
    expect(en).toContain("15-minute reactivation ticket (account, sign-in method, expiry and token hash)");
    expect(en).toContain("`__Host-bg_reactivation`");
  });

  // Décision R3 du 2026-11-04 : l'écran de réactivation dit le suffixe « OG ».
  it("reactivationMessages_kept_mentionsOGSuffixFrAndEn", () => {
    expect(frLogin.reactivation.kept).toContain("si ton pseudo a été pris entre-temps, il te revient suivi de « OG »");
    expect(enLogin.reactivation.kept).toContain("if your username was taken in the meantime, it comes back followed by “OG”");
  });
});

// Revue juridique #546 (reprise, cycle 2) : ligne de réactivation et suffixe « OG » déclarés partout.
describe("revue juridique — réactivation journalisée et pseudo « OG »", () => {
  const v9Fr = () => PRIVACY_CHANGES.find((c) => c.id === TERMS_V9_ID)?.details.join("\n") ?? "";
  const v9En = () => PRIVACY_CHANGES_EN[TERMS_V9_ID].details.join("\n");

  it("termsAccount_pseudoTakenCaveat_mentionsOGFrAndEn", () => {
    expect(section(TERMS_SECTIONS, "compte")).toContain("pris malgré tout, il revient suivi de « OG »");
    expect(section(TERMS_SECTIONS_EN, "compte")).toContain("if taken all the same, it comes back followed by “OG”");
  });

  it("privacyChangesV9_deletionDetail_pseudoOGCaveatFrAndEn", () => {
    expect(v9Fr()).toContain("pris malgré tout, le pseudo revient suivi de « OG »");
    expect(v9En()).toContain("if taken all the same, the username comes back followed by “OG”");
  });

  it("privacyChangesV9_dataDetail_reactivationLineCarriesUndoneRequestDateFrAndEn", () => {
    expect(v9Fr()).toContain("par une ligne qui porte la date de celle-ci et celle de la demande défaite");
    expect(v9En()).toContain("by a line carrying the date of the reactivation and that of the undone request");
  });

  it("rgpdPage_reactivationLineAndOGCaveat_frAndEn", () => {
    const fr = readSource("app/rgpd/page.tsx");
    const en = readSource("app/rgpd/RgpdEn.tsx");

    expect(fr).toContain("celle de la demande défaite");
    expect(fr).toContain("le pseudo suivi de « OG » s&apos;il a tout de même été pris");
    expect(en).toContain("that of the undone request");
    expect(en).toContain("the username followed by “OG” if it was taken all the same");
  });

  it("processingRegister_requestedDeletion_reactivationLineDatesRetentionAndOGFrAndEn", () => {
    const fr = PROCESSING_ACTIVITIES.find((a) => a.ref === "T01")?.retention.join("\n") ?? "";
    const en = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T01")?.retention.join("\n") ?? "";

    expect(fr).toContain(
      `une ligne portant sa date et celle de la demande défaite, gardée ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} jours`,
    );
    expect(fr).toContain("rendu suivi de « OG » s'il a tout de même été pris");
    expect(en).toContain(
      `a line carrying its date and that of the undone request, kept ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} days`,
    );
    expect(en).toContain("given back followed by “OG” if it was taken all the same");
  });
});
