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

describe("PRIVACY_CHANGES — salons vocaux, règle du tournoi (décision V6)", () => {
  it("privacyChanges_voiceChannelsRule_dated1105ForAllAccountsAfterRefereeTagEntry", () => {
    const entry = change(VOICE_ID);
    const ids = PRIVACY_CHANGES.map((c) => c.id);

    expect(entry.publishedAt).toBe("2026-11-05");
    expect(entry.asksTermsAcceptance).toBeUndefined();
    expect(entry.links?.map((l) => l.href)).toEqual(["/rgpd#salons-vocaux"]);
    expect(ids.indexOf(VOICE_ID)).toBe(ids.indexOf("2026-11-tag-discord-arbitre-execution-du-service") + 1);
  });

  it("privacyChanges_voiceChannelsRule_statesContractNoObjectionFrAndEn", () => {
    const fr = change(VOICE_ID);
    const en = PRIVACY_CHANGES_EN[VOICE_ID];

    expect(fr.summary).toContain("fait désormais partie du règlement du tournoi");
    expect(fr.summary).toContain("il n'a plus de droit d'opposition propre");
    expect(fr.details[0]).toContain("devient l'exécution du contrat");
    expect(en.summary).toContain("is now part of the tournament rules");
    expect(en.summary).toContain("it no longer has a right to object of its own");
    expect(en.details[0]).toContain("becomes the performance of the contract");
    expect(en.details).toHaveLength(fr.details.length);
  });
});

describe("PRIVACY_CHANGES — conditions d'utilisation, version 9", () => {
  it("privacyChanges_termsV9_asksAcceptanceAndStatesVersionAndDateFrAndEn", () => {
    const fr = change(TERMS_V9_ID);
    const en = PRIVACY_CHANGES_EN[TERMS_V9_ID];

    expect(TERMS_VERSION).toBe(9);
    expect(fr.publishedAt).toBe(TERMS_UPDATED_AT);
    expect(fr.asksTermsAcceptance).toBe(true);
    expect(fr.details.at(-1)).toContain("la version 9, en vigueur depuis le 5 novembre 2026");
    expect(en.details.at(-1)).toContain("version 9, in force since 5 November 2026");
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

describe("/rgpd — salons vocaux d'équipe (décision V6)", () => {
  it("rgpdPage_voiceChannels_contractBasisWithoutObjectionFrAndEn", () => {
    const fr = readSource("app/rgpd/page.tsx");
    const en = readSource("app/rgpd/RgpdEn.tsx");

    expect(fr).toContain("ce comptage relève de l&apos;<strong>exécution du contrat</strong>");
    expect(fr).toContain("il n&apos;a donc pas de droit d&apos;opposition propre");
    expect(fr).not.toContain("vous pouvez vous opposer à ce traitement (section « Vos droits ») (<Link href=\"/rgpd/registre#t18\">");
    expect(en).toContain("the <strong>performance of the contract</strong>");
    expect(en).toContain("it therefore has no right to object of its own");
    expect(en).not.toContain("you can object to this processing (section “Your rights”) (<LocaleLink href=\"/rgpd/registre#t18\">");
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
    expect(frSection?.bullets?.join(" ")).toContain("sans droit d'opposition propre");
    expect(enSection?.bullets?.join(" ")).toContain("with no right to object of its own");
  });
});

describe("notification de reprise d'équipe fantôme", () => {
  it("pushMessage_ghostTeamClaim_fr_usesTu", () => {
    expect(frPush.ghostTeamClaim.body).toBe("Un admin te propose de reprendre l'équipe {team}.");
  });
});

describe("conditions d'utilisation v9 — salons vocaux", () => {
  it("termsV9_voiceParagraph_contractNoObjectionFrAndEn", () => {
    const fr = TERMS_SECTIONS.find((s) => s.id === "contacts-de-match")?.paragraphs.join("\n") ?? "";
    const en = TERMS_SECTIONS_EN.find((s) => s.id === "contacts-de-match")?.paragraphs.join("\n") ?? "";

    expect(fr).toContain("fait partie du **règlement du tournoi**");
    expect(fr).toContain("sans droit d'opposition propre : une équipe qui ne veut pas s'y plier ne s'inscrit pas à ce tournoi, ou s'en retire.");
    expect(en).toContain("is part of the **tournament rules**");
    expect(en).toContain("with no right to object of its own: a team that does not want to abide by it does not register for that tournament, or withdraws from it.");
  });
});
