import { describe, expect, it } from "@jest/globals";
import { PRIVACY_POLICY } from "@/lib/shared/bot-legal-content";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register";

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
      expect.stringContaining("momentanément injoignable, l'identifiant de l'exclu et celui du message sont gardés pour réessayer lors du ménage de nuit, 30 jours au plus"),
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
      expect.stringContaining("temporarily unreachable, the ID of the excluded member and that of the message are kept to retry during the nightly clean-up, for 30 days at most"),
    ]);
    expect(entryEn?.details[0]).toContain("the ID of that message and the time of the last attempt to send it");
    expect(entryEn?.details[0]).toContain("which the bot deletes if it can");
    expect(entryEn?.details[1]).toContain("refuses to delete for good");
    expect(entryEn?.details[1]).toContain("is no longer retried");
    expect(entryEn?.linkLabels).toEqual([expect.stringContaining("privacy policy"), expect.stringContaining("T08")]);
  });

  it("privacyChange_botExclusionNotice_frenchDoesNotPromiseANightlyRetryForEveryNotice", () => {
    // La purge de nuit plafonne ses essais (MAX_NOTICE_WITHDRAWALS_PER_RUN) : « chaque nuit » serait faux.
    expect(entryFr?.details[1]).not.toContain("chaque nuit");
  });

  it("privacyChange_botExclusionNotice_englishDoesNotPromiseANightlyRetryForEveryNotice", () => {
    expect(entryEn?.details[1]).not.toContain("every night");
  });

  it("privacyChange_botExclusionNotice_frenchSaysANoticeMayStayWithoutKeptId", () => {
    // checkBan : base indisponible après l'envoi et retrait perdu, ou réponse de Discord perdue.
    expect(entryFr?.details[1]).toContain("un avis peut aussi rester sans que le bot en garde l'identifiant");
  });

  it("privacyChange_botExclusionNotice_englishSaysANoticeMayStayWithoutKeptId", () => {
    expect(entryEn?.details[1]).toContain("a notice may also remain without the bot keeping its ID");
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
    expect(retention).toContain("est supprimé quand un nouvel avis le remplace, et le dernier à la levée");
  });

  it("botPrivacyPolicy_exclusionNotice_englishMatchesTheEntry", () => {
    const texts = policyTexts(PRIVACY_POLICY.en);
    expect(texts.find((text) => text.startsWith("IDs of the excluded user"))).toContain("at most once a day");
    const retention = texts.find((text) => text.startsWith("**Exclusions**"));
    expect(retention).toContain("temporarily unreachable");
    expect(retention).toContain("30 days at most");
    expect(retention).toContain("is no longer retried");
    expect(retention).toContain("is deleted when a new notice replaces it, and the last one when the exclusion is lifted");
  });

  it("botPrivacyPolicy_previousNoticeNotDeletable_frenchDoesNotPromiseASingleNotice", () => {
    // L'ancien avis que Discord ne laisse pas effacer tout de suite coexiste avec le nouveau.
    const notice = policyTexts(PRIVACY_POLICY.fr).find((text) => text.startsWith("Identifiants de l'utilisateur exclu"));

    expect(notice).not.toContain("remplace le précédent, supprimé.");
    expect(notice).toContain("supprimé avant l'envoi quand Discord le permet.");
    expect(notice).toContain("l'identifiant de l'exclu et celui de l'ancien avis sont gardés pour que la purge de nuit réessaie de le supprimer, 30 jours au plus");
    expect(notice).toContain("aucun nouvel avis ne part ce jour-là et l'ancien reste");
    expect(notice).toContain("Un avis que Discord refuse de supprimer reste.");
  });

  it("botPrivacyPolicy_previousNoticeNotDeletable_englishDoesNotPromiseASingleNotice", () => {
    const notice = policyTexts(PRIVACY_POLICY.en).find((text) => text.startsWith("IDs of the excluded user"));

    expect(notice).not.toContain("replaces the previous one, which is deleted.");
    expect(notice).toContain("deleted before sending when Discord allows it.");
    expect(notice).toContain("the ID of the excluded user and that of the previous notice are kept so that the nightly purge retries deleting it, for 30 days at most");
    expect(notice).toContain("no new notice is sent that day and the previous one stays");
    expect(notice).toContain("A notice that Discord refuses to delete remains.");
  });
});

describe("avis d'exclusion du bot — cas où la base ou Discord fait défaut", () => {
  const frNotice = policyTexts(PRIVACY_POLICY.fr).find((text) => text.startsWith("Identifiants de l'utilisateur exclu"));
  const enNotice = policyTexts(PRIVACY_POLICY.en).find((text) => text.startsWith("IDs of the excluded user"));
  const frRetention = policyTexts(PRIVACY_POLICY.fr).find((text) => text.startsWith("**Exclusions**"));
  const enRetention = policyTexts(PRIVACY_POLICY.en).find((text) => text.startsWith("**Exclusions**"));

  it("botPrivacyPolicy_noticeSentDuringDatabaseOutage_frenchSaysItMayStayUntracked", () => {
    expect(frNotice).toContain("si la réponse de Discord à l'envoi se perd, cet avis reste sans que le Bot en garde l'identifiant, et n'est pas supprimé à la levée");
  });

  it("botPrivacyPolicy_noticeSentDuringDatabaseOutage_englishSaysItMayStayUntracked", () => {
    expect(enNotice).toContain("if Discord's reply to the sending is lost, that notice remains without the Bot keeping its ID, and is not deleted when the exclusion is lifted");
  });

  it("botPrivacyPolicy_retention_frenchRetriesALimitedNumberAtNight", () => {
    expect(frRetention).toContain("réessayer lors du ménage de nuit (un nombre limité d'avis par nuit), 30 jours au plus");
    expect(frRetention).not.toContain("chaque nuit");
  });

  it("botPrivacyPolicy_retention_englishRetriesALimitedNumberAtNight", () => {
    expect(enRetention).toContain("retry during the nightly clean-up (a limited number of notices per night), for 30 days at most");
    expect(enRetention).not.toContain("every night");
  });

  it("botPrivacyPolicy_retention_frenchStatesTheUnbanCap", () => {
    // MAX_PREVIOUS_NOTICES_AT_UNBAN = 10 (staffLogRetention.ts du bot).
    expect(frRetention).toContain("dix au plus de ces avis remplacés encore en file sont réessayés sur-le-champ, les autres au ménage de nuit");
  });

  it("botPrivacyPolicy_retention_englishStatesTheUnbanCap", () => {
    expect(enRetention).toContain("up to ten of those replaced notices still queued are retried at once, the others during the nightly clean-up");
  });

  it("botPrivacyPolicy_retention_frenchStatesAFailedLift", () => {
    // /unban met l'avis en file avant de lever : une levée en échec le laisse à la purge.
    expect(frRetention).toContain("Si la levée elle-même échoue (base du Bot indisponible), l'avis en cours, déjà mis en file, peut être supprimé lors du ménage de nuit alors que l'exclusion court toujours");
  });

  it("botPrivacyPolicy_retention_englishStatesAFailedLift", () => {
    expect(enRetention).toContain("If lifting the exclusion itself fails (the Bot's database unavailable), the current notice, already queued, may be deleted during the nightly clean-up while the exclusion still applies");
  });

  it("botPrivacyPolicy_retention_frenchStatesALateRecordedRefusal", () => {
    // recordWithdrawal : refus dont l'oubli échoue → gardé en file, refait la nuit.
    // Sans file (écriture refusée aussi), le refus n'est revu qu'au prochain avis ou à la levée.
    expect(frRetention).toContain("un refus que le Bot n'a pu noter sur-le-champ l'est plus tard (au ménage de nuit, au prochain avis ou à la levée)");
  });

  it("botPrivacyPolicy_retention_englishStatesALateRecordedRefusal", () => {
    expect(enRetention).toContain("a refusal the Bot could not record at once is recorded later (during the nightly clean-up, at the next notice or when the exclusion is lifted)");
  });

  it("register_T08_frenchRetriesAtNightlyCleanUpAndAfterAFailedLift", () => {
    const t08 = JSON.stringify(PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T08"));

    expect(t08).toContain("Discord momentanément injoignable : identifiants de l'exclu et du message, et heure de mise en file, gardés pour réessayer lors du ménage de nuit, en nombre limité par nuit, 30 jours au plus, même après la levée");
    expect(t08).toContain("levée en échec : l'avis en cours, déjà en file, peut être supprimé par le ménage de nuit alors que l'exclusion court toujours");
    expect(t08).toContain("dix au plus des avis remplacés encore en file");
    expect(t08).toContain("file de retrait des avis (identifiants de l'exclu et de l'avis, heure de mise en file), gardée 30 jours au plus, même après la levée");
    expect(t08).toContain("sauf base indisponible juste après l'envoi ou réponse de Discord perdue");
  });

  it("register_T08_englishRetriesAtNightlyCleanUpAndAfterAFailedLift", () => {
    const t08 = JSON.stringify(PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T08"));

    expect(t08).toContain("Discord temporarily unreachable: identifiers of the excluded user and of the message, and time queued, kept to retry during the nightly clean-up, a limited number per night, for 30 days at most, even after the exclusion is lifted");
    expect(t08).toContain("lifting failed: the current notice, already queued, may be deleted by the nightly clean-up while the exclusion still applies");
    expect(t08).toContain("up to ten replaced notices still queued");
    expect(t08).toContain("notice withdrawal queue (identifiers of the excluded user and of the notice, time queued), kept for 30 days at most, even after the exclusion is lifted");
    expect(t08).toContain("when they post an advertisement in a relayed channel");
    expect(t08).toContain("unless its database is unavailable just after sending or Discord's reply is lost");
  });
});

describe("avis d'exclusion du bot — portée des phrases de la politique", () => {
  const frNotice = policyTexts(PRIVACY_POLICY.fr).find((text) => text.startsWith("Identifiants de l'utilisateur exclu"));
  const enNotice = policyTexts(PRIVACY_POLICY.en).find((text) => text.startsWith("IDs of the excluded user"));
  const frRetention = policyTexts(PRIVACY_POLICY.fr).find((text) => text.startsWith("**Exclusions**"));
  const enRetention = policyTexts(PRIVACY_POLICY.en).find((text) => text.startsWith("**Exclusions**"));

  it("botPrivacyPolicy_preRuleExclusion_frenchClauseCoversOnlyStaffAndOwnerMessages", () => {
    // deleteBanMessages retire l'avis de l'exclu quelle que soit la date de l'exclusion.
    expect(frRetention).toContain("sont supprimés à la levée — pour une exclusion prononcée avant cette règle, seul le motif publié au salon l'est : le reste suit la durée du salon de journal (ci-dessous). L'avis remis en message privé à l'exclu, quelle que soit la date de l'exclusion,");
  });

  it("botPrivacyPolicy_preRuleExclusion_englishClauseCoversOnlyStaffAndOwnerMessages", () => {
    expect(enRetention).toContain("are deleted when it is lifted — for an exclusion issued before this rule, only the reason posted in the channel is: the rest follows the log channel's period (below). The notice sent by direct message to the excluded user, whatever the date of the exclusion,");
  });

  it("botPrivacyPolicy_deletedAtLifting_frenchNamesOnlyTrackedMessages", () => {
    expect(frNotice).toContain("Les messages du salon, la copie au titulaire du Bot et le dernier avis remis à l'exclu dont le Bot garde l'identifiant sont supprimés à la levée de l'exclusion");
    expect(frNotice).not.toContain("Ces messages sont supprimés, dans le salon comme en message privé");
  });

  it("botPrivacyPolicy_deletedAtLifting_englishNamesOnlyTrackedMessages", () => {
    expect(enNotice).toContain("The channel messages, the copy sent to the Bot's owner and the last notice sent to the excluded user whose ID the Bot keeps are deleted when the exclusion is lifted");
    expect(enNotice).not.toContain("These messages are deleted, in the channel and in the direct messages alike");
  });

  it("privacyChange_botExclusionNotice_frenchAnnouncesQueuedNoticesDeletedAtLifting", () => {
    expect(entryFr?.summary).toContain("la levée de l'exclusion efface aussi, désormais, les avis remplacés restés en file");
    expect(entryFr?.details[1]).toContain("nouveau : à la levée, dix au plus de ces avis remplacés restés en file sont aussi réessayés sur-le-champ");
    expect(entryFr?.details[1]).toContain("Si la levée échoue (base du bot indisponible), l'avis en cours peut être supprimé lors du ménage de nuit");
  });

  it("privacyChange_botExclusionNotice_englishAnnouncesQueuedNoticesDeletedAtLifting", () => {
    expect(entryEn?.summary).toContain("posts an advertisement in a relayed channel");
    expect(entryEn?.summary).toContain("lifting the exclusion now also deletes replaced notices still queued");
    expect(entryEn?.details[1]).toContain("new: when it is lifted, up to ten of those replaced notices still queued are also retried at once");
    expect(entryEn?.details[1]).toContain("If lifting fails (the bot's database unavailable), the current notice may be deleted during the nightly clean-up");
  });
});

/** Toutes les chaînes d'un texte de politique, dans l'ordre. */
function policyTexts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(policyTexts);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(policyTexts);
  return [];
}
