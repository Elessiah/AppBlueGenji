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

  it("privacyChanges_termsV9_voiceDetailStatesLegitimateInterestAndAnonymousCountFrAndEn", () => {
    const fr = change(TERMS_V9_ID).details.join(" ");
    const en = PRIVACY_CHANGES_EN[TERMS_V9_ID].details.join(" ");

    expect(fr).toContain("repose toujours sur l'intérêt légitime de l'association");
    expect(fr).toContain("ce nombre ne sert qu'à retenir le lancement du match et n'est plus montré à personne");
    expect(fr).not.toContain("t'y opposer");
    expect(en).toContain("still rests on the association's legitimate interest");
    expect(en).toContain("that number only serves to hold the match's launch and is no longer shown to anyone");
    expect(en).not.toContain("object to it");
  });
});

describe("PRIVACY_CHANGES — conditions d'utilisation, version 9", () => {
  it("privacyChanges_termsV9_asksAcceptanceAndStatesVersionAndDateFrAndEn", () => {
    const fr = change(TERMS_V9_ID);
    const en = PRIVACY_CHANGES_EN[TERMS_V9_ID];

    expect(TERMS_VERSION).toBe(9);
    expect(fr.publishedAt).toBe(TERMS_UPDATED_AT);
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

describe("/rgpd — salons vocaux d'équipe (intérêt légitime, décision du 2026-11-04)", () => {
  it("rgpdPage_voiceChannels_legitimateInterestAnonymousWithoutObjectionFrAndEn", () => {
    const fr = readSource("app/rgpd/page.tsx");
    const en = readSource("app/rgpd/RgpdEn.tsx");

    expect(fr).toContain("Ce comptage relève de l&apos;<strong>intérêt légitime</strong> de l&apos;association");
    expect(fr).toContain("il ne sert qu&apos;à retenir le lancement et n&apos;est montré à personne) : il n&apos;a pas de droit");
    expect(fr).not.toContain("Salon vocal : 3/5");
    expect(fr).not.toContain("vous opposer à ce traitement en le demandant à l&apos;association");
    expect(fr).not.toContain("<strong>exécution du contrat</strong> : dans un tournoi qui a");
    expect(en).toContain("This count rests on the association&apos;s <strong>legitimate interest</strong>");
    expect(en).toContain("it only serves to hold the launch and is shown to no one): it has no right to object of its");
    expect(en).not.toContain("Voice channel: 3/5");
    expect(en).not.toContain("object to this processing by asking the association");
    expect(en).not.toContain("<strong>performance of the contract</strong>: in a tournament with the option");
  });
});

describe("/regles — règle commune « Salons vocaux d'équipe »", () => {
  it("commonRules_voiceChannels_isRuleWithLeadAndCapacityFromConstantsFrAndEn", () => {
    const frSection = localizedCommonRules(frRules).find((s) => s.title === "Salons vocaux d'équipe");
    const enSection = localizedCommonRules(enRules).find((s) => s.title === "Team voice channels");
    const frBody = formatMessage("fr", frSection?.body[0] ?? "", ruleTextValues("fr", frRules));
    const enBody = formatMessage("en", enSection?.body[0] ?? "", ruleTextValues("en", enRules));

    expect(frBody).toContain(`à partir de ${VOICE_CHANNEL_LEAD_MINUTES} minutes avant l'heure de chaque match`);
    expect(frBody).toContain(`un salon vocal de ${VOICE_CHANNEL_CAPACITY} places`);
    expect(enBody).toContain(`from ${VOICE_CHANNEL_LEAD_MINUTES} minutes before each match's time`);
    expect(enBody).toContain(`a ${VOICE_CHANNEL_CAPACITY}-seat voice channel`);
    // Décision R2 du 2026-11-04 : comptage anonyme, sans droit d'opposition.
    expect(frSection?.bullets?.join(" ")).toContain("Ce comptage est anonyme : il ne sert qu'à retenir le lancement et n'est montré à personne (la page du match dit seulement si chaque salon est ouvert et si le match attend ses salons). Il repose sur l'intérêt légitime de l'association");
    expect(frSection?.bullets?.join(" ")).not.toContain("t'y opposer");
    expect(enSection?.bullets?.join(" ")).toContain("This count is anonymous: it only serves to hold the launch and is shown to no one (the match page only says whether each channel is open and whether the match is waiting for its channels). It rests on the association's legitimate interest");
    expect(enSection?.bullets?.join(" ")).not.toContain("object to it");
  });
});

describe("notification de reprise d'équipe fantôme", () => {
  it("pushMessage_ghostTeamClaim_fr_usesTu", () => {
    expect(frPush.ghostTeamClaim.body).toBe("Un admin te propose de reprendre l'équipe {team}.");
  });
});

describe("conditions d'utilisation v9 — salons vocaux", () => {
  it("termsV9_voiceParagraph_legitimateInterestAnonymousCountFrAndEn", () => {
    const fr = TERMS_SECTIONS.find((s) => s.id === "contacts-de-match")?.paragraphs.join("\n") ?? "";
    const en = TERMS_SECTIONS_EN.find((s) => s.id === "contacts-de-match")?.paragraphs.join("\n") ?? "";

    expect(fr).toContain("fait partie du **déroulement du tournoi**");
    expect(fr).toContain("Ce comptage, anonyme (un nombre, jamais qui ; il ne sert qu'à retenir le lancement et n'est montré à personne : la page du match dit seulement si chaque salon est ouvert et si le match attend ses salons), repose sur l'intérêt légitime de l'association au bon déroulement des tournois.");
    expect(fr).not.toContain("s'y opposer");
    expect(en).toContain("is part of the **running of the tournament**");
    expect(en).toContain("This count, which is anonymous (a number, never who; it only serves to hold the launch and is shown to no one: the match page only says whether each channel is open and whether the match is waiting for its channels), rests on the association's legitimate interest in the smooth running of tournaments.");
    expect(en).not.toContain("object to it");
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

// Revue juridique #546, cycle 5 : conditions et /regles disent aussi l'attente des salons.
describe("salons vocaux — la page dit aussi si le match attend ses salons (FR + EN)", () => {
  it("termsV9AndRules_voiceWording_mentionWaitingForChannelsFrAndEn", () => {
    const fr = TERMS_SECTIONS.flatMap((s) => s.paragraphs).join(" ");
    const en = TERMS_SECTIONS_EN.flatMap((s) => s.paragraphs).join(" ");

    expect(fr).toContain("la page du match dit seulement si chaque salon est ouvert et si le match attend ses salons");
    expect(en).toContain("the match page only says whether each channel is open and whether the match is waiting for its channels");
    expect(JSON.stringify(frRules)).toContain("la page du match dit seulement si chaque salon est ouvert et si le match attend ses salons");
    expect(JSON.stringify(enRules)).toContain("the match page only says whether each channel is open and whether the match is waiting for its channels");
  });
});
