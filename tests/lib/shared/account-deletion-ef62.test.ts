import { describe, expect, it } from "@jest/globals";
import { parseConfirmedReason } from "@/lib/shared/account-deletion";
import { parseProfilelessIds } from "@/components/profileless-players";
import { deletionDialogContent, FR_PROFILE } from "@/app/(secured)/profil/_lib/profile-text";
import { scopedText } from "@/lib/shared/scoped-text";
import enProfile from "@/messages/en/profile.json";
import { ACCOUNT_REACTIVATION_DAYS, accountDeletionConfirmation } from "@/lib/shared/account-deletion";

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
