import { describe, expect, it } from "@jest/globals";
import { parseConfirmedReason } from "@/lib/shared/account-deletion";
import { parseProfilelessIds } from "@/components/profileless-players";
import { deletionDialogContent, FR_PROFILE } from "@/app/(secured)/profil/_lib/profile-text";
import { scopedText } from "@/lib/shared/scoped-text";
import enProfile from "@/messages/en/profile.json";
import { ACCOUNT_DELETION_HANDOVER, ACCOUNT_REACTIVATION_DAYS, accountDeletionConfirmation, RETENTION_UNKNOWN, type ConfirmationSubject } from "@/lib/shared/account-deletion";
import frProfile from "@/messages/fr/profile.json";
import frLogin from "@/messages/fr/login.json";
import enLogin from "@/messages/en/login.json";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
import { readSource } from "../../helpers/read-source";

/** EF-62 : motif confirmé par la modale, relecture des comptes sans fiche. */
describe("parseConfirmedReason", () => {
  it("parseConfirmedReason_knownReason_returnsIt", () => {
    expect(parseConfirmedReason("OWNED_TEAMS")).toBe("OWNED_TEAMS");
  });

  it("parseConfirmedReason_null_returnsNull", () => {
    expect(parseConfirmedReason(null)).toBeNull();
  });

  it("parseConfirmedReason_unknownString_returnsUndefined", () => {
    expect(parseConfirmedReason("BOGUS")).toBeUndefined();
  });

  it("parseConfirmedReason_nonString_returnsUndefined", () => {
    expect(parseConfirmedReason(3)).toBeUndefined();
    expect(parseConfirmedReason(undefined)).toBeUndefined();
  });
});

describe("parseProfilelessIds", () => {
  it("parseProfilelessIds_mixedValues_keepsPositiveIntegersOnly", () => {
    expect(parseProfilelessIds({ ids: [3, -1, 1.5, "4", 8] })).toEqual([3, 8]);
  });

  it("parseProfilelessIds_noArray_returnsNull", () => {
    expect(parseProfilelessIds({ ids: "3" })).toBeNull();
    expect(parseProfilelessIds(null)).toBeNull();
  });
});

describe("deletionDialogContent", () => {
  it("deletionDialogContent_ownedTeams_listsFourHandoversAndFoldsResidual", () => {
    const content = deletionDialogContent(FR_PROFILE, "OWNED_TEAMS");

    expect(content.handoverItems).toHaveLength(4);
    expect(content.handoverLead).toBe(FR_PROFILE.t("deletion.handoverList.lead"));
    expect(content.residualSubject).toBe(FR_PROFILE.t("deletion.residualSubject"));
    expect(content.residual).toContain("30");
  });

  it("deletionDialogContent_ownedTeamsFromTerms_includesTermsNote", () => {
    expect(deletionDialogContent(FR_PROFILE, "OWNED_TEAMS", true).termsNote).toBe(
      FR_PROFILE.t("deletion.ownedTeamsFromTerms"),
    );
  });

  it("deletionDialogContent_notFromTerms_noTermsNote", () => {
    expect(deletionDialogContent(FR_PROFILE, "OWNED_TEAMS").termsNote).toBeNull();
  });
});

/** Revue standard cycle 1 : le délai vient de la constante, pas d'un « trente » écrit en dur. */
describe("deletionDialogContent — délai de l'effacement complet", () => {
  it("deletionDialogContent_noneFr_interpolatesDays", () => {
    const { consequence } = deletionDialogContent(FR_PROFILE, null);

    expect(consequence).toContain(`${ACCOUNT_REACTIVATION_DAYS} jours`);
    expect(consequence).not.toContain("{days}");
  });

  it("deletionDialogContent_noneEn_interpolatesDays", () => {
    const { consequence } = deletionDialogContent(scopedText("en", enProfile), null);

    expect(consequence).toContain(`${ACCOUNT_REACTIVATION_DAYS} days`);
    expect(consequence).not.toContain("{days}");
  });

  it("accountDeletionConfirmation_none_usesReactivationConstant", () => {
    expect(accountDeletionConfirmation(null)).toContain(`à la fin des ${ACCOUNT_REACTIVATION_DAYS} jours`);
  });
});

// Revue juridique EF-62 cycle 1 : la modale réelle, ses copies et le forfait nuancé.
describe("deletionDialogContent — parité FR/EN", () => {
  const subjects: ConfirmationSubject[] = [null, "TOURNAMENTS", "SOLO_REGISTRATIONS", "ORGANIZED_TOURNAMENTS", "OWNED_TEAMS", RETENTION_UNKNOWN];

  for (const subject of subjects) it(`deletionDialogContent_${String(subject)}_frAndEnSameShapeNonEmpty`, () => {
    const fr = deletionDialogContent(FR_PROFILE, subject, true);
    const en = deletionDialogContent(scopedText("en", enProfile), subject, true);

    expect(Object.keys(en)).toEqual(Object.keys(fr));
    expect(en.handoverItems).toHaveLength(fr.handoverItems.length);
    for (const text of [fr.consequence, en.consequence, fr.window, en.window, fr.residual, en.residual, ...fr.handoverItems, ...en.handoverItems]) {
      expect(text.trim().length).toBeGreaterThan(0);
    }
    expect(en.consequence).not.toBe(fr.consequence);
  });

  it("deletionDialogContent_forfeitItem_mentionsStandingsAndAwaitedOpponent", () => {
    const fr = deletionDialogContent(FR_PROFILE, null).handoverItems[3];
    const en = deletionDialogContent(scopedText("en", enProfile), null).handoverItems[3];

    expect(fr).toContain("abandon du classement dans un tournoi à classement");
    expect(fr).toContain("un match qui attend encore ton adversaire, une fois celui-ci connu");
    expect(en).toContain("withdrawal from the standings in a standings-based tournament");
    expect(en).toContain("a match still waiting for your opponent, once that opponent is known");
  });

  it("forfeitNuance_handoverCopies_agree", () => {
    expect(ACCOUNT_DELETION_HANDOVER).toContain("un match qui attend encore ton adversaire, une fois celui-ci connu");
    expect(frProfile.deletion.handover).toContain("un match qui attend encore ton adversaire, une fois celui-ci connu");
    expect(enProfile.deletion.handover).toContain("a match still waiting for your opponent, once that opponent is known");
  });
});

describe("textes juridiques — forfait d'une entrée solo", () => {
  it("registerT01_forfeit_mentionsHourlyPassForAwaitedOpponent", () => {
    const fr = JSON.stringify(PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T01"));
    const en = JSON.stringify(PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T01"));

    expect(fr).toContain("un match qui attend encore son adversaire est perdu une fois celui-ci connu, au passage horaire qui suit");
    expect(en).toContain("a match still waiting for its opponent is lost once that opponent is known, at the following hourly pass");
  });

  it("rgpdEn_forfeit_mentionsHourlyPassForAwaitedOpponent", () => {
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain("a match still waiting for its opponent is lost once that opponent is known, at the following hourly pass");
  });
});

describe("page de réactivation — ce qui revient", () => {
  it("reactivationKeptLead_frAndEn_nameRemovedAvatarAndSuspendedAccount", () => {
    expect(frLogin.reactivation.keptLead).toContain("avatar masqué ou supprimé par la modération");
    expect(frLogin.reactivation.keptLead).toContain("un compte suspendu revient suspendu");
    expect(enLogin.reactivation.keptLead).toContain("moderation hid or removed the avatar");
    expect(enLogin.reactivation.keptLead).toContain("a suspended account comes back suspended");
  });

  it("reactivationKept_frAndEn_atMostTwoSentences", () => {
    expect(frLogin.reactivation.kept.split(/[.!?](?:\s|$)/).filter((part) => part.trim()).length).toBeLessThanOrEqual(2);
    expect(enLogin.reactivation.kept.split(/[.!?](?:\s|$)/).filter((part) => part.trim()).length).toBeLessThanOrEqual(2);
  });

  it("reactivationNotUndoneForfeits_frAndEn_sayAlreadyLost", () => {
    expect(frLogin.reactivation.notUndoneItems.forfeits).toContain("déjà perdus par forfait (ou par abandon du classement), le restent");
    expect(enLogin.reactivation.notUndoneItems.forfeits).toContain("already lost by forfeit (or by withdrawal from the standings), stay lost");
  });
});
