import { describe, expect, it } from "@jest/globals";
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "@/lib/shared/bot-legal-content";
import { formatAccountDeletionLog } from "@/lib/shared/bot-logs";
import { REPORT_FORM_NAME } from "@/lib/shared/legal-contact";
import {
  REPORT_FORM_NAME_EN,
  STREAM_NOTICE_CASTERS_EN,
  STREAM_NOTICE_LIVE_EN,
  STREAM_NOTICE_SERVICE_EN,
} from "@/lib/shared/legal-text-en";
import { VOICE_BOT_RELEASED_MAX_HOURS, VOICE_BOT_UNRELEASED_MAX_HOURS } from "@/lib/shared/match-voice";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN, REGISTER_UPDATED_AT } from "@/lib/shared/processing-register";
import { AUTOMOD_ALERT_SCOPE, DONNEES_PROFIL, DROITS, STREAM_PSEUDO_SCOPE } from "@/lib/shared/rgpd-policy";
import { DONNEES_PROFIL_EN, DROITS_EN } from "@/lib/shared/rgpd-policy-en";
import {
  REGISTRATION_STREAM_NOTICE_SHORT,
  STREAM_NOTICE_CASTERS,
  STREAM_NOTICE_LIVE,
  STREAM_NOTICE_SERVICE,
  registrationStreamNotice,
} from "@/lib/shared/stream-notice";
import { TERMS_SECTIONS, TERMS_UPDATED_AT, TERMS_VERSION, termsRequestFor } from "@/lib/shared/terms-of-use";
import { TERMS_SECTIONS_EN } from "@/lib/shared/terms-of-use-en";
import enActions from "@/messages/en/tournamentActions.json";
import enProfile from "@/messages/en/profile.json";
import frActions from "@/messages/fr/tournamentActions.json";
import frProfile from "@/messages/fr/profile.json";
import { readSource } from "../../helpers/read-source";

/**
 * TERMS-V11 (décisions de l'utilisateur D50 et D51 du 2026-11-11, avec D44 et
 * D47) : conditions d'utilisation version 11 — la diffusion sous le pseudo
 * passe à l'exécution du service, sans opposition par « nom neutre » — et les
 * entrées d'`ERREUR.txt` dont la correction tenait au texte des conditions.
 */
const V11_ID = "2026-11-conditions-v11-diffusion-sous-le-pseudo";
const termsFr = (id: string) => TERMS_SECTIONS.find((s) => s.id === id)?.paragraphs.join(" ") ?? "";
const termsEn = (id: string) => TERMS_SECTIONS_EN.find((s) => s.id === id)?.paragraphs.join(" ") ?? "";

describe("conditions d'utilisation, version 11", () => {
  it("termsV11_versionAndDate_are11And20261113", () => {
    expect(TERMS_VERSION).toBe(11);
    expect(TERMS_UPDATED_AT).toBe("2026-11-13");
    expect(termsRequestFor(10)).toBe("UPDATED");
    expect(termsRequestFor(11)).toBeNull();
  });
});

describe("D50 — diffusion sous le pseudo : exécution du service, plus de nom neutre", () => {
  it("streamNotice_service_saysPartOfTournamentFrAndEn", () => {
    expect(STREAM_NOTICE_SERVICE).toBe(
      "La diffusion et l'enregistrement d'un match sous le pseudo de ses joueurs font partie du tournoi auquel ils participent (exécution du service) : un joueur qui ne veut pas y paraître n'y participe pas.",
    );
    expect(STREAM_NOTICE_SERVICE_EN).toBe(
      "Streaming and recording a match under its players' usernames is part of the tournament they take part in (performance of the service): a player who does not want to appear in it does not take part.",
    );
  });

  it("streamNotice_everySharedSentence_carriesNoNeutralNameNorObjectionFr", () => {
    const sentences = [
      STREAM_NOTICE_SERVICE,
      STREAM_NOTICE_LIVE,
      REGISTRATION_STREAM_NOTICE_SHORT,
      registrationStreamNotice(true),
      registrationStreamNotice(false),
    ].join(" ");

    expect(sentences).not.toMatch(/nom neutre|opposer/);
  });

  it("streamNotice_everySharedSentence_carriesNoNeutralNameNorObjectionEn", () => {
    const sentences = [
      STREAM_NOTICE_SERVICE_EN,
      STREAM_NOTICE_LIVE_EN,
      enActions.register.streamNoticeShort,
      enActions.register.streamNotice.TEAM,
      enActions.register.streamNotice.SOLO,
    ].join(" ");

    expect(sentences).not.toMatch(/neutral name|object/);
  });

  it("registrationNotices_messagesFr_equalTheSharedModule", () => {
    expect(frActions.register.streamNotice.TEAM).toBe(registrationStreamNotice(false));
    expect(frActions.register.streamNotice.SOLO).toBe(registrationStreamNotice(true));
    expect(frActions.register.streamNoticeShort).toBe(REGISTRATION_STREAM_NOTICE_SHORT);
  });

  it("registrationNotices_messagesEn_sayPlayingMeansAppearing", () => {
    expect(enActions.register.streamNotice.TEAM).toContain("This streaming is part of the tournament: playing in it means appearing in it under your username.");
    expect(enActions.register.streamNotice.SOLO).toContain("This streaming is part of the tournament: playing in it means appearing in it under your username.");
    expect(enActions.register.streamNotice.SOLO).toContain("that announcement is part of the tournament too, and it is deleted on request.");
  });

  it("terms_retransmission_carriesServiceThenLiveSentenceFrAndEn", () => {
    expect(termsFr("retransmission")).toContain(`${STREAM_NOTICE_SERVICE} ${STREAM_NOTICE_LIVE}`);
    expect(termsEn("retransmission")).toContain(`${STREAM_NOTICE_SERVICE_EN} ${STREAM_NOTICE_LIVE_EN}`);
    expect(STREAM_NOTICE_LIVE).toContain("Une annonce est supprimée sur demande, par le bouton « Signaler un problème », catégorie RGPD.");
    expect(STREAM_NOTICE_LIVE_EN).toContain("An announcement is deleted on request, through the “Report a problem” button, GDPR category.");
  });

  it("registerT16_legalBasis_contractForPlayersCastersLinksAndAutoModAlertFrAndEn", () => {
    const fr = PROCESSING_ACTIVITIES.find((a) => a.ref === "T16")!;
    const en = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T16")!;

    expect(fr.legalBasis).toContain("pour la diffusion en direct et l'enregistrement de ses matchs sous son pseudo");
    expect(fr.legalBasis).toContain("même base, prévue par la même section des conditions, pour ce qui touche les casters (voix, pseudo, lien de leur chaîne, mode d'antenne), au titre du service auquel le caster s'inscrit sur un match, pour les liens de diffusion et de rediffusion publiés sur le site et pour l'alerte AutoMod");
    // D57b : aucun régime à part pour un joueur sans compte — plus d'intérêt légitime dans la base.
    expect(fr.legalBasis).not.toMatch(/intérêt légitime|droit d'opposition|sans compte/i);
    expect(en.legalBasis).toContain("for the live streaming and recording of their matches under their username");
    expect(en.legalBasis).toContain("same basis, provided for by the same section of the terms, for what concerns the casters (voice, username, link to their channel, live mode), under the service the caster registers for on a match, for the stream and replay links published on the site and for the AutoMod alert");
    expect(en.legalBasis).not.toMatch(/legitimate interest|right to object|no account/i);
    expect(en.retention).toHaveLength(fr.retention.length);
  });

  it("registerT16_wholeSheet_noLongerPromisesANeutralNameFrAndEn", () => {
    const fr = JSON.stringify(PROCESSING_ACTIVITIES.find((a) => a.ref === "T16"));
    const en = JSON.stringify(PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T16"));

    expect(fr).not.toContain("nom neutre");
    expect(en).not.toContain("neutral name");
    expect(REGISTER_UPDATED_AT).toBe("2026-11-15");
  });

  it("rgpdPolicy_sitePseudo_listsStreamingUnderContract", () => {
    const pseudo = DONNEES_PROFIL.find((d) => d.donnee === "Pseudo site");

    expect(pseudo?.extraBases).toContainEqual({ base: "Exécution du contrat", scope: STREAM_PSEUDO_SCOPE });
  });

  it("rgpdPolicy_sitePseudo_listsAutoModAlertUnderContract", () => {
    const pseudo = DONNEES_PROFIL.find((d) => d.donnee === "Pseudo site");

    expect(pseudo?.extraBases).toContainEqual({ base: "Exécution du contrat", scope: AUTOMOD_ALERT_SCOPE });
  });

  it("terms_retransmission_coversCastersLinksAndAutoModAlertFrAndEn", () => {
    expect(termsFr("retransmission")).toContain(STREAM_NOTICE_CASTERS);
    expect(termsEn("retransmission")).toContain(STREAM_NOTICE_CASTERS_EN);
    expect(STREAM_NOTICE_CASTERS).toContain("Relèvent de même de l'exécution du service : la voix, le pseudo et le lien de la chaîne du caster");
    expect(STREAM_NOTICE_CASTERS_EN).toContain("The following fall under performance of the service too: the voice, username and channel link of the caster");
  });

  it("rgpdPages_autoModAlert_noLongerOfferAnObjectionFrAndEn", () => {
    expect(readSource("app/rgpd/page.tsx")).not.toContain("s&apos;y opposer : demander sa suppression");
    expect(readSource("app/rgpd/RgpdEn.tsx")).not.toContain("to object: ask for its deletion");
  });

  it("botPrivacyPolicy_autoModAlert_restsOnPerformanceOfTheServiceFrAndEn", () => {
    expect(JSON.stringify(PRIVACY_POLICY.fr)).toContain("dans l'annonce #live d'un tournoi individuel, et de même pour l'alerte AutoMod d'une telle annonce bloquée ou signalée : à la suppression du compte du joueur, les modérateurs suppriment à la main les alertes qu'ils parviennent à identifier, sans garantie de toutes les retrouver.");
    expect(JSON.stringify(PRIVACY_POLICY.en)).toContain("in the #live announcement of a solo tournament, and likewise for the AutoMod alert of such an announcement when blocked or flagged: when the player's account is deleted, the moderators delete by hand the alerts they can identify, with no guarantee that all are found.");
  });

  it("privacyChange_termsV11_saysCastersLinksAndAlertMoveAndNoTransitionFrAndEn", () => {
    const fr = PRIVACY_CHANGES.find((change) => change.id === V11_ID);

    expect(fr?.details[1]).toContain("ils relèvent désormais eux aussi de l'exécution du service");
    expect(fr?.details[2]).toContain("La version 11 s'applique dès sa mise en ligne, sans régime transitoire.");
    expect(PRIVACY_CHANGES_EN[V11_ID].details[1]).toContain("they now fall under performance of the service too");
    expect(PRIVACY_CHANGES_EN[V11_ID].details[2]).toContain("Version 11 applies as soon as it goes online, with no transitional rule.");
  });

  it("rgpdPages_retransmission_sayPerformanceOfServiceWithoutNeutralNameObjectionFrAndEn", () => {
    const fr = readSource("app/rgpd/page.tsx");
    const en = readSource("app/rgpd/RgpdEn.tsx");

    expect(fr).toContain("{STREAM_NOTICE_SHOWN} {STREAM_NOTICE_SERVICE}");
    expect(fr).toContain("plus d&apos;opposition par « nom neutre »");
    expect(fr).not.toContain("le nom neutre ne vaut que pour la diffusion");
    expect(en).toContain("{STREAM_NOTICE_SHOWN_EN} {STREAM_NOTICE_SERVICE_EN}");
    expect(en).toContain("there is no longer an objection through a");
    expect(en).not.toContain("the neutral name applies to the stream only");
  });
});

describe("D44 — reprise d'une équipe : « membre », pas « joueur »", () => {
  it("terms_account_ownershipGoesToAnotherMemberNotCountingDeletingOnesFrAndEn", () => {
    expect(termsFr("compte")).toContain(
      "sinon à un autre membre de l'équipe, un membre suspendu ne passant qu'après tous les autres et un membre dont la suppression du compte est elle-même demandée n'étant pas compté ; une équipe où il ne reste aucun autre membre devient une équipe fantôme",
    );
    expect(termsEn("compte")).toContain(
      "else another member of the team, a suspended member only coming after all the others and a member whose own account deletion has been requested not being counted; a team left with no other member becomes a ghost team",
    );
  });

  it("terms_account_noLongerSaysPlayerForTheSuccessorFrAndEn", () => {
    expect(termsFr("compte")).not.toMatch(/autre joueur de l'équipe|seul joueur/);
    expect(termsEn("compte")).not.toMatch(/another player of the team|only player/);
  });

  it("deletionConfirmation_profileMessages_sayNoOtherMemberLeftFrAndEn", () => {
    expect(JSON.stringify(frProfile)).toContain("s'il ne reste aucun autre membre, l'équipe deviendra fantôme");
    expect(JSON.stringify(frProfile)).not.toContain("seul joueur, l'équipe");
    expect(JSON.stringify(enProfile)).toContain("if no other member is left, the team will become a ghost team");
  });

  it("terms_account_deletionIsRequestedFrAndEn", () => {
    expect(termsFr("compte")).toContain("Chaque utilisateur peut exporter ses données et demander la suppression de son compte à tout moment depuis son profil.");
    expect(termsFr("compte")).not.toContain("et supprimer son compte à tout moment");
    expect(termsEn("compte")).toContain("Each user can export their data and request the deletion of their account at any time from their profile.");
  });
});

describe("conditions v11 — précisions tirées d'ERREUR.txt", () => {
  it("terms_contents_reservesBattletagSavedBeforeOriginWasRecordedFrAndEn", () => {
    expect(termsFr("contenus")).toContain(
      "un BattleTag enregistré avant que le site n'en note l'origine, fin octobre 2026, sur un compte auquel Battle.net est rattaché, est tenu pour reçu de Battle.net jusqu'à la prochaine connexion Battle.net, même s'il avait été tapé",
    );
    expect(termsEn("contenus")).toContain(
      "a BattleTag saved before the site recorded its origin, in late October 2026, on an account with Battle.net linked, is treated as received from Battle.net until the next Battle.net login, even if it had been typed",
    );
  });

  it("terms_matchContacts_defineThePartiesOnceFrAndEn", () => {
    expect(termsFr("contacts-de-match").match(/membres de ses deux équipes, ses casters/g)).toHaveLength(1);
    expect(termsFr("contacts-de-match")).toContain("aux seules parties du match définies ci-dessus");
    expect(termsEn("contacts-de-match").match(/members of both its teams, its casters/g)).toHaveLength(1);
    expect(termsEn("contacts-de-match")).toContain("to the parties to the match alone as defined above");
  });

  it("terms_voiceChannels_sayDeletionRuleLikeTheRegisterFrAndEn", () => {
    expect(termsFr("contacts-de-match")).toContain(
      `et les supprime une fois que le site les lui a rendus (match terminé, reporté ou sorti du programme, notamment) et qu'ils sont vides — au plus tard environ ${VOICE_BOT_RELEASED_MAX_HOURS} heures après ce rendu, même occupés ; un salon que le site n'a jamais rendu est supprimé dès qu'il est vide passé ${VOICE_BOT_UNRELEASED_MAX_HOURS} heures après sa création ou sa reprise, et reste tant qu'il est occupé, et une erreur de Discord peut retarder une suppression sans limite : le bot réessaie alors à chaque balayage`,
    );
    expect(termsFr("contacts-de-match")).not.toContain("les supprime quand ils ne servent plus");
    expect(termsEn("contacts-de-match")).toContain(
      `and deletes them once the site has handed them back (match completed, postponed or taken off the schedule, among others) and they are empty — at the latest about ${VOICE_BOT_RELEASED_MAX_HOURS} hours after that hand-back, even when occupied; a channel the site never handed back is deleted as soon as it is empty once ${VOICE_BOT_UNRELEASED_MAX_HOURS} hours have passed since its creation or its reuse, and stays as long as it is occupied, and a Discord error can delay a deletion without limit: the bot then retries at every sweep`,
    );
    expect(termsEn("contacts-de-match")).not.toContain("deletes them once they are no longer needed");
  });
});

describe("entrée PRIVACY_CHANGES de la version 11", () => {
  const fr = PRIVACY_CHANGES.find((change) => change.id === V11_ID);
  const en = PRIVACY_CHANGES_EN[V11_ID];

  it("privacyChange_termsV11_isLastDatedWithTermsForAllAccounts", () => {
    // Suivie, le même jour, du rectificatif de la reprise d'équipe (#595), des avis d'équipe (TEAMS-LOT) et de leur réglage (TEAM-DM-OPTOUT).
    expect(PRIVACY_CHANGES.at(-5)?.id).toBe(V11_ID);
    expect(PRIVACY_CHANGES.at(-1)?.publishedAt).toBe(TERMS_UPDATED_AT);
    expect(fr?.publishedAt).toBe(TERMS_UPDATED_AT);
    expect(fr?.audience).toBeUndefined();
  });

  it("privacyChange_termsV11_asksTermsAcceptanceAndNamesTheVersion", () => {
    expect(fr?.asksTermsAcceptance).toBe(true);
    expect(fr?.title.startsWith("Conditions d'utilisation : version 11")).toBe(true);
    expect(fr?.details.at(-1)).toContain("la version 11, en vigueur depuis le 13 novembre 2026");
    expect(en.details.at(-1)).toContain("version 11, in force since 13 November 2026");
  });

  it("privacyChange_termsV11_saysWhatChangesForStreamsFrAndEn", () => {
    expect(fr?.summary).toContain("il n'est plus possible de s'y opposer pour apparaître sous un nom neutre");
    expect(fr?.details[0]).toContain("Ils font désormais partie du tournoi auquel tu participes, au titre de l'exécution du service");
    expect(en.summary).toContain("it is no longer possible to object to it and appear under a neutral name");
    expect(en.details[0]).toContain("They are now part of the tournament you take part in, under performance of the service");
  });

  it("privacyChange_termsV11_englishMirrorsFrenchShape", () => {
    expect(en.details).toHaveLength(fr?.details.length ?? 0);
    expect(en.linkLabels).toHaveLength(fr?.links?.length ?? 0);
  });
});

describe("documents du bot — D47 et reprise d'équipe", () => {
  it("botDocs_bothDocuments_areDated13November2026FrAndEn", () => {
    expect([TERMS_OF_SERVICE.fr.lastUpdated, TERMS_OF_SERVICE.en.lastUpdated]).toEqual(["13 novembre 2026", "13 November 2026"]);
    expect([PRIVACY_POLICY.fr.lastUpdated, PRIVACY_POLICY.en.lastUpdated]).toEqual(["13 novembre 2026", "13 November 2026"]);
  });

  // D4 (#595) : la reprise ne cite plus « un admin » — la politique du bot ne le dit plus.
  it("botPrivacyPolicy_teamTakeover_namesTheTeamOnlyFrAndEn", () => {
    expect(JSON.stringify(PRIVACY_POLICY.fr)).toContain("qui ne nomment que l'équipe, jamais personne ; information sur les données");
    expect(JSON.stringify(PRIVACY_POLICY.en)).toContain("which only name the team, never anyone; data-protection notice");
    expect(JSON.stringify(PRIVACY_POLICY.fr)).not.toContain("un admin");
    expect(JSON.stringify(PRIVACY_POLICY.en)).not.toContain("an admin");
  });
});

/**
 * Revue standard de la v11 et décision de l'utilisateur D55 (2026-11-11) :
 * l'alerte AutoMod d'une annonce #live n'est plus supprimée sur demande — les
 * modérateurs la suppriment à la main à la suppression du compte (D56b) ;
 * l'annonce #live, elle, reste supprimée sur demande.
 */
describe("D55 et revue standard v11", () => {
  const v11Fr = PRIVACY_CHANGES.find((c) => c.id === V11_ID)!;
  const v11En = PRIVACY_CHANGES_EN[V11_ID];
  const t16Fr = PROCESSING_ACTIVITIES.find((a) => a.ref === "T16")!;
  const t16En = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T16")!;
  const autoModLines = (lines: readonly string[]) => lines.filter((line) => /AutoMod/.test(line));

  it("streamNoticeCasters_autoModAlert_notDeletedOnRequestOtherwiseFrAndEn", () => {
    expect(STREAM_NOTICE_CASTERS.endsWith("; elle n'est pas supprimée sur demande autrement.")).toBe(true);
    expect(STREAM_NOTICE_CASTERS_EN.endsWith("; it is not deleted on request otherwise.")).toBe(true);
  });

  it("autoModAlertScope_noDeletionOnRequestFrAndEn", () => {
    const scopeEn = DONNEES_PROFIL_EN.find((d) => d.donnee === "Site username")?.extraBases?.find((b) => b.scope.startsWith("AutoMod alert"))?.scope;

    expect(AUTOMOD_ALERT_SCOPE).toBe("alerte AutoMod d'une telle annonce bloquée ou signalée, gardée dans le salon d'alertes des modérateurs, qui suppriment à la main, à la suppression de ton compte, celles qu'ils parviennent à identifier (sans garantie de toutes les retrouver)");
    expect(scopeEn).toBe("AutoMod alert for such an announcement when blocked or flagged, kept in the moderators' alert channel; when your account is deleted, they delete by hand those they can identify (with no guarantee that all are found)");
  });

  it("register_autoModAlert_noDeletionOnRequestInT01T08T16FrAndEn", () => {
    const sheets = ["T01", "T08", "T16"];
    const fr = PROCESSING_ACTIVITIES.filter((a) => sheets.includes(a.ref));
    const en = PROCESSING_ACTIVITIES_EN.filter((a) => sheets.includes(a.ref));
    const frAlert = fr.flatMap((a) => autoModLines([...a.retention, a.legalBasis])).join("\n");
    const enAlert = en.flatMap((a) => autoModLines([...a.retention, a.legalBasis])).join("\n");

    expect(frAlert).not.toMatch(/alerte AutoMod[^;\n]*(supprimée sur demande|ou sur demande)/i);
    expect(enAlert).not.toMatch(/AutoMod alert[^;\n]*(deleted on request|or on request|deleted at the request)/i);
    expect(t16Fr.retention.join(" ")).toContain("supprimé sur demande de l'équipe, du joueur ou du caster concerné");
  });

  it("botPrivacyPolicy_autoModAlert_noDeletionOnRequestFrAndEn", () => {
    const fr = JSON.stringify(PRIVACY_POLICY.fr);
    const en = JSON.stringify(PRIVACY_POLICY.en);

    expect(fr).not.toContain("est supprimée sur demande de la même façon");
    expect(en).not.toContain("is deleted on request in the same way");
    expect(fr).toContain("son alerte reste dans le salon d'alertes de modération ; à la suppression du compte du joueur (dès la demande, le site en avertit le staff sans nommer le joueur), les modérateurs suppriment à la main les alertes qu'ils parviennent à identifier, sans garantie de toutes les retrouver ; elle n'est pas supprimée sur demande autrement.");
    expect(en).toContain("its alert stays in the moderation alert channel; when the player's account is deleted (as soon as deletion is requested, the website tells the staff without naming the player), the moderators delete by hand the alerts they can identify, with no guarantee that all are found; it is not deleted on request otherwise.");
    expect(fr).toContain("supprimées sur demande de l'équipe, du joueur ou du caster concerné");
  });

  it("privacyChangeV11_autoModAlert_saysNoLongerDeletedOnRequestFrAndEn", () => {
    expect(v11Fr.details[1]).toContain("L'alerte n'est plus supprimée sur demande : quand le compte du joueur est supprimé, les modérateurs suppriment à la main les alertes qu'ils parviennent à identifier, sans garantie de toutes les retrouver.");
    expect(v11Fr.details.join(" ")).not.toContain("L'alerte reste supprimée sur demande");
    expect(v11En.details[1]).toContain("The alert is no longer deleted on request: when the player's account is deleted, the moderators delete by hand the alerts they can identify, with no guarantee that all are found.");
    expect(v11En.details.join(" ")).not.toContain("The alert is still deleted on request");
  });

  it("rgpdPages_autoModAlert_noDeletionOnRequestFrAndEn", () => {
    const fr = readSource("app/rgpd/page.tsx");
    const en = readSource("app/rgpd/RgpdEn.tsx");

    expect(fr).not.toContain("par les modérateurs ou sur demande");
    expect(fr).not.toContain("comme l&apos;alerte de modération");
    expect(en).not.toContain("delete it or on request");
    expect(en).not.toContain("as does the moderation alert");
  });

  it("rgpdEn_liveUsernameBasis_keepsSpaceBeforeStrong", () => {
    expect(readSource("app/rgpd/RgpdEn.tsx")).toMatch(/This username rests on\{" "\}\r?\n\s*<strong>performance of the service<\/strong>/);
  });

  it("privacyChangeV11_unreleasedVoiceChannel_deletedWhenEmptyAfterMaxHoursFrAndEn", () => {
    expect(v11Fr.details.join(" ")).toContain(`un salon jamais rendu étant supprimé dès qu'il est vide passé ${VOICE_BOT_UNRELEASED_MAX_HOURS} heures après sa création ou sa reprise, et restant tant qu'il est occupé`);
    expect(v11En.details.join(" ")).toContain(`a channel never handed back being deleted as soon as it is empty once ${VOICE_BOT_UNRELEASED_MAX_HOURS} hours have passed since its creation or its reuse, and staying as long as it is occupied`);
  });

  it("privacyChangeV11_correctsPublishedVoiceEntry_listsMatchAndTeamNumbersFrAndEn", () => {
    expect(v11Fr.details.join(" ")).toContain("le site garde, pour chaque salon, son identifiant, les numéros du match et de l'équipe, ses horaires (création, rendu, panne du bot ou rendu refusé) et si une panne touchait tout le bot");
    expect(v11En.details.join(" ")).toContain("the site keeps, for each channel, its identifier, the match and team numbers, its times (creation, hand-back, bot outage or refused hand-back) and whether an outage hit the whole bot");
  });

  it("registerT16_casters_baseOnTheirOwnRegistrationFrAndEn", () => {
    expect(t16Fr.legalBasis).toContain("mode d'antenne), au titre du service auquel le caster s'inscrit sur un match,");
    expect(t16En.legalBasis).toContain("live mode), under the service the caster registers for on a match,");
  });

  it("streamNoticeLive_reportFormName_followsSharedConstantFrAndEn", () => {
    expect(STREAM_NOTICE_LIVE).toContain(`par le bouton « ${REPORT_FORM_NAME} », catégorie RGPD.`);
    expect(STREAM_NOTICE_LIVE_EN).toContain(`${REPORT_FORM_NAME_EN}” button, GDPR category.`);
  });
});

describe("revue sécurité v11 — textes alignés sur le code", () => {
  const v11Fr = PRIVACY_CHANGES.find((c) => c.id === V11_ID)!;
  const v11En = PRIVACY_CHANGES_EN[V11_ID];

  it("rgpdPages_retransmission_noAlertDeletionOnRequestFrAndEn", () => {
    expect(readSource("app/rgpd/page.tsx")).not.toContain("celle de ces alertes");
    expect(readSource("app/rgpd/RgpdEn.tsx")).not.toContain("that of these alerts");
  });

  it("rgpdPages_accountDeletionHandover_skipsPendingDeletionMembersFrAndEn", () => {
    const fr = readSource("app/rgpd/page.tsx");
    const en = readSource("app/rgpd/RgpdEn.tsx");

    expect(fr).toContain("un membre dont la suppression du compte est elle-même demandée n&apos;étant pas compté ; une équipe où il ne reste aucun autre");
    expect(fr).not.toMatch(/dont il était le seul\s+joueur/);
    expect(en).toContain("a member whose own account deletion has been requested not being counted; a team left with");
    expect(en).not.toMatch(/only player becomes/);
  });

  it("termsV11_voiceTrace_listsRefusedHandBackAndWholeBotOutageFrAndEn", () => {
    expect(termsFr("contacts-de-match")).toContain("les numéros du match et de l'équipe, des horaires (création, rendu, panne du bot ou rendu refusé) et si une panne touchait tout le bot — ni qui s'y trouve, ni combien —");
    expect(termsEn("contacts-de-match")).toContain("times (creation, hand-back, bot outage or refused hand-back) and whether an outage hit the whole bot — neither who is in it nor how many —");
  });

  it("privacyChangeV11_refereeDiscordTag_keepsCasterExceptionFrAndEn", () => {
    expect(v11Fr.details.join(" ")).toContain("jamais par les arbitres sans rôle sur ce match (sauf si l'arbitre désigné caste aussi ce match, son tag suivant alors la règle des casters)");
    expect(v11En.details.join(" ")).toContain("never by referees who have no role in that match (unless the assigned referee also casts that match, their tag then following the casters' rule)");
  });
});

describe("revue juridique v11 — textes alignés", () => {
  const v11Fr = PRIVACY_CHANGES.find((c) => c.id === V11_ID)!;
  const v11En = PRIVACY_CHANGES_EN[V11_ID];

  it("privacyChangeV11_refereeTag_readByOtherPartiesFrAndEn", () => {
    expect(v11Fr.details.join(" ")).toContain("n'est lu que par les autres parties du match (ses deux équipes, ses casters)");
    expect(v11En.details.join(" ")).toContain("is only read by the other parties to the match (both its teams, its casters)");
  });

  // D4 (#595) : la reprise ne cite plus « un admin ».
  it("rgpdPages_pushParagraph_takeoverNamesTheTeamOnlyFrAndEn", () => {
    expect(readSource("app/rgpd/page.tsx")).toContain("(le nom de l&apos;équipe seul, jamais celui de qui invite, propose ou transfère), et de ce qui");
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain("(the team&apos;s name only, never who invites, offers or transfers), and of what");
    expect(readSource("app/rgpd/page.tsx")).not.toContain("« un admin »");
    expect(readSource("app/rgpd/RgpdEn.tsx")).not.toContain("“an admin”");
  });

  it("termsV11_voiceDeletionError_botRetriesThenModerationFrAndEn", () => {
    const fr = TERMS_SECTIONS.flatMap((s) => s.paragraphs).join(" ");
    const en = TERMS_SECTIONS_EN.flatMap((s) => s.paragraphs).join(" ");

    expect(fr).toContain("une erreur de Discord peut retarder une suppression sans limite : le bot réessaie alors à chaque balayage, et un salon qu'il finit par oublier relève de la modération du serveur");
    expect(fr).not.toContain("sans limite, le salon relevant alors");
    expect(en).toContain("a Discord error can delay a deletion without limit: the bot then retries at every sweep, and a channel it ends up forgetting falls to the server's moderation");
    expect(en).not.toContain("without limit, the channel then falling");
  });

  it("privacyChangeV11_botDetail_mentionsCasterDeletionRequestFrAndEn", () => {
    expect(v11Fr.details.join(" ")).toContain("le caster concerné peut, comme l'équipe ou le joueur, demander la suppression d'une annonce #live");
    expect(v11En.details.join(" ")).toContain("the caster concerned can, like the team or player, ask for a #live announcement to be deleted");
  });

  it("botPolicy_liveAnnouncementDeletion_includesCasterEn", () => {
    expect(JSON.stringify(PRIVACY_POLICY.en)).toContain("deleted at the request of the team, player or caster concerned");
  });
});

// D56b (2026-11-11) : l'alerte AutoMod est supprimée à la main par les
// modérateurs à la suppression du compte, que le journal du staff leur signale
// sans nommer le joueur. D57b : plus de régime à part pour un joueur sans compte.
describe("D56b — alerte AutoMod supprimée à la main à la suppression du compte", () => {
  const t = (ref: string) => JSON.stringify(PROCESSING_ACTIVITIES.find((a) => a.ref === ref));
  const tEn = (ref: string) => JSON.stringify(PROCESSING_ACTIVITIES_EN.find((a) => a.ref === ref));

  it("streamNoticeCasters_alert_deletedByHandAtAccountDeletionFrAndEn", () => {
    expect(STREAM_NOTICE_CASTERS).toContain("où elle reste : à la suppression du compte du joueur, les modérateurs suppriment à la main les alertes qu'ils parviennent à identifier, sans garantie de toutes les retrouver — dès la demande de suppression, le site en avertit le staff, sans nommer le joueur ; elle n'est pas supprimée sur demande autrement.");
    expect(STREAM_NOTICE_CASTERS_EN).toContain("where it stays: when the player's account is deleted, the moderators delete by hand the alerts they can identify, with no guarantee that all are found — as soon as deletion is requested, the site tells the staff, without naming the player; it is not deleted on request otherwise.");
  });

  it("registerT16_retention_saysStaffLogCarriesTournamentAndTimeOnlyFrAndEn", () => {
    expect(t("T16")).toContain("dès la demande de suppression, le site en avertit le staff dans son journal d'activité sur Discord, sans nommer le joueur (seuls y figurent le tournoi, le jour et une heure de chaque soirée #live d'un tournoi individuel où il a pu paraître, T05) ; elle n'est pas supprimée sur demande autrement");
    expect(tEn("T16")).toContain("as soon as deletion is requested, the site tells the staff in its activity log on Discord, without naming the player (only the tournament, the day and a time of each #live evening of a solo tournament in which they may have appeared are given, T05); it is not deleted on request otherwise");
  });

  it("registerT05_staffLog_declaresTheDeletionLineContentFrAndEn", () => {
    expect(t("T05")).toContain("les lignes de sa demande de suppression citent le tournoi, le jour et une heure de chaque soirée #live où il a pu paraître, pour que les modérateurs suppriment à la main celles de leurs alertes AutoMod qu'ils parviennent à identifier (T16)");
    expect(tEn("T05")).toContain("the lines of its deletion request quote the tournament, the day and a time of each #live evening in which they may have appeared, so that the moderators delete by hand those of their AutoMod alerts they can identify (T16)");
  });

  it("registerT01AndT08_alert_noLongerKeptAfterAccountDeletionFrAndEn", () => {
    expect(t("T01")).toContain("le staff est averti de la demande de suppression sans que le joueur soit nommé, et les modérateurs suppriment à la main les alertes qu'ils parviennent à identifier, sans garantie de toutes les retrouver (T16)");
    expect(t("T08")).toContain("à la suppression du compte du joueur, les modérateurs suppriment à la main celles qu'ils parviennent à identifier, sans garantie de toutes les retrouver (traitement T16)");
    expect(t("T08") + t("T16")).not.toContain("même après la suppression du compte du joueur\"");
    expect(tEn("T08")).toContain("when the player's account is deleted, the moderators delete by hand those they can identify, with no guarantee that all are found (processing activity T16)");
  });

  it("rgpdPolicy_alert_deletedByHandAtAccountDeletionFrAndEn", () => {
    expect(AUTOMOD_ALERT_SCOPE).toBe("alerte AutoMod d'une telle annonce bloquée ou signalée, gardée dans le salon d'alertes des modérateurs, qui suppriment à la main, à la suppression de ton compte, celles qu'ils parviennent à identifier (sans garantie de toutes les retrouver)");
    expect(DROITS.find((d) => d.title === "Droit à l'effacement")?.text).toContain("à la suppression de votre compte, le site avertit le staff dès votre demande, sans vous nommer, et les modérateurs suppriment à la main les alertes qu'ils parviennent à identifier, sans garantie de toutes les retrouver ; elle n'est pas supprimée sur demande autrement.");
    expect(DROITS_EN.find((d) => d.title === "Right to erasure")?.text).toContain("when your account is deleted, the site tells the staff as soon as you request it, without naming you, and the moderators delete by hand the alerts they can identify, with no guarantee that all are found; it is not deleted on request otherwise.");
  });

  it("rgpdPages_alert_sayHandDeletionAndAnonymousStaffNoticeFrAndEn", () => {
    expect(readSource("app/rgpd/page.tsx")).toContain("parviennent à identifier, sans garantie de toutes les retrouver : dès la demande de suppression, le site en");
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain("the alerts they can identify, with no guarantee that all are found: as soon as deletion is requested, the site tells the");
  });

  it("deletionResidual_alert_saysHandDeletionFrAndEn", () => {
    expect(JSON.stringify(frProfile)).toContain("qui garde ton pseudo (le staff est averti de ta demande, sans te nommer, et les modérateurs suppriment à la main les alertes qu'ils parviennent à identifier, sans garantie de toutes les retrouver)");
    expect(JSON.stringify(enProfile)).toContain("which keeps your username (the staff is told of your request, without naming you, and the moderators delete by hand the alerts they can identify, with no guarantee that all are found)");
  });

  it("botPrivacyPolicy_alert_saysHandDeletionAndStaffLogContentFrAndEn", () => {
    expect(JSON.stringify(PRIVACY_POLICY.fr)).toContain(": à la suppression du compte du joueur, les modérateurs suppriment à la main les alertes qu'ils parviennent à identifier, sans garantie de toutes les retrouver.");
    expect(JSON.stringify(PRIVACY_POLICY.fr)).toContain("le tournoi, le jour et une heure de chaque soirée #live où il a pu paraître, pour que les modérateurs suppriment à la main celles de leurs alertes AutoMod qu'ils parviennent à identifier");
    expect(JSON.stringify(PRIVACY_POLICY.en)).toContain(": when the player's account is deleted, the moderators delete by hand the alerts they can identify, with no guarantee that all are found.");
    expect(JSON.stringify(PRIVACY_POLICY.en)).toContain("the tournament, the day and a time of each #live evening in which they may have appeared, so that the moderators delete by hand those of their AutoMod alerts they can identify");
  });

  it("privacyChangeV11_alert_saysHandDeletionAndStaffNoticeFrAndEn", () => {
    const fr = PRIVACY_CHANGES.find((c) => c.id === V11_ID)!;

    expect(fr.details[1]).toContain("sans garantie de toutes les retrouver. Dès la demande de suppression, le site en avertit le staff dans son journal d'activité sur Discord, sans nommer le joueur");
    expect(PRIVACY_CHANGES_EN[V11_ID].details[1]).toContain("with no guarantee that all are found. As soon as deletion is requested, the site tells the staff in its activity log on Discord, without naming the player");
  });
});

describe("D57b — aucun régime à part pour un joueur sans compte", () => {
  it("v11Texts_everywhere_carryNoAccountlessPlayerWordingFr", () => {
    const texts = [
      TERMS_SECTIONS.flatMap((s) => s.paragraphs).join(" "),
      DROITS.map((d) => d.text).join(" "),
      JSON.stringify(PROCESSING_ACTIVITIES.find((a) => a.ref === "T16")),
      readSource("app/rgpd/page.tsx"),
      readSource("lib/shared/stream-notice.ts"),
    ].join(" ");

    expect(texts).not.toMatch(/joueur sans compte|STREAM_NOTICE_ACCOUNTLESS/);
  });

  it("v11Texts_everywhere_carryNoAccountlessPlayerWordingEn", () => {
    const texts = [
      TERMS_SECTIONS_EN.flatMap((s) => s.paragraphs).join(" "),
      DROITS_EN.map((d) => d.text).join(" "),
      JSON.stringify(PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T16")),
      readSource("app/rgpd/RgpdEn.tsx"),
      readSource("lib/shared/legal-text-en.ts"),
    ].join(" ");

    expect(texts).not.toMatch(/player with no account|STREAM_NOTICE_ACCOUNTLESS/);
  });
});

// Revue légale delta (D56c) : la section « Suppression du compte » de /rgpd
// dit ce que la ligne du staff ajoute ; la ligne demande toutes les alertes de
// ces soirées (elle ne nomme personne) ; le staff est averti dès la demande.
describe("revue légale delta (D56c)", () => {
  it("rgpdDeletionSection_staffLogLine_citesLiveEveningsFrAndEn", () => {
    const fr = readSource("app/rgpd/page.tsx");
    const en = readSource("app/rgpd/RgpdEn.tsx");

    expect(fr).toContain("les lignes de la demande citent aussi le tournoi, le jour et une heure de chaque soirée concernée, pour que les modérateurs suppriment à la main les alertes AutoMod qu&apos;ils parviennent à identifier, sans garantie de toutes les retrouver (<a href=\"#retransmission\">");
    expect(en).toContain("the lines of the request also quote the tournament, the day and a time of each evening concerned, so that the moderators delete by hand the AutoMod alerts they can identify, with no guarantee that all are found (<a href=\"#retransmission\">");
  });

  it("formatAccountDeletionLog_announcedAccount_asksToDeleteAllAlertsOfThoseEvenings", () => {
    const actual = formatAccountDeletionLog({
      days: 30,
      liveAnnouncements: { announcements: [{ tournamentName: "Solo Cup", sentAt: "2026-11-13T20:04:00.000Z" }], truncated: false },
    });

    expect(actual).toContain("supprimer à la main, dans le salon d'alertes AutoMod, toutes les alertes des messages #live de ces soirées");
    expect(actual).not.toContain("qui citent ses matchs");
  });

  it("legalTexts_staffWarning_saysAsSoonAsRequestFrAndEn", () => {
    expect(DROITS.find((d) => d.title === "Droit à l'effacement")?.text).toContain("le site avertit le staff dès votre demande");
    expect(DROITS_EN.find((d) => d.title === "Right to erasure")?.text).toContain("the site tells the staff as soon as you request it");
    expect(STREAM_NOTICE_CASTERS).toContain("dès la demande de suppression, le site en avertit le staff");
    expect(STREAM_NOTICE_CASTERS_EN).toContain("as soon as deletion is requested, the site tells the staff");
    expect(JSON.stringify(PRIVACY_POLICY.fr)).toContain("(dès la demande, le site en avertit le staff sans nommer le joueur)");
    expect(JSON.stringify(PRIVACY_POLICY.en)).toContain("(as soon as deletion is requested, the website tells the staff without naming the player)");
  });
});
