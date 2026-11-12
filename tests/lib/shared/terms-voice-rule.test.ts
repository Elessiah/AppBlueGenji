import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { TERMS_SECTIONS, TERMS_UPDATED_AT, TERMS_VERSION } from "@/lib/shared/terms-of-use";
import { TERMS_SECTIONS_EN } from "@/lib/shared/terms-of-use-en";
import { localizedCommonRules, ruleTextValues } from "@/lib/shared/tournament-rules";
import { VOICE_CHANNEL_CAPACITY, VOICE_CHANNEL_LEAD_MINUTES } from "@/lib/shared/match-voice";
import { formatMessage } from "@/lib/shared/message-format";
import frRules from "@/messages/fr/rules.json";
import enRules from "@/messages/en/rules.json";
import frPush from "@/messages/fr/pushMessages.json";
import { readSource } from "../../helpers/read-source";

const VOICE_ID = "2026-11-salons-vocaux-regle-du-tournoi";
const TERMS_V9_ID = "2026-11-conditions-v9-contacts-et-suppression";

function change(id: string) {
  const entry = PRIVACY_CHANGES.find((c) => c.id === id);
  if (!entry) throw new Error(`entrée ${id} absente`);
  return entry;
}

describe("PRIVACY_CHANGES — salons vocaux (décision du 2026-11-04 : intérêt légitime)", () => {
  it("privacyChanges_voiceChannelsContractEntry_removedFrAndEn", () => {
    expect(PRIVACY_CHANGES.some((c) => c.id === VOICE_ID)).toBe(false);
    expect(PRIVACY_CHANGES_EN[VOICE_ID]).toBeUndefined();
  });

  it("privacyChanges_termsV9_voiceDetailNoGateNoCountLegitimateInterestFrAndEn", () => {
    const fr = change(TERMS_V9_ID).details.join(" ");
    const en = PRIVACY_CHANGES_EN[TERMS_V9_ID].details.join(" ");

    expect(fr).toContain("le lancement du match n'en dépend pas et personne n'y est compté");
    expect(fr).toContain("ces salons reposent sur l'intérêt légitime de l'association");
    expect(fr).not.toContain("retenir le lancement");
    expect(fr).not.toContain("t'y opposer");
    expect(en).toContain("the match's launch does not depend on it and no one is counted in it");
    expect(en).toContain("these channels rest on the association's legitimate interest");
    expect(en).not.toContain("hold the match's launch");
    expect(en).not.toContain("object to it");
  });
});

describe("PRIVACY_CHANGES — conditions d'utilisation, version 9", () => {
  it("privacyChanges_termsV9_asksAcceptanceAndStatesVersionAndDateFrAndEn", () => {
    const fr = change(TERMS_V9_ID);
    const en = PRIVACY_CHANGES_EN[TERMS_V9_ID];

    // Publiée et figée : la version 10 ne la retouche pas.
    expect(TERMS_VERSION).toBeGreaterThan(9);
    expect(fr.publishedAt).not.toBe(TERMS_UPDATED_AT);
    expect(fr.asksTermsAcceptance).toBe(true);
    expect(fr.publishedAt).toBe("2026-11-06");
    expect(fr.details.at(-1)).toContain("la version 9, en vigueur depuis le 6 novembre 2026");
    expect(en.details.at(-1)).toContain("version 9, in force since 6 November 2026");
  });

  it("privacyChanges_termsV9_foldsV6AcceptanceCorrectionFrAndEn", () => {
    const fr = change(TERMS_V9_ID).details.join(" ");
    const en = PRIVACY_CHANGES_EN[TERMS_V9_ID].details.join(" ");
    const v6 = change("2026-10-conditions-v6-acceptation-pour-tous");

    expect(fr).toContain("le message privé qui annonçait la version 6 des conditions d'utilisation disait « Aucun accord ne t'est demandé »");
    expect(en).toContain("the private message announcing version 6 of the terms of use said “No consent is asked of you”");
    // L'entrée publiée de la version 6 n'est jamais retouchée.
    expect(v6.asksTermsAcceptance).toBeUndefined();
    expect(v6.publishedAt).toBe("2026-10-19");
  });

  it("privacyChanges_termsV9_saysAnonymousFromRequestAndSuspendedReactivationFrAndEn", () => {
    const fr = change(TERMS_V9_ID).details.join(" ");
    const en = PRIVACY_CHANGES_EN[TERMS_V9_ID].details.join(" ");

    expect(fr).toContain("le compte est montré anonyme partout");
    expect(fr).toContain("un compte suspendu peut aussi être réactivé, et revient suspendu");
    expect(fr).toContain("remplacée dans ce journal, à la réactivation, par une ligne qui porte la date de celle-ci et celle de la demande défaite");
    expect(en).toContain("the account is shown as anonymous everywhere");
    expect(en).toContain("a suspended account can be reactivated too, and comes back suspended");
    expect(en).toContain("replaced in that log, on reactivation, by a line carrying the date of the reactivation and that of the undone request");
    expect(PRIVACY_CHANGES_EN[TERMS_V9_ID].details).toHaveLength(change(TERMS_V9_ID).details.length);
  });

  it("privacyChanges_termsV9_linksContactsAndAccountSectionsFrAndEn", () => {
    const fr = change(TERMS_V9_ID);
    const en = PRIVACY_CHANGES_EN[TERMS_V9_ID];
    const sectionIds = TERMS_SECTIONS.map((s) => s.id);

    expect(fr.links?.map((l) => l.href)).toEqual(["/conditions-utilisation#contacts-de-match", "/conditions-utilisation#compte"]);
    expect(sectionIds).toEqual(expect.arrayContaining(["contacts-de-match", "compte"]));
    expect(en.linkLabels).toEqual(["Read the “Match contacts” section", "Read the “Account” section"]);
  });
});

describe("/rgpd — salons vocaux d'équipe (intérêt légitime, sans attente ni comptage : EF-43)", () => {
  it("rgpdPage_voiceChannels_legitimateInterestWithoutGateNorCountFrAndEn", () => {
    const fr = readSource("app/rgpd/page.tsx");
    const en = readSource("app/rgpd/RgpdEn.tsx");

    expect(fr).toContain("Ces salons relèvent de l&apos;<strong>intérêt légitime</strong> de l&apos;association");
    expect(fr).toContain("Le lancement du match n&apos;en dépend pas");
    expect(fr).toContain("jamais qui se trouve dans un salon, ni combien");
    expect(fr).not.toContain("comptage");
    expect(fr).not.toContain("deux salons pleins");
    expect(fr).not.toContain("vous opposer à ce traitement en le demandant à l&apos;association");
    expect(en).toContain("These channels rest on the association&apos;s <strong>legitimate interest</strong>");
    expect(en).toContain("The match&apos;s launch doesn&apos;t depend on them");
    expect(en).toContain("never who is in a channel, nor how many");
    expect(en).not.toContain("This count");
    expect(en).not.toContain("channels are full");
    expect(en).not.toContain("object to this processing by asking the association");
  });

  it("rgpdPage_voiceChannels_soloOrGhostEnteringMatchHandsBackFrAndEn", () => {
    expect(readSource("app/rgpd/page.tsx")).toContain("quand une entrée en tournoi individuel ou une équipe fantôme entre dans le match");
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain("when a solo entry or a ghost team enters the match");
  });
});

describe("/regles — règle commune « Salons vocaux d'équipe »", () => {
  it("commonRules_voiceChannels_isRuleWithLeadAndCapacityFromConstantsFrAndEn", () => {
    const frSection = localizedCommonRules(frRules).find((s) => s.title === "Salons vocaux d'équipe");
    const enSection = localizedCommonRules(enRules).find((s) => s.title === "Team voice channels");
    const frBody = formatMessage("fr", frSection?.body[0] ?? "", ruleTextValues("fr", frRules));
    const enBody = formatMessage("en", enSection?.body[0] ?? "", ruleTextValues("en", enRules));

    expect(frBody).toContain(`à partir de ${VOICE_CHANNEL_LEAD_MINUTES} minutes avant l'heure de chaque match programmé (un match sans horaire n'a pas de salon)`);
    expect(frBody).toContain(`un salon vocal de ${VOICE_CHANNEL_CAPACITY} places`);
    expect(enBody).toContain(`from ${VOICE_CHANNEL_LEAD_MINUTES} minutes before the time of each scheduled match (a match with no set time has no channel)`);
    expect(enBody).toContain(`a ${VOICE_CHANNEL_CAPACITY}-seat voice channel`);
    // EF-43 (décision 22 du 2026-11-04) : le départ ne dépend plus des salons,
    // le site ne compte plus personne.
    expect(frSection?.bullets?.join(" ")).toContain("Les salons ne retiennent jamais le lancement du match");
    expect(frSection?.bullets?.join(" ")).toContain("ni qui s'y trouve, ni combien de personnes s'y trouvent");
    expect(frSection?.bullets?.join(" ")).not.toContain("comptage");
    expect(enSection?.bullets?.join(" ")).toContain("The channels never hold the match's launch");
    expect(enSection?.bullets?.join(" ")).toContain("neither who is in it nor how many people are");
    expect(enSection?.bullets?.join(" ")).not.toContain("count");
  });
});

describe("notification de reprise d'équipe fantôme", () => {
  it("pushMessage_ghostTeamClaim_fr_usesTu", () => {
    expect(frPush.ghostTeamClaim.body).toBe("Tu peux reprendre l'équipe «\u00a0{team}\u00a0». Accepte ou refuse depuis ton profil.");
  });
});

// VOICE-FOLLOWUP (ERREUR.txt, revue juridique #575) : la version 10, pas encore
// en ligne, réécrit sur place le passage des salons vocaux (D13, D15, D36).
const voiceTermsFr = () => TERMS_SECTIONS.find((s) => s.id === "contacts-de-match")?.paragraphs.join(" ") ?? "";
const voiceTermsEn = () => TERMS_SECTIONS_EN.find((s) => s.id === "contacts-de-match")?.paragraphs.join(" ") ?? "";

describe("conditions d'utilisation v10 — salons vocaux", () => {
  it("termsV10_voiceParagraph_openToCategoryAndJoiningIsAChoiceFrAndEn", () => {
    expect(voiceTermsFr()).toContain("proposer à chaque équipe son salon vocal Discord avant chacun de ses matchs programmés (ceux qui ont un horaire) fait partie du **déroulement du tournoi**");
    expect(voiceTermsFr()).toContain("Les rejoindre reste un choix : le lancement du match n'en dépend pas.");
    expect(voiceTermsFr()).toContain("Ils sont ouverts à qui voit la catégorie des matchs sur le serveur Discord de l'association.");
    expect(voiceTermsFr()).not.toContain("personne n'y est compté");
    expect(voiceTermsEn()).toContain("offering each team its Discord voice channel before each of its scheduled matches (those that have a set time) is part of the **running of the tournament**");
    expect(voiceTermsEn()).toContain("Joining them remains a choice: the match's launch does not depend on them.");
    expect(voiceTermsEn()).toContain("They are open to whoever sees the match category on the association's Discord server.");
    expect(voiceTermsEn()).not.toContain("no one is counted");
  });

  it("termsV10_voiceParagraph_voiceStateReadInMemoryNotRecordedFrAndEn", () => {
    expect(voiceTermsFr()).toContain("le bot lit l'état vocal de ce serveur (qui se trouve dans quel salon, avec ce que Discord y joint : micro, caméra, profil sur le serveur), qu'il tient en mémoire sans l'enregistrer");
    expect(voiceTermsEn()).toContain("the bot reads that server's voice state (who is in which channel, with what Discord attaches to it: microphone, camera, server profile), which it holds in memory without recording it");
  });

  it("termsV10_voiceParagraph_clearByRefereesOrOwnTeamLeadersFrAndEn", () => {
    expect(voiceTermsFr()).toContain("L'arbitrage (arbitres et administrateurs qui ne jouent pas le match), ou le propriétaire, un manager ou le capitaine d'une équipe pour le salon de sa propre équipe, peut **vider** un salon");
    expect(voiceTermsFr()).toContain("le bot en déconnecte tous les occupants, sans garder qui ils sont — le journal d'audit de Discord garde ces déconnexions");
    expect(voiceTermsEn()).toContain("The referees (referees and administrators who do not play the match), or a team's owner, a manager or its captain for their own team's channel, can **clear** a channel");
    expect(voiceTermsEn()).toContain("the bot disconnects all its occupants, without keeping who they are — Discord's audit log keeps these disconnections");
  });

  it("termsV10_voiceParagraph_siteKeepsNoUserDataAndLegitimateInterestKeptFrAndEn", () => {
    expect(voiceTermsFr()).toContain("que son identifiant, les numéros du match et de l'équipe, des horaires (création, rendu, panne du bot ou rendu refusé) et si une panne touchait tout le bot — ni qui s'y trouve, ni combien —");
    expect(voiceTermsFr()).toContain("un vidage par l'arbitrage nomme en outre son auteur dans les journaux du serveur, sauf l'arbitre désigné du match");
    expect(voiceTermsFr()).toContain("Ces salons reposent sur l'intérêt légitime de l'association au bon déroulement des tournois.");
    expect(voiceTermsFr()).not.toContain("s'y opposer");
    expect(voiceTermsEn()).toContain("only keeps its identifier, the match and team numbers, times (creation, hand-back, bot outage or refused hand-back) and whether an outage hit the whole bot — neither who is in it nor how many —");
    expect(voiceTermsEn()).toContain("a clearing by the referees also names its author in the server logs, unless they are the match's assigned referee");
    expect(voiceTermsEn()).toContain("These channels rest on the association's legitimate interest in the smooth running of tournaments.");
    expect(voiceTermsEn()).not.toContain("object to it");
  });
});

// Décision R3 du 2026-11-04, revue juridique #546 cycle 3 : les textes disent
// tout ce que fait `account-deletion-hold.ts` (OG, puis OG2… OG10, sinon le pseudo d'emprunt).
describe("pseudo rendu à la réactivation — suffixe « OG » (FR + EN)", () => {
  it("legalTexts_ogSuffix_mentionsCounterAndFallbackFrAndEn", () => {
    const fr = TERMS_SECTIONS.find((s) => s.id === "compte")?.paragraphs.join(" ") ?? "";
    const en = TERMS_SECTIONS_EN.find((s) => s.id === "compte")?.paragraphs.join(" ") ?? "";

    expect(fr).toContain("« OG2 », « OG3 »… jusqu'à « OG10 » si ceux-là le sont aussi, à défaut le pseudo d'emprunt");
    expect(en).toContain("“OG2”, “OG3”… up to “OG10” if those are taken too, failing that the borrowed username");
    expect(change(TERMS_V9_ID).details.join(" ")).toContain("jusqu'à « OG10 »");
    expect(PRIVACY_CHANGES_EN[TERMS_V9_ID].details.join(" ")).toContain("up to “OG10”");
    expect(readSource("app/rgpd/page.tsx")).toContain("jusqu&apos;à « OG10 »");
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain("up to “OG10”");
  });
});

// EF-43 : la version 9, pas encore en ligne, est reformulée sur place — plus d'attente des salons.
describe("salons vocaux — la page dit seulement si chaque salon est ouvert (FR + EN)", () => {
  it("termsV9AndRules_voiceWording_noWaitingForChannelsFrAndEn", () => {
    const fr = TERMS_SECTIONS.flatMap((s) => s.paragraphs).join(" ");
    const en = TERMS_SECTIONS_EN.flatMap((s) => s.paragraphs).join(" ");

    expect(fr).toContain("la page du match dit seulement si chaque salon est ouvert, bientôt ouvert ou indisponible.");
    expect(fr).not.toContain("attend ses salons");
    expect(en).toContain("the match page only says whether each channel is open, opening soon or unavailable.");
    expect(en).not.toContain("waiting for its channels");
    // /regles ne parle plus d'attente non plus (EF-43).
    expect(JSON.stringify(frRules)).not.toContain("si le match attend ses salons");
    expect(JSON.stringify(enRules)).not.toContain("whether the match is waiting for its channels");
  });
});
