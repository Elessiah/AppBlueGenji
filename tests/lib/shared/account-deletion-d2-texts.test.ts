import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import { PROCESSING_ACTIVITIES, REGISTER_UPDATED_AT } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
import { TERMS_SECTIONS, TERMS_UPDATED_AT, TERMS_VERSION } from "@/lib/shared/terms-of-use";
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

    // D31 : sans lien dans la liste des images bloquées, lié au compte sur la décision tant qu'il existe.
    expect(fr).toContain("Empreintes (SHA-256) des avatars supprimés par la modération : dans la liste des images bloquées, sans lien avec aucun compte, datée au jour près ; sur la décision de modération (registre T11), liée au compte tant qu'il existe, avec l'issue de sa contestation (maintenue ou acceptée)");
    expect(en).toContain("Hashes (SHA-256) of avatars deleted by moderation: in the list of blocked images, with no link to any account, dated to the day; on the moderation decision (record T11), linked to the account as long as it exists, with the outcome of its challenge (upheld or accepted)");
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
const TERMS_V10_ID = "2026-11-conditions-v10-avatar-et-succession";
const t01Retention = () => PROCESSING_ACTIVITIES.find((a) => a.ref === "T01")?.retention.join("\n") ?? "";
const t01RetentionEn = () => PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T01")?.retention.join("\n") ?? "";

describe("D6 — empreinte d'un avatar supprimé par la modération", () => {
  it("privacyChange_avatarHashEntry_publishedAtDeployDateForAllAccounts", () => {
    const entry = PRIVACY_CHANGES.find((change) => change.id === AVATAR_HASH_ID);

    // Lendemain de la mise en ligne prévue, même jour que la version 10 qui la suit.
    expect(entry?.publishedAt).toBe("2026-11-11");
    expect(entry?.publishedAt).toBe(TERMS_UPDATED_AT);
    expect(entry?.audience).toBeUndefined();
    // Suivies des entrées des salons vocaux (MATCH-VOICE, puis VOICE-CLEAR-TEAM).
    expect(PRIVACY_CHANGES.at(-4)?.id).toBe(AVATAR_HASH_ID);
    expect(PRIVACY_CHANGES.at(-3)?.id).toBe(TERMS_V10_ID);
  });

  it("privacyChange_avatarHashEntry_saysKeptFromModerationDeletionNotErasureFrAndEn", () => {
    const fr = PRIVACY_CHANGES.find((change) => change.id === AVATAR_HASH_ID)!;
    const en = PRIVACY_CHANGES_EN[AVATAR_HASH_ID];

    expect(fr.summary).toContain("gardée dès cette suppression, et non plus à l'effacement du compte");
    expect(fr.details[2]).toContain("seule est prise ou gardée l'empreinte d'un avatar que la modération avait déjà supprimé");
    expect(en.summary).toContain("kept from that deletion, and no longer when the account is erased");
    expect(en.details[2]).toContain("only the hash of an avatar moderation had already deleted is taken or kept");
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
    expect(t01Retention()).toContain("un avatar seulement masqué n'en laisse aucune tant qu'il n'est pas supprimé");
    expect(t01Retention()).not.toContain("emporté par l'effacement d'un compte");
    expect(t01RetentionEn()).toContain("kept from that deletion, without time limit");
    expect(t01RetentionEn()).toContain("an avatar that is only hidden leaves none as long as it is not deleted");
    expect(t01RetentionEn()).not.toContain("carried off by the erasure of an account");
  });

  it("registerT01_avatarHashRetention_namesRejectedChallengeAndSharedFileFrAndEn", () => {
    expect(t01Retention()).toContain("par le staff qui le supprime définitivement après un masquage (contestation rejetée, ou avant l'échéance), ou d'office au terme d'un masquage sans contestation");
    expect(t01Retention()).toContain("supprimé sans délai, son fichier n'est effacé que si rien d'autre sur le site ne le désigne");
    expect(t01RetentionEn()).toContain("by the staff permanently deleting it after a hiding (challenge rejected, or before the deadline), or automatically at the end of a hiding without a challenge");
    expect(t01RetentionEn()).toContain("when deleted immediately, its file is only erased if nothing else on the site points to it");
  });

  it("registerT01_heldAvatar_moderationCanStillActFrAndEn", () => {
    expect(t01Retention()).toContain("la modération peut encore masquer, rétablir ou supprimer cet avatar");
    expect(t01RetentionEn()).toContain("moderation can still hide, restore or delete that avatar");
  });

  it("registerModeration_avatarHash_crossReferencesT01FrAndEn", () => {
    const fr = PROCESSING_ACTIVITIES.flatMap((a) => a.dataCategories).join(" ");
    const en = PROCESSING_ACTIVITIES_EN.flatMap((a) => a.dataCategories).join(" ");

    expect(fr).toContain("sur la décision de suppression d'un avatar, son empreinte (SHA-256) et l'issue de la contestation (maintenue ou acceptée), liées au compte tant qu'il existe ; sur la décision de masquage ou de suppression d'un logo d'équipe, l'issue de la contestation (maintenue ou acceptée) ; l'empreinte reste en outre, sans lien avec aucun compte et sans limite de durée, dans la liste des images bloquées, pour en refuser la remise en ligne (décrite au registre T01)");
    expect(en).toContain("on the decision deleting an avatar, its hash (SHA-256) and the outcome of the challenge (upheld or accepted), linked to the account as long as it exists; on the decision hiding or deleting a team logo, the outcome of the challenge (upheld or accepted); the hash also stays, with no link to any account and without time limit, in the list of blocked images, to refuse it being uploaded again (described in record T01)");
  });

  it("deletionNotice_heldAvatar_reactivationMayNotReturnModeratedAvatarFrAndEn", () => {
    expect(frProfile.deletion.irreversible).toContain("sauf un avatar que la modération aurait masqué ou supprimé entre-temps");
    expect(enProfile.deletion.irreversible).toContain("except an avatar moderation hid or deleted in the meantime");
  });

  it("privacyChange_avatarHashEntry_namesReportDeletionAndHeldAvatarNotReturnedFrAndEn", () => {
    const fr = PRIVACY_CHANGES.find((change) => change.id === AVATAR_HASH_ID)!;
    const en = PRIVACY_CHANGES_EN[AVATAR_HASH_ID];

    expect(fr.details[0]).toContain("sans délai, sur signalement ou depuis la fiche du joueur");
    expect(fr.details[3]).toContain("masqué ou supprimé, il n'est pas rendu à la réactivation");
    expect(en.details[0]).toContain("immediately, on a report or from the player's page");
    expect(en.details[3]).toContain("once hidden or deleted, it is not given back on reactivation");
  });

  it("registerT01_heldAvatar_hiddenNotReturnedOnReactivationFrAndEn", () => {
    expect(t01Retention()).toContain("masqué, il suit la règle des signalements et n'est pas rendu à la réactivation");
    expect(t01RetentionEn()).toContain("once hidden, it follows the reports rule and is not given back on reactivation");
  });

  it("deletionNotice_handover_suspendedMemberInheritsLastFrAndEn", () => {
    expect(frProfile.deletion.handover).toContain("un membre suspendu ne passant qu'après tous les autres");
    expect(enProfile.deletion.handover).toContain("a suspended member coming only after all the others");
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

/*
 * ACCOUNT-DELETION (#571) : D22 (issue de la contestation gardée), D30 (avatar
 * jamais supprimé par la modération : jamais bloqué), D31 (empreinte liée au
 * compte tant qu'il existe, seule à l'effacement), D12 (conditions v10).
 */
const termsSection = (id: string) => TERMS_SECTIONS.find((section) => section.id === id)?.paragraphs.join(" ") ?? "";
const termsSectionEn = (id: string) => TERMS_SECTIONS_EN.find((section) => section.id === id)?.paragraphs.join(" ") ?? "";

describe("D22, D30, D31 — empreinte liée à la décision tant que le compte existe", () => {
  it("registerT01_avatarHashRetention_linkedToDecisionUntilErasureFrAndEn", () => {
    expect(t01Retention()).toContain("tant que le compte existe (anonymisé compris), elle est aussi gardée sur la décision de modération qui la consigne");
    expect(t01Retention()).toContain("puis effacée avec ces décisions à l'effacement du compte, le blocage devenant définitif");
    expect(t01Retention()).toContain("qui ne désigne aucun compte et ne date un blocage qu'au jour près");
    expect(t01RetentionEn()).toContain("as long as the account exists (anonymized included), it is also kept on the moderation decision that records it");
    expect(t01RetentionEn()).toContain("then erased with those decisions when the account is erased, the block becoming permanent");
    expect(t01RetentionEn()).toContain("which designates no account and only dates a block to the day");
  });

  it("registerT01_avatarHashRetention_contestOutcomeUpheldKeepsAcceptedLiftsFrAndEn", () => {
    expect(t01Retention()).toContain("maintenue, le blocage reste ; acceptée après une suppression décidée sur un signalement ou après un masquage, il est levé, sauf si une autre suppression de la même image le justifie encore");
    expect(t01RetentionEn()).toContain("upheld, the block stays; accepted after a deletion decided on a report or after a hiding, it is lifted, unless another deletion of the same image still justifies it");
  });

  it("registerT01_neverDeletedAvatar_leavesNoHashFrAndEn", () => {
    expect(t01Retention()).toContain("un avatar que la modération n'a jamais supprimé n'en laisse aucune (ni à la demande de suppression, ni à l'anonymisation ou à l'effacement)");
    expect(t01RetentionEn()).toContain("an avatar moderation never deleted leaves none (neither on the deletion request, nor on anonymization or erasure)");
  });

  it("registerT11_decisionRetention_untilAccountErasedFrAndEn", () => {
    const fr = PROCESSING_ACTIVITIES.find((a) => a.ref === "T11")?.retention.join("\n") ?? "";
    const en = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T11")?.retention.join("\n") ?? "";

    expect(fr).toContain("Décision de suppression d'un avatar (empreinte, issue de la contestation) : tant que le compte existe, anonymisé compris ; effacée avec le compte");
    expect(en).toContain("Decision deleting an avatar (hash, outcome of the challenge): as long as the account exists, anonymized included; erased with the account");
  });

  it("registerUpdatedAt_advancedWithThisChange", () => {
    expect(REGISTER_UPDATED_AT >= "2026-11-11").toBe(true);
  });

  it("privacyChange_avatarHashEntry_saysLinkUntilErasureAndOutcomeFrAndEn", () => {
    const fr = PRIVACY_CHANGES.find((change) => change.id === AVATAR_HASH_ID)!;
    const en = PRIVACY_CHANGES_EN[AVATAR_HASH_ID];

    expect(fr.details[0]).not.toContain("sans lien avec aucun compte et sans limite de durée");
    expect(fr.details[0]).toContain("dans une liste d'images bloquées qui ne désigne aucun compte et ne date un blocage qu'au jour près");
    expect(fr.details[1]).toContain("Tant que le compte existe (anonymisé compris), l'empreinte est aussi gardée sur la décision de suppression");
    expect(fr.details[1]).toContain("seule l'empreinte reste, sans lien avec aucun compte");
    expect(fr.details[2]).toContain("comme un avatar que la modération n'a jamais supprimé");
    expect(en.details[0]).toContain("in a list of blocked images that designates no account and only dates a block to the day");
    expect(en.details[1]).toContain("As long as the account exists (anonymized included), the hash is also kept on the deletion decision");
    expect(en.details[1]).toContain("only the hash remains, with no link to any account");
    expect(en.details[2]).toContain("like an avatar moderation never deleted");
  });

  it("rgpd_reportsSection_linkUntilErasureAndOutcomeFrAndEn", () => {
    const fr = readFileSync(join(process.cwd(), "app/rgpd/page.tsx"), "utf8").replace(/\s+/g, " ");
    const en = readFileSync(join(process.cwd(), "app/rgpd/RgpdEn.tsx"), "utf8").replace(/\s+/g, " ");

    expect(fr).toContain("Tant que le compte existe (anonymisé compris), l&apos;empreinte est aussi gardée sur la décision de suppression");
    expect(fr).toContain("seule l&apos;empreinte reste, sans lien avec aucun compte");
    expect(fr).toContain("un avatar que la modération n&apos;a jamais supprimé part sans laisser d&apos;empreinte");
    expect(fr).not.toContain("est gardée, sans limite de durée et sans lien avec aucun compte");
    expect(en).toContain("As long as the account exists (anonymized included), the hash is also kept on the deletion decision");
    expect(en).toContain("only the hash remains, with no link to any account");
    expect(en).toContain("avatar moderation never deleted goes without leaving any hash");
    expect(en).not.toContain("when the staff after a hiding");
  });
});

describe("D12 — conditions d'utilisation, version 10", () => {
  it("terms_v10_versionAndDate", () => {
    expect(TERMS_VERSION).toBe(10);
    expect(TERMS_UPDATED_AT).toBe("2026-11-11");
  });

  it("terms_account_suspendedPlayerInheritsLastAndHeldAvatarFrAndEn", () => {
    expect(termsSection("compte")).toContain("sinon à un autre joueur de l'équipe, un joueur suspendu ne passant qu'après tous les autres");
    expect(termsSection("compte")).toContain("et son avatar, sauf s'il est alors masqué ou supprimé par la modération");
    expect(termsSectionEn("compte")).toContain("else another player of the team, a suspended player only coming after all the others");
    expect(termsSectionEn("compte")).toContain("and its avatar, unless moderation has hidden or deleted it by then");
  });

  it("terms_account_onlyDeletedAvatarBlockedFrAndEn", () => {
    expect(termsSection("compte")).toContain("seul un avatar que la modération a **supprimé** ne peut plus être reposé");
    expect(termsSection("compte")).not.toContain("un avatar retiré par la modération que l'effacement emporte");
    expect(termsSectionEn("compte")).toContain("only an avatar that moderation has **deleted** can no longer be uploaded again");
    expect(termsSectionEn("compte")).not.toContain("an avatar removed by moderation that the erasure carries off");
  });

  it("terms_reports_hashKeptAndAcceptedChallengeLiftsFrAndEn", () => {
    expect(termsSection("signalement")).toContain("Quand la modération **supprime** un avatar, l'empreinte de l'image est gardée");
    expect(termsSection("signalement")).toContain("acceptée après une suppression décidée sur un signalement ou après un masquage, il est levé");
    expect(termsSectionEn("signalement")).toContain("When moderation **deletes** an avatar, the hash of the image is kept");
    expect(termsSectionEn("signalement")).toContain("accepted after a deletion decided on a report or after a hiding, it is lifted");
  });

  it("privacyChange_termsV10_asksAcceptanceDatedWithTermsFrAndEn", () => {
    const fr = PRIVACY_CHANGES.find((change) => change.id === TERMS_V10_ID)!;
    const en = PRIVACY_CHANGES_EN[TERMS_V10_ID];

    expect(fr.publishedAt).toBe(TERMS_UPDATED_AT);
    expect(fr.asksTermsAcceptance).toBe(true);
    expect(fr.audience).toBeUndefined();
    expect(fr.title.startsWith("Conditions d'utilisation : version 10")).toBe(true);
    expect(fr.details.at(-1)).toContain("la version 10, en vigueur depuis le 11 novembre 2026");
    expect(en.details.at(-1)).toContain("version 10, in force since 11 November 2026");
    expect(en.details).toHaveLength(fr.details.length);
    expect(en.linkLabels).toHaveLength(fr.links?.length ?? 0);
    expect(fr.links?.map((link) => link.href)).toEqual(["/conditions-utilisation#compte", "/conditions-utilisation#signalement", "/conditions-utilisation#retransmission", "/conditions-utilisation#contacts-de-match"]);
  });

  it("privacyChange_termsV10_linksAndDetailNameMatchContactsFrAndEn", () => {
    const fr = PRIVACY_CHANGES.find((change) => change.id === TERMS_V10_ID)!;
    const en = PRIVACY_CHANGES_EN[TERMS_V10_ID];

    expect(fr.details.at(-2)).toContain("Contacts de match : les salons vocaux d'équipe sont ouverts à qui voit la catégorie des matchs");
    expect(fr.details.at(-2)).toContain("dont le bot déconnecte les occupants sans garder qui ils sont");
    expect(fr.details.at(-1)).toContain("« Retransmission des matchs » et « Contacts de match »");
    expect(en.details.at(-2)).toContain("Match contacts: team voice channels are open to whoever sees the match category");
    expect(en.details.at(-2)).toContain("whose occupants the bot disconnects without keeping who they are");
    expect(en.details.at(-1)).toContain("“Match streaming” and “Match contacts” sections");
    expect(en.linkLabels?.at(-1)).toBe("Read the “Match contacts” section");
  });
});

// Revue juridique #571, cycle 1 : limites du blocage levable, suppression
// d'office en attente d'issue, blocages d'avant la version 10, logos.
describe("revue juridique #571 — blocages déclarés au plus juste", () => {
  const fr = PRIVACY_CHANGES.find((c) => c.id === "2026-11-empreinte-avatar-supprime");
  const en = PRIVACY_CHANGES_EN["2026-11-empreinte-avatar-supprime"];
  const t01 = (list: typeof PROCESSING_ACTIVITIES) => list.find((a) => a.ref === "T01");

  it("registerT01_purpose_liftOnlyAfterReportDeletionWhileAccountExistsFrAndEn", () => {
    expect(t01(PROCESSING_ACTIVITIES)?.subPurposes.join(" ")).toContain(
      "lever ce blocage quand la contestation d'une suppression décidée sur un signalement ou après un masquage est acceptée, tant que le compte n'est pas effacé",
    );
    expect(t01(PROCESSING_ACTIVITIES_EN)?.subPurposes.join(" ")).toContain(
      "lifting that block when the challenge to a deletion decided on a report or after a hiding is accepted, as long as the account is not erased",
    );
  });

  it("registerT01_retention_pendingChallengeAndLegacyErasureBlocksFrAndEn", () => {
    const frText = t01(PROCESSING_ACTIVITIES)?.retention.join(" ") ?? "";
    const enText = t01(PROCESSING_ACTIVITIES_EN)?.retention.join(" ") ?? "";
    expect(frText).toContain("une suppression d'office faite alors que sa contestation attendait encore son issue ne bloque l'image qu'une fois maintenue, ou à l'effacement du compte s'il vient avant, alors définitivement");
    expect(frText).toContain("les empreintes posées à l'effacement d'un compte avant le 11 novembre 2026 — alors aussi celles d'un avatar seulement masqué — restent bloquées");
    expect(frText).toContain("(suppression sur signalement ou après un masquage)");
    expect(frText).not.toContain("au terme d'un masquage)");
    expect(enText).toContain("an automatic deletion made while its challenge was still awaiting its outcome only blocks the image once upheld");
    expect(enText).toContain("hashes set on the erasure of an account before November 11, 2026");
    expect(enText).toContain("(deletion on a report or after a hiding)");
  });

  it("privacyChange_avatarHashEntry_pendingChallengeAndLegacyBlocksFrAndEn", () => {
    expect(fr?.details?.[1]).toContain("Une suppression d'office faite alors que sa contestation attendait encore son issue ne bloque l'image qu'une fois maintenue");
    expect(fr?.details?.[1]).toContain("prise sur un signalement ou après un masquage");
    expect(fr?.details?.[4]).toContain("avant le 11 novembre 2026");
    expect(en?.details?.[1]).toContain("An automatic deletion made while its challenge was still awaiting its outcome only blocks the image once upheld");
    expect(en?.details?.[1]).toContain("taken on a report or after a hiding");
    expect(en?.details?.[4]).toContain("before November 11, 2026");
    expect(en?.details).toHaveLength(fr?.details?.length ?? -1);
  });

  it("rgpdPages_signalements_pendingChallengeAndLegacyBlocksFrAndEn", () => {
    const frPage = readFileSync(join(process.cwd(), "app", "rgpd", "page.tsx"), "utf8").replace(/\s+/g, " ");
    const enPage = readFileSync(join(process.cwd(), "app", "rgpd", "RgpdEn.tsx"), "utf8").replace(/\s+/g, " ");
    expect(frPage).toContain("Une suppression d&apos;office faite alors que sa contestation attendait encore son issue ne bloque l&apos;image qu&apos;une fois maintenue");
    expect(frPage).toContain("11 novembre 2026 — alors aussi celles d&apos;un avatar seulement masqué — restent bloquées");
    expect(enPage).toContain("An automatic deletion made while its challenge was still awaiting its outcome only blocks the image once upheld");
    expect(enPage).toContain("November 11, 2026 — then also those of an avatar that was only hidden — stay blocked");
  });
});

// Revue juridique #571, cycle 2 : conditions v10 et blocages d'avant la version 10.
describe("revue juridique #571, cycle 2", () => {
  it("termsV10_signalement_pendingAutomaticDeletionBlockedOnlyOnceUpheldFrAndEn", () => {
    const fr = TERMS_SECTIONS.find((s) => s.id === "signalement")?.paragraphs.join(" ") ?? "";
    const en = TERMS_SECTIONS_EN.find((s) => s.id === "signalement")?.paragraphs.join(" ") ?? "";
    expect(fr).toContain("Supprimé d'office au terme d'un masquage alors que sa contestation attend encore son issue, il n'est bloqué qu'une fois la suppression maintenue");
    expect(fr).toContain("acceptée après une suppression décidée sur un signalement ou après un masquage, il est levé");
    expect(en).toContain("Deleted automatically at the end of a hiding while its challenge is still awaiting its outcome, it is only blocked once the deletion is upheld");
    expect(en).toContain("accepted after a deletion decided on a report or after a hiding, it is lifted");
  });

  it("legacyErasureBlocks_datedToTheDayTheyWereSetFrAndEn", () => {
    const fr = PRIVACY_CHANGES.find((c) => c.id === "2026-11-empreinte-avatar-supprime");
    const en = PRIVACY_CHANGES_EN["2026-11-empreinte-avatar-supprime"];
    expect(fr?.details?.join(" ")).toContain("datées du jour de leur pose, qui peut être celui de l'effacement");
    expect(en?.details?.join(" ")).toContain("dated to the day they were set, which may be that of the erasure");
    expect(PROCESSING_ACTIVITIES.find((a) => a.ref === "T01")?.retention.join(" ")).toContain("datées du jour de leur pose");
    expect(PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T01")?.retention.join(" ")).toContain("dated to the day they were set");
  });
});
