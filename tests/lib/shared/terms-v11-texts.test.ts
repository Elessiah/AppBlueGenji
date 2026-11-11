import { describe, expect, it } from "@jest/globals";
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "@/lib/shared/bot-legal-content";
import { STREAM_NOTICE_CASTERS_EN, STREAM_NOTICE_LIVE_EN, STREAM_NOTICE_SERVICE_EN } from "@/lib/shared/legal-text-en";
import { VOICE_BOT_RELEASED_MAX_HOURS } from "@/lib/shared/match-voice";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN, REGISTER_UPDATED_AT } from "@/lib/shared/processing-register";
import { AUTOMOD_ALERT_SCOPE, DONNEES_PROFIL, STREAM_PSEUDO_SCOPE } from "@/lib/shared/rgpd-policy";
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
    expect(fr.legalBasis).toContain("même base, prévue par la même section des conditions, pour ce qui touche les casters (voix, pseudo, lien de leur chaîne, mode d'antenne), pour les liens de diffusion et de rediffusion publiés sur le site et pour l'alerte AutoMod");
    expect(fr.legalBasis).not.toMatch(/intérêt légitime|droit d'opposition/i);
    expect(en.legalBasis).toContain("for the live streaming and recording of their matches under their username");
    expect(en.legalBasis).toContain("same basis, provided for by the same section of the terms, for what concerns the casters (voice, username, link to their channel, live mode), for the stream and replay links published on the site and for the AutoMod alert");
    expect(en.legalBasis).not.toMatch(/legitimate interest|right to object/i);
    expect(en.retention).toHaveLength(fr.retention.length);
  });

  it("registerT16_wholeSheet_noLongerPromisesANeutralNameFrAndEn", () => {
    const fr = JSON.stringify(PROCESSING_ACTIVITIES.find((a) => a.ref === "T16"));
    const en = JSON.stringify(PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T16"));

    expect(fr).not.toContain("nom neutre");
    expect(en).not.toContain("neutral name");
    expect(REGISTER_UPDATED_AT).toBe("2026-11-13");
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
    expect(JSON.stringify(PRIVACY_POLICY.fr)).toContain("dans l'annonce #live d'un tournoi individuel, et de même pour l'alerte AutoMod d'une telle annonce bloquée ou signalée, supprimée sur demande.");
    expect(JSON.stringify(PRIVACY_POLICY.en)).toContain("in the #live announcement of a solo tournament, and likewise for the AutoMod alert of such an announcement when blocked or flagged, deleted on request.");
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
      `et les supprime une fois que le site les lui a rendus (match terminé, reporté ou sorti du programme, notamment) et qu'ils sont vides — au plus tard environ ${VOICE_BOT_RELEASED_MAX_HOURS} heures après ce rendu, même occupés ; un salon que le site n'a jamais rendu reste tant qu'il est occupé, et une erreur de Discord peut retarder une suppression sans limite`,
    );
    expect(termsFr("contacts-de-match")).not.toContain("les supprime quand ils ne servent plus");
    expect(termsEn("contacts-de-match")).toContain(
      `and deletes them once the site has handed them back (match completed, postponed or taken off the schedule, among others) and they are empty — at the latest about ${VOICE_BOT_RELEASED_MAX_HOURS} hours after that hand-back, even when occupied; a channel the site never handed back stays as long as it is occupied, and a Discord error can delay a deletion without limit`,
    );
    expect(termsEn("contacts-de-match")).not.toContain("deletes them once they are no longer needed");
  });
});

describe("entrée PRIVACY_CHANGES de la version 11", () => {
  const fr = PRIVACY_CHANGES.find((change) => change.id === V11_ID);
  const en = PRIVACY_CHANGES_EN[V11_ID];

  it("privacyChange_termsV11_isLastDatedWithTermsForAllAccounts", () => {
    expect(PRIVACY_CHANGES.at(-1)?.id).toBe(V11_ID);
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

  it("botPrivacyPolicy_teamTakeover_saysItCitesAnAdminFrAndEn", () => {
    expect(JSON.stringify(PRIVACY_POLICY.fr)).toContain("qui ne nomment que l'équipe — une reprise cite « un admin », sans nommer personne ; information sur les données");
    expect(JSON.stringify(PRIVACY_POLICY.en)).toContain("which only name the team — a takeover mentions “an admin”, naming no one; data-protection notice");
  });
});
