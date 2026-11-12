import { describe, expect, it } from "@jest/globals";
import { PRIVACY_POLICY } from "@/lib/shared/bot-legal-content";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";

/**
 * BOT-LOT (rectificatif) : l'avis d'exclusion que le bot envoie en message privé
 * à l'exclu, et ce qu'il en garde, est annoncé par une entrée de PRIVACY_CHANGES.
 */
const ENTRY_ID = "2026-11-bot-avis-d-exclusion";
const entryFr = PRIVACY_CHANGES.find((change) => change.id === ENTRY_ID);
const entryEn = PRIVACY_CHANGES_EN[ENTRY_ID];

describe("entrée PRIVACY_CHANGES de l'avis d'exclusion du bot", () => {
  it("privacyChange_botExclusionNotice_lastEntryDated20261113ForAllAccounts", () => {
    expect(PRIVACY_CHANGES.at(-1)?.id).toBe(ENTRY_ID);
    expect(entryFr?.publishedAt).toBe("2026-11-13");
    expect(entryFr?.audience).toBeUndefined();
    expect(entryFr?.asksTermsAcceptance).toBeUndefined();
  });

  it("privacyChange_botExclusionNotice_englishMatchesFrenchShape", () => {
    expect(entryEn?.details).toHaveLength(entryFr?.details.length ?? -1);
    expect(entryEn?.linkLabels).toHaveLength(entryFr?.links?.length ?? -1);
  });

  it("privacyChange_botExclusionNotice_saysWhatIsKeptAndRetriedFrAndEn", () => {
    const fr = entryFr?.details.join(" ") ?? "";
    const en = entryEn?.details.join(" ") ?? "";

    expect(fr).toContain("au plus une fois par jour");
    expect(fr).toContain("l'identifiant de ce message et l'heure du dernier essai d'envoi");
    expect(fr).toContain("réessayer chaque nuit, 30 jours au plus");
    expect(en).toContain("at most once a day");
    expect(en).toContain("the ID of that message and the time of the last attempt to send it");
    expect(en).toContain("retry every night, for 30 days at most");
  });

  it("privacyChange_botExclusionNotice_linksBotPolicyAndRegisterT08", () => {
    expect(entryFr?.links?.map((link) => link.href)).toEqual(["/privacy-policy-bot", "/rgpd/registre#t08"]);
  });

  it("botPrivacyPolicy_exclusionNotice_matchesTheEntry", () => {
    const policy = JSON.stringify(PRIVACY_POLICY);

    expect(policy).toContain("au plus une fois par jour");
    expect(policy).toContain("30 jours au plus");
  });
});
