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
    // Suivie du seul rectificatif de la marque de session (EF-63), daté du déploiement suivant.
    expect(PRIVACY_CHANGES.at(-2)).toMatchObject({ id: ENTRY_ID, publishedAt: "2026-11-13" });
    expect(PRIVACY_CHANGES.at(-1)?.id).toBe("2026-11-marque-de-session-rectificatif");
    expect(entryFr).not.toHaveProperty("audience");
    expect(entryFr).not.toHaveProperty("asksTermsAcceptance");
  });

  it("privacyChange_botExclusionNotice_frenchSaysWhatIsKeptAndRetried", () => {
    expect(entryFr?.details).toEqual([
      expect.stringContaining("au plus une fois par jour"),
      expect.stringContaining("momentanément injoignable, l'identifiant de l'exclu, celui du message et l'heure de sa mise en file sont gardés pour réessayer lors du ménage du bot (chaque nuit, et à son redémarrage ou après une restauration ; un nombre limité d'avis à chaque passage), 30 jours au plus"),
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
      expect.stringContaining("temporarily unreachable, the ID of the excluded member, that of the message and the time it was queued are kept to retry during the bot's clean-up (every night, and when it restarts or after a restore; a limited number of notices each time), for 30 days at most"),
    ]);
    expect(entryEn?.details[0]).toContain("the ID of that message and the time of the last attempt to send it");
    expect(entryEn?.details[0]).toContain("which the bot deletes if it can");
    expect(entryEn?.details[1]).toContain("refuses to delete for good");
    expect(entryEn?.details[1]).toContain("is no longer retried");
    expect(entryEn?.linkLabels).toEqual([expect.stringContaining("privacy policy"), expect.stringContaining("T08")]);
  });

  it("privacyChange_botExclusionNotice_frenchDoesNotPromiseANightlyRetryForEveryNotice", () => {
    // La purge de nuit plafonne ses essais (MAX_NOTICE_WITHDRAWALS_PER_RUN) : « chaque nuit » serait faux.
    expect(entryFr?.details[1]).toContain("un nombre limité d'avis à chaque passage");
    expect(entryFr?.details[1]).not.toMatch(/réessayer chaque nuit/);
  });

  it("privacyChange_botExclusionNotice_englishDoesNotPromiseANightlyRetryForEveryNotice", () => {
    expect(entryEn?.details[1]).toContain("a limited number of notices each time");
    expect(entryEn?.details[1]).not.toMatch(/retry every night/);
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
    expect(notice).toContain("l'identifiant de l'exclu et celui de l'ancien avis sont gardés pour que le ménage du Bot (chaque nuit, et à son redémarrage ou après une restauration) réessaie de le supprimer, 30 jours au plus");
    expect(notice).toContain("aucun nouvel avis ne part ce jour-là et l'ancien reste");
    expect(notice).toContain("Un avis que Discord refuse de supprimer reste.");
  });

  it("botPrivacyPolicy_previousNoticeNotDeletable_englishDoesNotPromiseASingleNotice", () => {
    const notice = policyTexts(PRIVACY_POLICY.en).find((text) => text.startsWith("IDs of the excluded user"));

    expect(notice).not.toContain("replaces the previous one, which is deleted.");
    expect(notice).toContain("deleted before sending when Discord allows it.");
    expect(notice).toContain("the ID of the excluded user and that of the previous notice are kept so that the Bot's clean-up (every night, and when it restarts or after a restore) retries deleting it, for 30 days at most");
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

  it("botPrivacyPolicy_retention_frenchRetriesALimitedNumberAtEveryCleanUpPass", () => {
    // runDataRetention : chaque nuit, au démarrage (main.ts) et après /restore-backup.
    expect(frRetention).toContain("réessayer lors du ménage du Bot (chaque nuit, et à son redémarrage ou après une restauration ; un nombre limité d'avis à chaque passage), 30 jours au plus");
    expect(frRetention).not.toContain("par nuit");
    expect(frRetention).not.toContain("ménage de nuit");
    expect(frRetention).not.toMatch(/réessayer chaque nuit/);
  });

  it("botPrivacyPolicy_retention_englishRetriesALimitedNumberAtEveryCleanUpPass", () => {
    expect(enRetention).toContain("retry during the Bot's clean-up (every night, and when it restarts or after a restore; a limited number of notices each time), for 30 days at most");
    expect(enRetention).not.toContain("per night");
    expect(enRetention).not.toContain("nightly clean-up");
    expect(enRetention).not.toMatch(/retry every night/);
  });

  it("botPrivacyPolicy_retention_frenchStatesTheUnbanCap", () => {
    // MAX_PREVIOUS_NOTICES_AT_UNBAN = 10 (staffLogRetention.ts du bot).
    expect(frRetention).toContain("dix au plus de ces avis remplacés encore en file sont réessayés sur-le-champ, les autres au ménage suivant");
  });

  it("botPrivacyPolicy_retention_englishStatesTheUnbanCap", () => {
    expect(enRetention).toContain("up to ten of those replaced notices still queued are retried at once, the others during the next clean-up");
  });

  it("botPrivacyPolicy_retention_frenchStatesAFailedLift", () => {
    // /unban met l'avis en file avant de lever : une levée en échec le laisse à la purge.
    expect(frRetention).toContain("Si la levée elle-même échoue (base du Bot indisponible), l'avis en cours, déjà mis en file, peut être supprimé lors d'un ménage alors que l'exclusion court toujours");
  });

  it("botPrivacyPolicy_retention_englishStatesAFailedLift", () => {
    expect(enRetention).toContain("If lifting the exclusion itself fails (the Bot's database unavailable), the current notice, already queued, may be deleted during a clean-up while the exclusion still applies");
  });

  it("botPrivacyPolicy_retention_frenchStatesALateRecordedRefusal", () => {
    // recordWithdrawal : refus dont l'oubli échoue → gardé en file, refait la nuit.
    // Sans file (écriture refusée aussi), le refus n'est revu qu'au prochain avis ou à la levée.
    expect(frRetention).toContain("un refus que le Bot n'a pu noter sur-le-champ l'est plus tard (au ménage suivant, au prochain avis ou à la levée)");
  });

  it("botPrivacyPolicy_retention_englishStatesALateRecordedRefusal", () => {
    expect(enRetention).toContain("a refusal the Bot could not record at once is recorded later (during the next clean-up, at the next notice or when the exclusion is lifted)");
  });

  it("register_T08_frenchRetriesAtCleanUpPassesAndAfterAFailedLift", () => {
    const t08 = JSON.stringify(PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T08"));

    expect(t08).toContain("Discord momentanément injoignable : identifiants de l'exclu et du message, et heure de mise en file, gardés pour réessayer lors du ménage du bot (chaque nuit, au redémarrage ou après une restauration), en nombre limité à chaque passage, 30 jours au plus, même après la levée");
    expect(t08).toContain("levée en échec : l'avis en cours, déjà en file, peut être supprimé par un ménage alors que l'exclusion court toujours");
    expect(t08).toContain("dix au plus des avis remplacés encore en file");
    expect(t08).toContain("file de retrait des avis (identifiants de l'exclu et de l'avis, heure de mise en file), gardée 30 jours au plus, même après la levée");
    expect(t08).toContain("sauf base indisponible juste après l'envoi, réponse de Discord perdue ou avis envoyé depuis la sauvegarde d'une base restaurée");
  });

  it("register_T08_englishRetriesAtCleanUpPassesAndAfterAFailedLift", () => {
    const t08 = JSON.stringify(PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T08"));

    expect(t08).toContain("Discord temporarily unreachable: identifiers of the excluded user and of the message, and time queued, kept to retry during the bot's clean-up (every night, on restart or after a restore), a limited number each time, for 30 days at most, even after the exclusion is lifted");
    expect(t08).toContain("lifting failed: the current notice, already queued, may be deleted by a clean-up while the exclusion still applies");
    expect(t08).toContain("up to ten replaced notices still queued");
    expect(t08).toContain("notice withdrawal queue (identifiers of the excluded user and of the notice, time queued), kept for 30 days at most, even after the exclusion is lifted");
    expect(t08).toContain("when they post an advertisement in a relayed channel");
    expect(t08).toContain("unless its database is unavailable just after sending, Discord's reply is lost or the notice was sent since the backup of a restored database");
  });
});

describe("avis d'exclusion du bot — portée des phrases de la politique", () => {
  const frNotice = policyTexts(PRIVACY_POLICY.fr).find((text) => text.startsWith("Identifiants de l'utilisateur exclu"));
  const enNotice = policyTexts(PRIVACY_POLICY.en).find((text) => text.startsWith("IDs of the excluded user"));
  const frRetention = policyTexts(PRIVACY_POLICY.fr).find((text) => text.startsWith("**Exclusions**"));
  const enRetention = policyTexts(PRIVACY_POLICY.en).find((text) => text.startsWith("**Exclusions**"));

  it("botPrivacyPolicy_preRuleExclusion_frenchClauseCoversOnlyStaffAndOwnerMessages", () => {
    // deleteBanMessages retire l'avis de l'exclu quelle que soit la date de l'exclusion.
    expect(frRetention).toContain("pour une exclusion prononcée avant cette règle, seul le motif publié au salon l'est : le reste suit cette même durée. L'avis remis en message privé à l'exclu, quelle que soit la date de l'exclusion,");
  });

  it("botPrivacyPolicy_preRuleExclusion_englishClauseCoversOnlyStaffAndOwnerMessages", () => {
    expect(enRetention).toContain("for an exclusion issued before this rule, only the reason posted in the channel is: the rest follows that same period. The notice sent by direct message to the excluded user, whatever the date of the exclusion,");
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
    // MAX_PREVIOUS_NOTICES_AT_UNBAN = 10, au mieux : la levée réessaie, elle ne garantit pas l'effacement.
    expect(entryFr?.summary).toContain("la levée de l'exclusion réessaie aussi, désormais, d'effacer sur-le-champ dix au plus des avis remplacés restés en file");
    expect(entryFr?.summary).not.toContain("efface aussi, désormais");
    expect(entryFr?.details[1]).toContain("nouveau : à la levée, dix au plus de ces avis remplacés restés en file sont aussi réessayés sur-le-champ");
    expect(entryFr?.details[1]).toContain("Si la levée échoue (base du bot indisponible), l'avis en cours peut être supprimé lors d'un ménage");
  });

  it("privacyChange_botExclusionNotice_englishAnnouncesQueuedNoticesDeletedAtLifting", () => {
    expect(entryEn?.summary).toContain("posts an advertisement in a relayed channel");
    expect(entryEn?.summary).toContain("lifting the exclusion now also retries at once deleting up to ten replaced notices still queued");
    expect(entryEn?.summary).not.toContain("now also deletes");
    expect(entryEn?.details[1]).toContain("new: when it is lifted, up to ten of those replaced notices still queued are also retried at once");
    expect(entryEn?.details[1]).toContain("If lifting fails (the bot's database unavailable), the current notice may be deleted during a clean-up");
  });
});

describe("avis d'exclusion du bot — suppression au mieux et base restaurée", () => {
  const frNotice = policyTexts(PRIVACY_POLICY.fr).find((text) => text.startsWith("Identifiants de l'utilisateur exclu"));
  const enNotice = policyTexts(PRIVACY_POLICY.en).find((text) => text.startsWith("IDs of the excluded user"));
  const frRetention = policyTexts(PRIVACY_POLICY.fr).find((text) => text.startsWith("**Exclusions**"));
  const enRetention = policyTexts(PRIVACY_POLICY.en).find((text) => text.startsWith("**Exclusions**"));

  it("botPrivacyPolicy_notice_frenchRetryIsNotTiedToANightlyPurge", () => {
    expect(frNotice).not.toContain("purge de nuit");
  });

  it("botPrivacyPolicy_notice_englishRetryIsNotTiedToANightlyPurge", () => {
    expect(enNotice).not.toContain("nightly purge");
  });

  it("botPrivacyPolicy_staffMessages_frenchDeletedBestEffortThenLogPeriod", () => {
    // deleteBanMessages n'essaie qu'une fois le salon et la copie au titulaire ; purgeStaffLogs reprend à un an.
    expect(frNotice).toContain("sont supprimés à la levée de l'exclusion, au mieux (section 03, qui précise ce qui reste quand Discord ne le permet pas");
    expect(frRetention).toContain("un message que Discord ne laisse pas supprimer à ce moment n'est pas réessayé et suit la durée du salon de journal (ci-dessous)");
  });

  it("botPrivacyPolicy_staffMessages_englishDeletedBestEffortThenLogPeriod", () => {
    expect(enNotice).toContain("are deleted when the exclusion is lifted, on a best-effort basis (section 03, which details what remains when Discord does not allow it");
    expect(enRetention).toContain("a message Discord does not allow to be deleted at that moment is not retried and follows the log channel's period (below)");
  });

  it("botPrivacyPolicy_restoredDatabase_frenchNoticeSentSinceBackupStays", () => {
    // doc/disaster-recovery.md du bot : un avis envoyé depuis l'archive n'est plus connu.
    expect(frNotice).toContain("après une restauration de la base du Bot depuis une sauvegarde, d'un avis envoyé depuis la date de cette sauvegarde");
    expect(frRetention).toContain("un avis envoyé depuis la date de cette sauvegarde (et sa mise en file) n'est plus connu du Bot : il reste lui aussi");
  });

  it("botPrivacyPolicy_restoredDatabase_englishNoticeSentSinceBackupStays", () => {
    expect(enNotice).toContain("after the Bot's database is restored from a backup, for a notice sent since the date of that backup");
    expect(enRetention).toContain("a notice sent since the date of that backup (and its queue entry) is no longer known to the Bot: it remains too");
  });

  it("register_T08_frenchStaffMessagesDeletedBestEffort", () => {
    const t08 = JSON.stringify(PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T08"));

    expect(t08).toContain("sont supprimés à la levée, au mieux (un message que Discord ne laisse pas supprimer alors suit la durée du salon de journal)");
  });

  it("register_T08_englishStaffMessagesDeletedBestEffort", () => {
    const t08 = JSON.stringify(PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T08"));

    expect(t08).toContain("are deleted when it is lifted, on a best-effort basis (a message Discord does not allow to be deleted then follows the log channel's period)");
  });

  it("privacyChange_botExclusionNotice_frenchDetailsMentionARestoredDatabase", () => {
    expect(entryFr?.details[1]).toContain("après une restauration de la base du bot depuis une sauvegarde, pour un avis envoyé depuis cette sauvegarde");
    expect(entryFr?.details[1]).not.toContain("ménage de nuit");
  });

  it("privacyChange_botExclusionNotice_englishDetailsMentionARestoredDatabase", () => {
    expect(entryEn?.details[1]).toContain("after the bot's database is restored from a backup, for a notice sent since that backup");
    expect(entryEn?.details[1]).not.toContain("nightly clean-up");
  });
});

/** Toutes les chaînes d'un texte de politique, dans l'ordre. */
function policyTexts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(policyTexts);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(policyTexts);
  return [];
}
