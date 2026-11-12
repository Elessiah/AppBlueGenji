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
      expect.stringContaining("au plus une fois par jour"),
      expect.stringContaining("momentanément injoignable, l'identifiant de l'exclu et celui du message sont gardés pour réessayer chaque nuit, 30 jours au plus"),
    ]);
    expect(entryFr?.details[0]).toContain("l'identifiant de ce message et l'heure du dernier essai d'envoi");
    expect(entryFr?.details[0]).toContain("que le bot supprime s'il le peut");
  });

  it("privacyChange_botExclusionNotice_frenchSaysARefusalIsNotRetried", () => {
    // Le bot oublie un avis que Discord refuse d'effacer (`deleteDirectMessage` → `refused`).
    expect(entryFr?.details[1]).toContain("refuse de supprimer pour de bon");
    expect(entryFr?.details[1]).toContain("n'est plus réessayé");
    expect(entryFr?.details[1]).not.toMatch(/Si Discord refuse de le supprimer, l'identifiant/);
  });

  it("privacyChange_botExclusionNotice_englishSaysWhatIsKeptAndRetried", () => {
    expect(entryEn?.details).toEqual([
      expect.stringContaining("at most once a day"),
      expect.stringContaining("temporarily unreachable, the ID of the excluded member and that of the message are kept to retry every night, for 30 days at most"),
    ]);
    expect(entryEn?.details[0]).toContain("the ID of that message and the time of the last attempt to send it");
    expect(entryEn?.details[0]).toContain("which the bot deletes if it can");
    expect(entryEn?.details[1]).toContain("refuses to delete for good");
    expect(entryEn?.details[1]).toContain("is no longer retried");
    expect(entryEn?.linkLabels).toEqual([expect.stringContaining("privacy policy"), expect.stringContaining("T08")]);
  });

  it("privacyChange_botExclusionNotice_linksBotPolicyAndRegisterT08", () => {
    expect(entryFr?.links?.map((link) => link.href)).toEqual(["/privacy-policy-bot", "/rgpd/registre#t08"]);
  });

  it("botPrivacyPolicy_exclusionNotice_frenchMatchesTheEntry", () => {
    const texts = policyTexts(PRIVACY_POLICY.fr);
    expect(texts.find((text) => text.startsWith("Identifiants de l'utilisateur exclu"))).toContain("au plus une fois par jour");
    const retention = texts.find((text) => text.startsWith("**Exclusions**"));
    expect(retention).toContain("momentanément injoignable");
    expect(retention).toContain("30 jours au plus");
    expect(retention).toContain("n'est plus réessayé");
  });

  it("botPrivacyPolicy_exclusionNotice_englishMatchesTheEntry", () => {
    const texts = policyTexts(PRIVACY_POLICY.en);
    expect(texts.find((text) => text.startsWith("IDs of the excluded user"))).toContain("at most once a day");
    const retention = texts.find((text) => text.startsWith("**Exclusions**"));
    expect(retention).toContain("temporarily unreachable");
    expect(retention).toContain("30 days at most");
    expect(retention).toContain("is no longer retried");
  });

  it("botPrivacyPolicy_previousNoticeNotDeletable_frenchDoesNotPromiseASingleNotice", () => {
    // L'ancien avis que Discord ne laisse pas effacer tout de suite coexiste avec le nouveau.
    const notice = policyTexts(PRIVACY_POLICY.fr).find((text) => text.startsWith("Identifiants de l'utilisateur exclu"));

    expect(notice).not.toContain("remplace le précédent, supprimé.");
    expect(notice).toContain("supprimé avant l'envoi quand Discord le permet (sinon par la purge de nuit, section 03 ; un avis que Discord refuse de supprimer reste)");
  });

  it("botPrivacyPolicy_previousNoticeNotDeletable_englishDoesNotPromiseASingleNotice", () => {
    const notice = policyTexts(PRIVACY_POLICY.en).find((text) => text.startsWith("IDs of the excluded user"));

    expect(notice).not.toContain("replaces the previous one, which is deleted.");
    expect(notice).toContain("deleted before sending when Discord allows it (otherwise by the nightly purge, section 03; a notice that Discord refuses to delete remains)");
  });
});

/** Toutes les chaînes d'un texte de politique, dans l'ordre. */
function policyTexts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(policyTexts);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(policyTexts);
  return [];
}
