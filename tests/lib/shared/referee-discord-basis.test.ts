/**
 * Tag Discord certifié de l'arbitre désigné : base juridique « exécution du
 * service » (fonctionnement minimum nécessaire) depuis le 5 novembre 2026 —
 * décision T1 de l'utilisateur du 2026-11-03 (MATCH-REFEREE-FINISH).
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PRIVACY_CHANGES,
  isPrivacyPolicyVersion,
  privacyChangeReachesAccount,
} from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
import { DONNEES_PROFIL, DROITS, REFEREE_DISCORD_BEFORE_V7_SCOPE, REFEREE_DISCORD_SCOPE } from "@/lib/shared/rgpd-policy";
import { DROITS_EN } from "@/lib/shared/rgpd-policy-en";

const ID = "2026-11-tag-discord-arbitre-execution-du-service";
const entry = PRIVACY_CHANGES.find((change) => change.id === ID);
const english = PRIVACY_CHANGES_EN[ID];
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("PRIVACY_CHANGES — base du tag Discord de l'arbitre", () => {
  it("privacyChanges_refereeDiscordBasis_datedAfterDeployNightForLiveStaff", () => {
    expect(entry).toBeDefined();
    expect(entry?.publishedAt).toBe("2026-11-05");
    expect(entry?.audience).toBe("LIVE_STAFF");
    expect(entry?.links?.[0]?.href).toBe("/rgpd#arbitre-designe");
    expect(entry && isPrivacyPolicyVersion(entry)).toBe(true);
  });

  it("privacyChanges_refereeDiscordBasis_reachesLiveStaffOnly", () => {
    expect(entry && privacyChangeReachesAccount(entry, { liveStaff: true })).toBe(true);
    expect(entry && privacyChangeReachesAccount(entry, { liveStaff: false })).toBe(false);
    expect(entry && privacyChangeReachesAccount(entry, {})).toBe(false);
  });

  it("privacyChanges_refereeDiscordBasis_saysNewBasisAndKeptObjectionFrAndEn", () => {
    expect(entry?.summary).toContain("sur l'exécution du service, et non plus sur l'intérêt légitime");
    expect(entry?.details.join(" ")).toContain("strictement nécessaire au fonctionnement minimum du service");
    expect(entry?.details.join(" ")).toContain("te retire toujours de tes matchs non terminés");
    expect(english?.summary).toContain("on performance of the service, no longer on legitimate interest");
    expect(english?.details.join(" ")).toContain("strictly necessary for the minimum functioning of the service");
    expect(english?.details).toHaveLength(entry?.details.length ?? -1);
    expect(english?.linkLabels).toHaveLength(entry?.links?.length ?? -1);
  });

  it("privacyChanges_refereeDiscordBasis_followsBattlenetEntry", () => {
    const index = PRIVACY_CHANGES.findIndex((change) => change.id === ID);
    expect(PRIVACY_CHANGES[index - 1]?.id).toBe("2026-11-battlenet-requis-overwatch-seulement");
  });
});

describe("Registre T04 et /rgpd — exécution du service, FR et EN", () => {
  const t04 = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T04");
  const t04En = PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T04");

  it("register_t04_refereeDiscordTag_performanceOfService", () => {
    expect(t04?.legalBasis).toContain(
      "exécution du service (strictement nécessaire à son fonctionnement minimum : sans lui, les parties du match ne peuvent pas joindre son arbitre) pour la présentation de son tag Discord certifié",
    );
    expect(t04?.legalBasis).not.toContain("les conditions d'utilisation (version 8) ne la prévoyant pas");
    expect(t04En?.legalBasis).toContain(
      "performance of the service (strictly necessary for its minimum functioning: without it, the parties to the match cannot reach its referee) for presenting their certified Discord tag",
    );
    expect(t04En?.legalBasis).not.toContain("the terms of use (version 8) not providing for it");
  });

  it("rgpdPolicy_refereeDiscordScope_contractBase", () => {
    const row = DONNEES_PROFIL.find((donnee) => donnee.extraBases?.some((extra) => extra.scope === REFEREE_DISCORD_SCOPE));
    expect(row?.extraBases?.find((extra) => extra.scope === REFEREE_DISCORD_SCOPE)?.base).toBe("Exécution du contrat");
  });

  it("rgpdPolicy_objectionRight_noLongerListsRefereeDiscordTag", () => {
    const fr = DROITS.find((droit) => droit.title === "Droit d'opposition")?.text ?? "";
    const en = DROITS_EN.find((droit) => droit.title === "Right to object")?.text ?? "";
    expect(fr).not.toContain("présentation de son tag Discord certifié");
    expect(en).not.toContain("presentation of their certified Discord tag");
    expect(fr).toContain("la présentation de l'arbitre désigné aux parties de ses matchs");
    expect(en).toContain("the presentation of the assigned referee to the parties to their matches");
  });

  // Revue juridique #545, cycle 3 : avant la version 7, l'opposition vaut aussi pour le tag.
  it("rgpdPolicy_objectionRight_beforeVersion7IncludesRefereeDiscordTagFrAndEn", () => {
    const fr = DROITS.find((droit) => droit.title === "Droit d'opposition")?.text ?? "";
    const en = DROITS_EN.find((droit) => droit.title === "Right to object")?.text ?? "";
    expect(fr).toContain("aux parties de ses matchs — pseudo, BattleTag en Overwatch et tag Discord certifié — tant qu'il n'a pas accepté la version 7");
    expect(en).toContain("to the parties to their matches — username, BattleTag in Overwatch and certified Discord tag — as long as they have not accepted version 7");
  });

  it("rgpdPolicy_refereeDiscordBeforeV7_legitimateInterestRowFrAndEn", () => {
    const row = DONNEES_PROFIL.find((donnee) => donnee.extraBases?.some((extra) => extra.scope === REFEREE_DISCORD_SCOPE));
    expect(row?.extraBases).toContainEqual({ base: "Intérêt légitime", scope: REFEREE_DISCORD_BEFORE_V7_SCOPE });
    expect(REFEREE_DISCORD_SCOPE).toContain("une fois la version 7 des conditions d'utilisation ou une suivante acceptée par toi");
    expect(REFEREE_DISCORD_BEFORE_V7_SCOPE).toContain("tant que tu n'as pas accepté la version 7");
    const en = read("lib/shared/rgpd-policy-en.ts");
    expect(en).toContain("[REFEREE_DISCORD_BEFORE_V7_SCOPE]:");
    expect(en).toContain("once you have accepted version 7 of the terms of use or a later one");
  });

  it("rgpdPages_refereeDiscordTag_performanceOfServiceFrAndEn", () => {
    const fr = read("app/rgpd/page.tsx");
    const en = read("app/rgpd/RgpdEn.tsx");
    expect(fr).toContain("relève, depuis le 5 novembre 2026, de l&apos;<strong>exécution du service</strong>, strictement nécessaire à son fonctionnement minimum");
    expect(en).toContain("falls, since 5 November 2026, under <strong>performance of the service</strong>, strictly necessary for its minimum functioning");
    expect(fr).not.toContain("les conditions d&apos;utilisation ne la prévoient pas");
    expect(en).not.toContain("the terms of use do not provide for it");
  });
});

// Revue juridique #545 : les textes disent ce que fait le code (Battle.net en
// Overwatch seulement, pas d'opposition propre au tag sous une base contractuelle).
describe("Textes juridiques alignés sur le code (revue juridique #545)", () => {
  const t04 = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T04");
  const t04En = PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T04");

  it("register_t04Retention_battlenetConditionLimitedToOverwatchFrAndEn", () => {
    const fr = (t04?.retention ?? []).join("\n");
    const en = (t04En?.retention ?? []).join("\n");
    expect(fr).not.toMatch(/certifié, BattleTag tiré d'un compte Battle\.net/);
    expect(fr.match(/et dans un match Overwatch le BattleTag tiré d'un compte Battle\.net rattaché/g)).toHaveLength(2);
    expect(en).not.toMatch(/certified Discord tag, BattleTag taken/);
    expect(en.match(/and in an Overwatch match the BattleTag taken from a linked Battle\.net account/g)).toHaveLength(2);
  });

  it("rgpdPolicy_refereeDiscordScope_noSeparateObjectionFrAndEn", () => {
    expect(REFEREE_DISCORD_SCOPE).not.toContain("avec le même effet");
    expect(REFEREE_DISCORD_SCOPE).toContain("seule l'opposition à l'arbitrage même");
    expect(read("lib/shared/rgpd-policy-en.ts")).toContain("only an objection to the refereeing itself");
  });

  it("rgpdPages_refereeObjectionClause_notDuplicatedFrAndEn", () => {
    expect(read("app/rgpd/page.tsx")).not.toContain("l&apos;en retire aussi");
    expect(read("app/rgpd/RgpdEn.tsx")).not.toContain("removes it too");
  });

  it("privacyChanges_battlenetOverwatchOnly_doesNotClaimBattletagUnread", () => {
    const fr = PRIVACY_CHANGES.find((change) => change.id === "2026-11-battlenet-requis-overwatch-seulement");
    const en = PRIVACY_CHANGES_EN["2026-11-battlenet-requis-overwatch-seulement"];
    expect(JSON.stringify(fr)).not.toContain("ne lit plus ce BattleTag");
    expect(JSON.stringify(fr)).toContain("n'en tient plus compte pour ces matchs");
    expect(JSON.stringify(en)).toContain("no longer takes it into account for these matches");
  });
});

// Revue juridique #545, cycle 2 : condition de la version 7, avis complet, liens.
describe("Base du tag Discord de l'arbitre — cohérence (revue juridique #545, cycle 2)", () => {
  it("register_t04_refereeDiscordTag_followsVersion7ConditionFrAndEn", () => {
    const fr = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T04")?.legalBasis ?? "";
    const en = PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T04")?.legalBasis ?? "";
    expect(fr).toContain("une fois que cet arbitre a accepté la version 7 des conditions ou une suivante, comme le reste de sa présentation");
    expect(fr).toContain("une fois cette version acceptée, ce tag n'a pas d'opposition propre");
    expect(en).toContain("once this referee has accepted version 7 of the terms or a later one, like the rest of their presentation");
    expect(en).toContain("once that version is accepted, this tag has no objection of its own");
  });

  it("rgpdPages_refereeDiscordTag_followsVersion7ConditionFrAndEn", () => {
    const fr = read("app/rgpd/page.tsx").replace(/\s+/g, " ");
    const en = read("app/rgpd/RgpdEn.tsx").replace(/\s+/g, " ");
    expect(fr).toContain("une fois la version 7 des conditions ou une suivante acceptée par l&apos;arbitre (avant cette acceptation, l&apos;intérêt légitime, avec le même droit d&apos;opposition) — une fois cette version acceptée, ce tag n&apos;a pas d&apos;opposition propre");
    expect(en).toContain("once the referee has accepted version 7 of the terms or a later one (before that acceptance, legitimate interest, with the same right to object) — once that version is accepted, this tag has no objection of its own");
  });

  it("rgpdPolicy_refereeDiscordScope_decidedNecessityWordingFrAndEn", () => {
    expect(REFEREE_DISCORD_SCOPE).toContain("strictement nécessaire au fonctionnement minimum du service");
    expect(read("lib/shared/rgpd-policy-en.ts")).toContain("strictly necessary for the minimum functioning of the service");
  });

  it("privacyChanges_refereeDiscordBasis_announcesLostSeparateObjectionFrAndEn", () => {
    expect(entry?.summary.startsWith("Si tu arbitres un match")).toBe(true);
    expect(entry?.summary).toContain("une fois la version 7 des conditions ou une suivante acceptée");
    expect(entry?.details.join(" ")).toContain("une fois cette version acceptée, elle n'a plus d'opposition propre");
    expect(english?.summary.startsWith("If you referee a match")).toBe(true);
    expect(english?.summary).toContain("once version 7 of the terms or a later one is accepted");
    expect(english?.details.join(" ")).toContain("once that version is accepted, it has no objection of its own");
  });

  it("privacyChanges_battlenetOverwatchOnly_linksCasterConditionFrAndEn", () => {
    const fr = PRIVACY_CHANGES.find((change) => change.id === "2026-11-battlenet-requis-overwatch-seulement");
    expect(fr?.links?.map((link) => link.href)).toEqual(["/rgpd#donnees-collectees", "/rgpd#arbitre-designe"]);
    expect(PRIVACY_CHANGES_EN["2026-11-battlenet-requis-overwatch-seulement"]?.linkLabels).toHaveLength(2);
  });
});

// Revue juridique #545, cycle 4 : l'avis Battle.net dit qui gagne une présentation, et la permission.
describe("Avis Battle.net en Overwatch seulement — exactitude (revue juridique #545, cycle 4)", () => {
  const fr = PRIVACY_CHANGES.find((change) => change.id === "2026-11-battlenet-requis-overwatch-seulement");
  const en = PRIVACY_CHANGES_EN["2026-11-battlenet-requis-overwatch-seulement"];

  it("privacyChanges_battlenetOverwatchOnly_namesPermissionFrAndEn", () => {
    expect(fr?.summary).toContain("avec la permission de diffusion ou d'arbitrage");
    expect(en?.summary).toContain("together with the streaming or refereeing permission");
  });

  it("privacyChanges_battlenetOverwatchOnly_saysNewlyPresentedStaffFrAndEn", () => {
    expect(fr?.details.join(" ")).toContain("peut désormais le faire et y être présenté (pseudo et tag Discord certifié)");
    expect(en?.details.join(" ")).toContain("can now do so and be presented in it (username and certified Discord tag)");
  });

  it("privacyChanges_battlenetOverwatchOnly_termsChangeLimitedToRefereesFrAndEn", () => {
    expect(fr?.details.join(" ")).toContain("qui ne demandent Battle.net qu'aux arbitres");
    expect(en?.details.join(" ")).toContain("which ask only referees for Battle.net");
  });
});
