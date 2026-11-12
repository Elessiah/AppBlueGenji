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
  it("privacyChange_botExclusionNotice_isLastEntryForAllAccounts", () => {
    expect(PRIVACY_CHANGES.at(-1)).toMatchObject({ id: ENTRY_ID, publishedAt: "2026-11-13" });
    expect(entryFr).not.toHaveProperty("audience");
    expect(entryFr).not.toHaveProperty("asksTermsAcceptance");
  });

  it("privacyChange_botExclusionNotice_frenchSaysWhatIsKeptAndRetried", () => {
    expect(entryFr?.details).toEqual([
      expect.stringContaining("l'identifiant de ce message et l'heure du dernier essai d'envoi"),
      expect.stringContaining("réessayer chaque nuit, 30 jours au plus"),
    ]);
  });

  it("privacyChange_botExclusionNotice_englishSaysWhatIsKeptAndRetried", () => {
    expect(entryEn?.details).toEqual([
      expect.stringContaining("the ID of that message and the time of the last attempt to send it"),
      expect.stringContaining("retry every night, for 30 days at most"),
    ]);
    expect(entryEn?.linkLabels).toEqual([expect.stringContaining("privacy policy"), expect.stringContaining("T08")]);
  });

  it("privacyChange_botExclusionNotice_linksBotPolicyAndRegisterT08", () => {
    expect(entryFr?.links?.map((link) => link.href)).toEqual(["/privacy-policy-bot", "/rgpd/registre#t08"]);
  });

  it("botPrivacyPolicy_exclusionNotice_matchesTheEntry", () => {
    expect(JSON.stringify(PRIVACY_POLICY)).toMatch(/au plus une fois par jour.*30 jours au plus/);
  });
});
