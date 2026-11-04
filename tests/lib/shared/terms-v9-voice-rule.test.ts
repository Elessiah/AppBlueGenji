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

  it("privacyChanges_termsV9_voiceDetailStatesLegitimateInterestAndObjectionFrAndEn", () => {
    const fr = change(TERMS_V9_ID).details.join(" ");
    const en = PRIVACY_CHANGES_EN[TERMS_V9_ID].details.join(" ");

    expect(fr).toContain("repose toujours sur l'intérêt légitime de l'association");
    expect(fr).toContain("tu peux t'y opposer en le demandant à l'association");
    expect(fr).not.toContain("sans droit d'opposition propre");
    expect(en).toContain("still rests on the association's legitimate interest");
    expect(en).toContain("you can object to it by asking the association");
    expect(en).not.toContain("no right to object of its own");
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

    expect(fr).toContain("le message privé qui annonçait la version 6 des conditions d'utilisation finissait par « Aucun accord ne t'est demandé »");
    expect(en).toContain("the private message announcing version 6 of the terms of use ended with “No consent is asked of you”");
    // L'entrée publiée de la version 6 n'est jamais retouchée.
    expect(v6.asksTermsAcceptance).toBeUndefined();
    expect(v6.publishedAt).toBe("2026-10-19");
  });

  it("privacyChanges_termsV9_saysAnonymousFromRequestAndSuspendedReactivationFrAndEn", () => {
    const fr = change(TERMS_V9_ID).details.join(" ");
    const en = PRIVACY_CHANGES_EN[TERMS_V9_ID].details.join(" ");

    expect(fr).toContain("le compte est montré anonyme partout");
    expect(fr).toContain("un compte suspendu peut aussi être réactivé, et revient suspendu");
    expect(fr).toContain("retirée de ce journal à la réactivation");
    expect(en).toContain("the account is shown as anonymous everywhere");
    expect(en).toContain("a suspended account can be reactivated too, and comes back suspended");
    expect(en).toContain("removed from that log on reactivation");
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
  it("rgpdPage_voiceChannels_legitimateInterestWithObjectionByRequestFrAndEn", () => {
    const fr = readSource("app/rgpd/page.tsx");
    const en = readSource("app/rgpd/RgpdEn.tsx");

    expect(fr).toContain("Ce comptage relève de l&apos;<strong>intérêt légitime</strong> de l&apos;association");
    expect(fr).toContain("vous opposer à ce traitement en le demandant à l&apos;association, par le formulaire de signalement (catégorie RGPD)");
    expect(fr).not.toContain("<strong>exécution du contrat</strong> : dans un tournoi qui a");
    expect(en).toContain("This count rests on the association&apos;s <strong>legitimate interest</strong>");
    expect(en).toContain("object to this processing by asking the association, through the report form (GDPR category)");
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
    expect(frSection?.bullets?.join(" ")).toContain("repose sur l'intérêt légitime de l'association (bon déroulement des tournois) : tu peux t'y opposer en le demandant à l'association");
    expect(enSection?.bullets?.join(" ")).toContain("rests on the association's legitimate interest (smooth running of tournaments): you can object to it by asking the association");
  });
});

describe("notification de reprise d'équipe fantôme", () => {
  it("pushMessage_ghostTeamClaim_fr_usesTu", () => {
    expect(frPush.ghostTeamClaim.body).toBe("Un admin te propose de reprendre l'équipe {team}.");
  });
});

describe("conditions d'utilisation v9 — salons vocaux", () => {
  it("termsV9_voiceParagraph_legitimateInterestWithObjectionFrAndEn", () => {
    const fr = TERMS_SECTIONS.find((s) => s.id === "contacts-de-match")?.paragraphs.join("\n") ?? "";
    const en = TERMS_SECTIONS_EN.find((s) => s.id === "contacts-de-match")?.paragraphs.join("\n") ?? "";

    expect(fr).toContain("fait partie du **déroulement du tournoi**");
    expect(fr).toContain("Ce comptage repose sur l'intérêt légitime de l'association au bon déroulement des tournois ; chacun peut s'y opposer en le demandant à l'association");
    expect(fr).not.toContain("sans droit d'opposition propre");
    expect(en).toContain("is part of the **running of the tournament**");
    expect(en).toContain("This count rests on the association's legitimate interest in the smooth running of tournaments; anyone can object to it by asking the association");
    expect(en).not.toContain("no right to object of its own");
  });
});
