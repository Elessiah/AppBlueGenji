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
    expect(frLogin.reactivation.kept).toContain("si ton pseudo a été pris entre-temps, il te revient, raccourci au besoin, suivi de « OG »");
    expect(enLogin.reactivation.kept).toContain("if your username was taken in the meantime, it comes back, shortened if needed, followed by “OG”");
  });
});

// Revue juridique #546 (reprise, cycle 2) : ligne de réactivation et suffixe « OG » déclarés partout.
describe("revue juridique — réactivation journalisée et pseudo « OG »", () => {
  const v9Fr = () => PRIVACY_CHANGES.find((c) => c.id === TERMS_V9_ID)?.details.join("\n") ?? "";
  const v9En = () => PRIVACY_CHANGES_EN[TERMS_V9_ID].details.join("\n");

  it("termsAccount_pseudoTakenCaveat_mentionsOGFrAndEn", () => {
    expect(section(TERMS_SECTIONS, "compte")).toContain("pris malgré tout, il revient, raccourci au besoin, suivi de « OG »");
    expect(section(TERMS_SECTIONS_EN, "compte")).toContain("if taken all the same, it comes back, shortened if needed, followed by “OG”");
  });

  it("privacyChangesV9_deletionDetail_pseudoOGCaveatFrAndEn", () => {
    expect(v9Fr()).toContain("pris malgré tout, le pseudo revient, raccourci au besoin, suivi de « OG »");
    expect(v9En()).toContain("if taken all the same, the username comes back, shortened if needed, followed by “OG”");
  });

  it("privacyChangesV9_dataDetail_reactivationLineCarriesUndoneRequestDateFrAndEn", () => {
    expect(v9Fr()).toContain("par une ligne qui porte la date de celle-ci et celle de la demande défaite");
    expect(v9En()).toContain("by a line carrying the date of the reactivation and that of the undone request");
  });

  it("rgpdPage_reactivationLineAndOGCaveat_frAndEn", () => {
    const fr = readSource("app/rgpd/page.tsx");
    const en = readSource("app/rgpd/RgpdEn.tsx");

    expect(fr).toContain("celle de la demande défaite");
    expect(fr).toContain("le pseudo, raccourci au besoin, suivi de « OG » s&apos;il a tout de même été pris");
    expect(en).toContain("that of the undone request");
    expect(en).toContain("the username, shortened if needed, followed by “OG” if it was taken all the same");
  });

  it("processingRegister_requestedDeletion_reactivationLineDatesRetentionAndOGFrAndEn", () => {
    const fr = PROCESSING_ACTIVITIES.find((a) => a.ref === "T01")?.retention.join("\n") ?? "";
    const en = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T01")?.retention.join("\n") ?? "";

    expect(fr).toContain(
      `une ligne portant sa date et celle de la demande défaite, gardée ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} jours`,
    );
    expect(fr).toContain("rendu, raccourci au besoin, suivi de « OG » s'il a tout de même été pris");
    expect(en).toContain(
      `a line carrying its date and that of the undone request, kept ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} days`,
    );
    expect(en).toContain("given back, shortened if needed, followed by “OG” if it was taken all the same");
  });
});

// Revue juridique #546, cycle 4 : raccourcissement du pseudo, réactivation au
// journal du staff, base de l'empreinte d'un avatar retiré.
describe("revue juridique cycle 4", () => {
  const v9Fr = () => PRIVACY_CHANGES.find((c) => c.id === TERMS_V9_ID)?.details.join("\n") ?? "";
  const v9En = () => PRIVACY_CHANGES_EN[TERMS_V9_ID].details.join("\n");

  it("rgpdPage_staffLog_namesReactivationAndPerTournamentLineForWithdrawalsOnlyFrAndEn", () => {
    expect(readSource("app/rgpd/page.tsx")).toContain("sa réactivation et chaque retrait ou forfait qu&apos;elle entraîne (une ligne par tournoi pour ceux-ci)");
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain("its reactivation and each withdrawal or forfeit it causes (one line per tournament for those)");
  });

  it("privacyChangesV9_staffLog_perTournamentLineForWithdrawalsOnlyFrAndEn", () => {
    expect(v9Fr()).toContain("note les suppressions demandées et leurs réactivations, ainsi que les retraits ou forfaits qu'elles entraînent, en une ligne par tournoi pour ceux-ci");
    expect(v9En()).toContain("records requested deletions and their reactivations, as well as the withdrawals or forfeits they cause, in one line per tournament for those");
  });

  it("processingRegisterT01_avatarHash_hasPurposeFrAndEn", () => {
    const fr = PROCESSING_ACTIVITIES.find((a) => a.ref === "T01")?.subPurposes.join("\n") ?? "";
    const en = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T01")?.subPurposes.join("\n") ?? "";

    expect(fr).toContain("Refuser la remise en ligne, comme avatar ou comme logo d'équipe, d'un avatar supprimé par la modération, par son empreinte (SHA-256) gardée dès cette suppression");
    expect(en).toContain("Refusing the re-upload, as an avatar or as a team logo, of an avatar deleted by moderation, through its hash (SHA-256) kept from that deletion");
  });

  it("processingRegisterT01_avatarHash_dataCategoryNamesAvatarsFrAndEn", () => {
    const fr = PROCESSING_ACTIVITIES.find((a) => a.ref === "T01")?.dataCategories.join(" ") ?? "";
    const en = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T01")?.dataCategories.join(" ") ?? "";

    expect(fr).toContain("Empreintes (SHA-256) des avatars supprimés par la modération, sans lien avec aucun compte");
    expect(en).toContain("Hashes (SHA-256) of avatars deleted by moderation, with no link to any account");
  });

  it("processingRegisterT01_avatarHash_legitimateInterestBasisFrAndEn", () => {
    const fr = PROCESSING_ACTIVITIES.find((a) => a.ref === "T01")?.legalBasis ?? "";
    const en = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T01")?.legalBasis ?? "";

    expect(fr).toContain("intérêt légitime (modération : refuser la remise en ligne d'une image déjà retirée) pour l'empreinte d'un avatar supprimé par la modération");
    expect(en).toContain("legitimate interest (moderation: refusing the re-upload of an image already removed) for the hash of an avatar deleted by moderation");
  });
});

/*
 * ACCOUNT-DELETION (#571, décision D6) : l'empreinte d'un avatar est gardée
 * quand la modération le supprime, plus à l'effacement d'un compte.
 */
const AVATAR_HASH_ID = "2026-11-empreinte-avatar-supprime";
const t01Retention = () => PROCESSING_ACTIVITIES.find((a) => a.ref === "T01")?.retention.join("\n") ?? "";
const t01RetentionEn = () => PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T01")?.retention.join("\n") ?? "";

describe("D6 — empreinte d'un avatar supprimé par la modération", () => {
  it("privacyChange_avatarHashEntry_publishedAtDeployDateForAllAccounts", () => {
    const entry = PRIVACY_CHANGES.find((change) => change.id === AVATAR_HASH_ID);

    expect(entry?.publishedAt).toBe("2026-11-10");
    expect(entry?.audience).toBeUndefined();
    expect(PRIVACY_CHANGES.at(-1)?.id).toBe(AVATAR_HASH_ID);
  });

  it("privacyChange_avatarHashEntry_saysKeptFromModerationDeletionNotErasureFrAndEn", () => {
    const fr = PRIVACY_CHANGES.find((change) => change.id === AVATAR_HASH_ID)!;
    const en = PRIVACY_CHANGES_EN[AVATAR_HASH_ID];

    expect(fr.summary).toContain("gardée dès cette suppression, et non plus à l'effacement du compte");
    expect(fr.details[1]).toContain("À l'effacement d'un compte, plus aucune empreinte n'est prise");
    expect(en.summary).toContain("kept from that deletion, and no longer when the account is erased");
    expect(en.details[1]).toContain("When an account is erased, no hash is taken any more");
    expect(en.details).toHaveLength(fr.details.length);
  });

  it("privacyChange_avatarHashEntry_linksToReportsAndDeletionAnchors", () => {
    const fr = PRIVACY_CHANGES.find((change) => change.id === AVATAR_HASH_ID)!;
    const en = PRIVACY_CHANGES_EN[AVATAR_HASH_ID];

    expect(fr.links?.map((link) => link.href)).toEqual(["/rgpd#signalements", "/rgpd#suppression-du-compte"]);
    expect(en.linkLabels).toHaveLength(2);
  });

  it("registerT01_avatarHashRetention_keptFromDeletionNotForHiddenFrAndEn", () => {
    expect(t01Retention()).toContain("gardée dès cette suppression, sans limite de durée");
    expect(t01Retention()).toContain("un avatar seulement masqué, qui se conteste encore, n'en laisse aucune");
    expect(t01Retention()).not.toContain("emporté par l'effacement d'un compte");
    expect(t01RetentionEn()).toContain("kept from that deletion, without time limit");
    expect(t01RetentionEn()).toContain("an avatar that is only hidden, which can still be contested, leaves none");
    expect(t01RetentionEn()).not.toContain("carried off by the erasure of an account");
  });

  it("registerT01_heldAvatar_moderationCanStillActFrAndEn", () => {
    expect(t01Retention()).toContain("la modération peut encore masquer, rétablir ou supprimer cet avatar");
    expect(t01RetentionEn()).toContain("moderation can still hide, restore or delete that avatar");
  });

  it("rgpdPage_accountDeletion_hashKeptOnModerationDeletionNotErasureFrAndEn", () => {
    const fr = readSource("app/rgpd/page.tsx");
    const en = readSource("app/rgpd/RgpdEn.tsx");

    expect(fr).not.toContain("À l&apos;effacement,\n          l&apos;empreinte");
    expect(fr).toContain("Quand la modération <strong>supprime</strong> un avatar");
    expect(en).not.toContain("On erasure, the hash (SHA-256)");
    expect(en).toContain("When moderation <strong>deletes</strong> an avatar");
  });
});
