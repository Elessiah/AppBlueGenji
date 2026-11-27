import { describe, expect, it } from "@jest/globals";
import { PRIVACY_POLICY } from "@/lib/shared/bot-legal-content";
import { GETI_RETENTION_DAYS } from "@/lib/shared/geti/ingest";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register";
import { readSource } from "../../helpers/read-source";

/**
 * GETI-INGEST, revue juridique : une annonce relayée ne suit Discord que par
 * son relais, la garde part du relais, l'auteur d'une annonce relayée s'oppose
 * auprès de l'association (art. 14.5.b déclaré), les personnes citées et les
 * verdicts d'exclusion tenus en mémoire sont déclarés.
 */
const ENTRY_ID = "2026-11-annonces-de-recrutement-overwatch";
const entryFr = PRIVACY_CHANGES.find((change) => change.id === ENTRY_ID);
const entryEn = PRIVACY_CHANGES_EN[ENTRY_ID];
const record = (activities: typeof PROCESSING_ACTIVITIES, ref: string) =>
  JSON.stringify(activities.find((activity) => activity.ref === ref));
const getiParagraph = (source: string) =>
  source.slice(source.indexOf('<p id="annonces-geti">'), source.indexOf('<p id="age-minimum">'));

describe("annonces GETI : textes légaux", () => {
  it("rgpd_getiParagraph_relayConditionCatchUpAndRightsLinkFrAndEn", () => {
    const fr = getiParagraph(readSource("app/rgpd/page.tsx"));
    const en = getiParagraph(readSource("app/rgpd/RgpdEn.tsx"));
    expect(fr).toContain("quand\n            GETI Bot supprime ou modifie son relais, ce que l&apos;association ne maîtrise pas");
    expect(fr).toContain("dans la limite des 5 000 derniers");
    expect(fr).toContain("celle de son relais");
    expect(fr).toContain("qui ne peut pas la supprimer ici");
    expect(fr).toContain('<a href="#exercer-vos-droits">« Exercer vos droits »</a>');
    expect(fr).toContain("elles peuvent, comme\n            lui, exercer leurs droits sur l&apos;annonce qui les cite et en obtenir le retrait");
    expect(fr).not.toContain("mêmes");
    expect(en).toContain("when GETI Bot deletes or edits its relay, which the association does not control");
    expect(en).toContain("within the last 5,000 messages");
    expect(en).toContain("that of its relay");
    expect(en).toContain("who cannot\n            delete it here");
    expect(en).toContain('<a href="#exercer-vos-droits">“Exercising your rights”</a>');
    expect(en).toContain("like the author, they can exercise their rights over the post that mentions them and obtain its removal");
    expect(en).not.toContain("the same rights");
  });

  it("register_t21_art14DisproportionateEffortAndRelayConditionFrAndEn", () => {
    const fr = record(PROCESSING_ACTIVITIES, "T21");
    const en = record(PROCESSING_ACTIVITIES_EN, "T21");
    expect(fr).toContain("(art. 14.5.b)");
    expect(fr).toContain("l'auteur, y compris celui d'une annonce relayée, peut en demander le retrait");
    expect(fr).toContain("pour une annonce relayée, quand GETI Bot modifie ou supprime son relais");
    expect(fr).toContain("après leur publication dans le salon de l'association (pour une annonce relayée, celle de son relais)");
    expect(fr).toContain("dont rien n'est gardé hors les copies de sauvegarde chiffrées");
    expect(en).toContain("(art. 14(5)(b))");
    expect(en).toContain("the author, including that of a relayed post, can ask the association to remove it");
    expect(en).toContain("for a relayed post, when GETI Bot edits or deletes its relay");
    expect(en).toContain("after their publication in the association's channel (for a relayed post, that of its relay)");
    expect(en).toContain("of which nothing is kept apart from the encrypted backup copies");
  });

  it("register_t08_relayedAuthorsAndExclusionVerdictsFrAndEn", () => {
    const fr = record(PROCESSING_ACTIVITIES, "T08");
    const en = record(PROCESSING_ACTIVITIES_EN, "T08");
    expect(fr).toContain("Auteurs des annonces de recrutement que GETI Bot relaie depuis d'autres serveurs, et personnes que citent les annonces de recrutement transmises au site (T21)");
    expect(fr).toContain("pour chaque auteur lu, s'il est exclu du relais");
    expect(fr).toContain("si l'exclusion ne peut être vérifiée sur le moment");
    expect(fr).not.toContain("les 200 derniers messages reçus");
    expect(en).toContain("Authors of the recruitment posts GETI Bot relays from other servers, and people mentioned in the recruitment posts passed to the site (T21)");
    expect(en).toContain("for each author read, whether they are excluded from the relay");
    expect(en).toContain("if the exclusion cannot be checked at that moment");
    expect(en).not.toContain("the latest 200 messages received");
  });

  it("privacyChange_getiEntry_retentionFromConstantsAndRelayConditionFrAndEn", () => {
    const fr = [entryFr?.summary, ...(entryFr?.details ?? [])].join(" ");
    const en = [entryEn?.summary, ...(entryEn?.details ?? [])].join(" ");
    expect(fr).toContain(`gardée ${GETI_RETENTION_DAYS.lfs} jours, les autres annonces ${GETI_RETENTION_DAYS.lfp} jours`);
    expect(fr).toContain("quand GETI Bot supprime ou modifie son relais");
    expect(fr).toContain("Hors les copies de sauvegarde chiffrées");
    expect(fr).not.toContain("dont rien n'est gardé");
    expect(en).toContain(`kept there ${GETI_RETENTION_DAYS.lfs} days, the other posts ${GETI_RETENTION_DAYS.lfp} days`);
    expect(en).toContain("when GETI Bot deletes or edits its relay");
    expect(en).toContain("Apart from the encrypted backup copies");
    expect(en).not.toContain("of which nothing is kept");
  });

  it("botPrivacyPolicy_unreadableExclusion_postGoesThroughAndChannelReread", () => {
    const text = JSON.stringify(PRIVACY_POLICY);
    expect(text).toContain("si son exclusion ne peut être vérifiée sur le moment, son annonce passe et le salon est relu toutes les cinq minutes");
    expect(text).toContain("if their exclusion cannot be checked at that moment, their post goes through and the channel is read again every five minutes");
  });
});

describe("annonces GETI : textes légaux, revue juridique 2", () => {
  it("rgpd_getiParagraph_deletedOrClosedChannelLeavesAtRetentionEndFrAndEn", () => {
    expect(getiParagraph(readSource("app/rgpd/page.tsx"))).toContain("à défaut, ou si le salon est supprimé ou fermé au bot, l&apos;annonce part au terme de sa garde");
    expect(getiParagraph(readSource("app/rgpd/RgpdEn.tsx"))).toContain("failing that, or if the channel is deleted or closed to the bot, the post leaves");
  });

  it("rgpd_backupNote_listsGetiObjectionsAmongErasuresThatWouldComeBackFrAndEn", () => {
    expect(readSource("app/rgpd/page.tsx")).toContain("un signalement purgé, une opposition à la recopie des annonces de recrutement…) ne le sont pas");
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain("a report purged, an objection to the copying of recruitment posts…) are not");
  });

  it("privacyChange_getiEntry_objectionIdentifierAndRestoredBackupFrAndEn", () => {
    const fr = (entryFr?.details ?? []).join(" ");
    const en = (entryEn?.details ?? []).join(" ");
    expect(fr).toContain("et l'identifiant d'une annonce visée par une opposition, rien n'est gardé");
    expect(fr).toContain("Une sauvegarde restaurée ne connaîtrait pas une opposition enregistrée après elle");
    expect(fr).toContain("ou si le salon est supprimé ou fermé au bot");
    expect(en).toContain("and the identifier of a post targeted by an objection, nothing is kept");
    expect(en).toContain("A restored backup would not know an objection recorded after it");
    expect(en).toContain("or if the channel is deleted or closed to the bot");
  });

  it("botTexts_cache_refetchOnlyAfterAnEditNotEveryReread", () => {
    const texts = [JSON.stringify(PRIVACY_POLICY), record(PROCESSING_ACTIVITIES, "T08"), record(PROCESSING_ACTIVITIES_EN, "T08")].join(" ");
    expect(texts).toContain("(les derniers reçus, ou relus un à un après la modification d'un message qu'il n'avait plus)");
    expect(texts).toContain("(the latest received, or fetched again one by one after an edit of a message it no longer held)");
    expect(texts).not.toContain("reçus ou relus)");
    expect(texts).not.toContain("received or read again)");
  });

  it("register_t21_informationCoversDirectMembersAndFrenchClauseParsesFrAndEn", () => {
    const fr = record(PROCESSING_ACTIVITIES, "T21");
    const en = record(PROCESSING_ACTIVITIES_EN, "T21");
    expect(fr).toContain("y compris les membres qui écrivent dans les salons de l'association");
    expect(fr).toContain("exigerait des efforts disproportionnés et serait plus intrusif");
    expect(fr).not.toContain("exigeant des efforts");
    expect(en).toContain("members writing in the association's channels included");
  });

  it("register_t21_retentionBeforeTermMatchesSubPurposeFrAndEn", () => {
    const fr = record(PROCESSING_ACTIVITIES, "T21");
    const en = record(PROCESSING_ACTIVITIES_EN, "T21");
    expect(fr).toContain("retirée dès que le message est supprimé du salon de l'association");
    expect(fr).toContain("ne part qu'à la relecture suivante des salons, dans la limite des 5 000 derniers messages de chaque salon");
    expect(fr).not.toContain("supprimé sur Discord (par son auteur");
    expect(en).toContain("removed as soon as the message is deleted from the association's channel");
    expect(en).toContain("only leaves at the next reading of the channels, within the last 5,000 messages of each channel");
    expect(en).not.toContain("deleted on Discord (by its author");
  });

  it("register_t21_restoredBackupDoesNotKnowLaterObjectionFrAndEn", () => {
    expect(record(PROCESSING_ACTIVITIES, "T21")).toContain("une sauvegarde restaurée (T09) ne connaîtrait pas une opposition enregistrée après elle");
    expect(record(PROCESSING_ACTIVITIES_EN, "T21")).toContain("a restored backup (T09) would not know an objection recorded after it");
  });
});
