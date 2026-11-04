/**
 * Tag Discord certifié de l'arbitre désigné : base juridique « exécution du
 * service » (fonctionnement minimum nécessaire) depuis le 6 novembre 2026 —
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
import { TERMS_UPDATED_AT } from "@/lib/shared/terms-of-use";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
import { DONNEES_PROFIL, DROITS, REFEREE_DISCORD_BEFORE_V7_SCOPE, REFEREE_DISCORD_SCOPE } from "@/lib/shared/rgpd-policy";
import { DROITS_EN } from "@/lib/shared/rgpd-policy-en";

const ID = "2026-11-tag-discord-arbitre-execution-du-service";
const entry = PRIVACY_CHANGES.find((change) => change.id === ID);
const english = PRIVACY_CHANGES_EN[ID];
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("PRIVACY_CHANGES — base du tag Discord de l'arbitre", () => {
  // Revue juridique #546 : la base du tag suit la version 9, publiée le même jour.
  it("privacyChanges_refereeDiscordBasis_datedWithTermsV9ForLiveStaff", () => {
    expect(entry).toBeDefined();
    expect(entry?.publishedAt).toBe(TERMS_UPDATED_AT);
    expect(entry?.publishedAt).toBe("2026-11-06");
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

  it("privacyChanges_refereeDiscordBasis_namesVersion9NotVersion7FrAndEn", () => {
    expect(entry?.summary).toContain("une fois la version 9 des conditions ou une suivante acceptée");
    expect(entry?.summary).not.toContain("version 7");
    expect(english?.summary).toContain("once version 9 of the terms or a later one is accepted");
    expect(english?.summary).not.toContain("version 7");
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

  it("register_t04_refereeDiscordTag_noLongerTiedToRestOfPresentationFrAndEn", () => {
    expect(t04?.legalBasis).not.toContain("comme le reste de sa présentation");
    expect(t04?.legalBasis).toContain("(le reste de sa présentation dépendant de la version 7, ci-dessus)");
    expect(t04En?.legalBasis).not.toContain("like the rest of their presentation");
    expect(t04En?.legalBasis).toContain("(the rest of their presentation depending on version 7, above)");
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

  // Revue juridique #546 : le comptage vocal (T18, intérêt légitime) est opposable.
  it("rgpdRights_objection_listsVoiceChannelCountFrAndEn", () => {
    const fr = DROITS.find((droit) => droit.title === "Droit d'opposition")?.text ?? "";
    const en = DROITS_EN.find((droit) => droit.title === "Right to object")?.text ?? "";
    expect(fr).toContain("le comptage des personnes présentes dans les salons vocaux d'équipe (un nombre, jamais qui)");
    expect(en).toContain("the count of people present in team voice channels (a number, never who)");
  });

  // Revue juridique #545, cycle 3 : avant la version 7, l'opposition vaut aussi pour le tag.
  it("rgpdPolicy_objectionRight_beforeVersion7IncludesRefereeDiscordTagFrAndEn", () => {
    const fr = DROITS.find((droit) => droit.title === "Droit d'opposition")?.text ?? "";
    const en = DROITS_EN.find((droit) => droit.title === "Right to object")?.text ?? "";
    expect(fr).toContain("aux parties de ses matchs — pseudo et BattleTag en Overwatch tant qu'il n'a pas accepté la version 7 des conditions d'utilisation ou une version suivante, tag Discord certifié tant qu'il n'a pas accepté la version 9");
    expect(en).toContain("to the parties to their matches — username and BattleTag in Overwatch as long as they have not accepted version 7 of the terms of use or a later version, certified Discord tag as long as they have not accepted version 9");
  });

  it("rgpdPolicy_refereeDiscordBeforeV7_legitimateInterestRowFrAndEn", () => {
    const row = DONNEES_PROFIL.find((donnee) => donnee.extraBases?.some((extra) => extra.scope === REFEREE_DISCORD_SCOPE));
    expect(row?.extraBases).toContainEqual({ base: "Intérêt légitime", scope: REFEREE_DISCORD_BEFORE_V7_SCOPE });
    expect(REFEREE_DISCORD_SCOPE).toContain("une fois la version 9 des conditions d'utilisation ou une suivante acceptée par toi");
    expect(REFEREE_DISCORD_BEFORE_V7_SCOPE).toContain("tant que tu n'as pas accepté la version 9");
    const en = read("lib/shared/rgpd-policy-en.ts");
    expect(en).toContain("[REFEREE_DISCORD_BEFORE_V7_SCOPE]:");
    expect(en).toContain("once you have accepted version 9 of the terms of use or a later one");
  });

  it("rgpdPages_refereeDiscordTag_performanceOfServiceFrAndEn", () => {
    const fr = read("app/rgpd/page.tsx");
    const en = read("app/rgpd/RgpdEn.tsx");
    expect(fr).toContain("relève, depuis le 6 novembre 2026, de l&apos;<strong>exécution du service</strong>, strictement nécessaire à son fonctionnement minimum");
    expect(en).toContain("falls, since 6 November 2026, under <strong>performance of the service</strong>, strictly necessary for its minimum functioning");
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
    // Revue juridique #545, cycle 5 : toutes les fins de la présentation, pas la seule opposition.
    expect(REFEREE_DISCORD_SCOPE).toContain("la présentation cesse avec ton arbitrage du match — retrait par toi ou par le staff, autre arbitre ou autogestion, joueur du match avant son lancement, ton opposition d'arbitre");
    expect(REFEREE_DISCORD_SCOPE).toContain("dès que tu ne remplis plus les conditions de l'arbitrage (tag retiré compris : avant le lancement, tu es aussi retiré du match)");
    expect(REFEREE_DISCORD_SCOPE).toContain("si tu le castes aussi, ton tag suit en plus la règle des casters");
    expect(REFEREE_DISCORD_SCOPE).toContain("depuis le 6 novembre 2026 (auparavant, intérêt légitime)");
    const en = read("lib/shared/rgpd-policy-en.ts");
    expect(en).toContain("the presentation ends with your refereeing of the match — withdrawal by you or by the staff, another referee or self-management, becoming a player of the match before its launch, your referee objection");
    expect(en).toContain("since 6 November 2026 (before that, legitimate interest)");
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
  it("register_t04_refereeDiscordTag_followsVersion9ConditionFrAndEn", () => {
    const fr = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T04")?.legalBasis ?? "";
    const en = PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T04")?.legalBasis ?? "";
    expect(fr).toContain("une fois que cet arbitre a accepté la version 9 des conditions ou une suivante (le reste de sa présentation dépendant de la version 7, ci-dessus)");
    expect(fr).toContain("une fois cette version acceptée, ce tag n'a pas d'opposition propre");
    expect(en).toContain("once this referee has accepted version 9 of the terms or a later one (the rest of their presentation depending on version 7, above)");
    expect(en).toContain("once that version is accepted, this tag has no objection of its own");
  });

  it("rgpdPages_refereeDiscordTag_followsVersion9ConditionFrAndEn", () => {
    const fr = read("app/rgpd/page.tsx").replace(/\s+/g, " ");
    const en = read("app/rgpd/RgpdEn.tsx").replace(/\s+/g, " ");
    expect(fr).toContain("une fois la version 9 des conditions ou une suivante acceptée par l&apos;arbitre (avant cette acceptation, l&apos;intérêt légitime, avec le même droit d&apos;opposition) — une fois cette version acceptée, ce tag n&apos;a pas d&apos;opposition propre");
    expect(en).toContain("once the referee has accepted version 9 of the terms or a later one (before that acceptance, legitimate interest, with the same right to object) — once that version is accepted, this tag has no objection of its own");
  });

  it("rgpdPolicy_refereeDiscordScope_decidedNecessityWordingFrAndEn", () => {
    expect(REFEREE_DISCORD_SCOPE).toContain("strictement nécessaire au fonctionnement minimum du service");
    expect(read("lib/shared/rgpd-policy-en.ts")).toContain("strictly necessary for the minimum functioning of the service");
  });

  it("privacyChanges_refereeDiscordBasis_announcesLostSeparateObjectionFrAndEn", () => {
    expect(entry?.summary.startsWith("Si tu arbitres un match")).toBe(true);
    expect(entry?.summary).toContain("une fois la version 9 des conditions ou une suivante acceptée");
    expect(entry?.details.join(" ")).toContain("une fois cette version acceptée, elle n'a plus d'opposition propre");
    expect(english?.summary.startsWith("If you referee a match")).toBe(true);
    expect(english?.summary).toContain("once version 9 of the terms or a later one is accepted");
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

// Revue juridique #545, cycle 5 : l'opposition nommée, et les lecteurs du tag d'un arbitre qui caste.
describe("Opposition d'arbitre nommée (revue juridique #545, cycle 5)", () => {
  it("rgpdPages_refereeObjection_namesWhatItCoversFrAndEn", () => {
    expect(read("app/rgpd/page.tsx").replace(/\s+/g, " ")).toContain("son opposition d&apos;arbitre (à sa présentation avant la version 7, ou à l&apos;affichage de son pseudo aux membres)");
    expect(read("app/rgpd/RgpdEn.tsx").replace(/\s+/g, " ")).toContain("their referee objection (to their presentation before version 7, or to the display of their username to members)");
  });

  it("privacyChanges_refereeDiscordBasis_namesObjectionWithoutClaimingCasterRuleChangedFrAndEn", () => {
    // Cycle 6 : la part « règle des casters » reposait déjà sur le contrat — l'avis ne la dit pas changée.
    expect(entry?.summary).not.toContain("règle des casters");
    expect(entry?.details.join(" ")).toContain("ton opposition d'arbitre (formulaire de signalement, catégorie RGPD) — à ta présentation avant la version 7 (avant la version 9 pour ce tag), ou à l'affichage de ton pseudo aux membres —");
    expect(english?.summary).not.toContain("casters' rule");
    expect(english?.details.join(" ")).toContain("your referee objection (report form, GDPR category) — to your presentation before version 7 (before version 9 for this tag), or to the display of your username to members —");
  });
});

// Revue juridique #545, cycle 6 : les avis du profil suivent la nouvelle base.
describe("Avis du profil — tag Discord et BattleTag de l'arbitre (revue juridique #545, cycle 6)", () => {
  const files = ["profile", "login", "players"] as const;

  it("profileNotices_refereeDiscordTag_noUnconditionalLegitimateInterestFrAndEn", () => {
    for (const file of files) {
      const fr = read(`messages/fr/${file}.json`);
      const en = read(`messages/en/${file}.json`);
      expect(fr).not.toContain("(intérêt légitime : tu peux t'y opposer par le formulaire de signalement)");
      expect(fr).not.toContain("(au titre de l'intérêt légitime : tu peux t'y opposer");
      expect(en).not.toContain("(legitimate interest: you can object through the report form)");
      expect(en).not.toContain("(under legitimate interest: you can object");
    }
    expect(read("messages/fr/profile.json")).toContain("nécessaire au service une fois la version 9 des conditions acceptée, sans opposition propre");
    expect(read("messages/en/profile.json")).toContain("necessary for the service once version 9 of the terms is accepted, with no separate objection");
  });

  it("profileNotices_battletagAsReferee_limitedToOverwatchFrAndEn", () => {
    for (const file of files) {
      expect(read(`messages/fr/${file}.json`)).not.toContain("te retirerait l'arbitrage, qui demande");
      expect(read(`messages/en/${file}.json`)).not.toContain("would remove your refereeing, which requires");
    }
    expect(read("messages/fr/profile.json")).toContain("te retirerait l'arbitrage des matchs Overwatch");
    expect(read("messages/en/profile.json")).toContain("would remove your refereeing of Overwatch matches");
  });
});

// Revue juridique #545, cycle 7 : destinataires du registre et avis du profil complets.
describe("Tag Discord de l'arbitre — destinataires et avis (revue juridique #545, cycle 7)", () => {
  it("register_t04Recipients_refereeDiscordTagNamesCastersRuleFrAndEn", () => {
    const fr = (PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T04")?.recipients ?? []).join("\n");
    const en = (PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T04")?.recipients ?? []).join("\n");
    expect(fr).toContain("s'il caste aussi le match, la règle des casters : aux autres arbitres dès que ses deux adversaires sont connus");
    expect(en).toContain("if they also cast the match, the casters' rule: to the other referees from the moment both its opponents are known");
  });

  it("profileNotices_refereeDiscordTag_keepRefereeObjectionFrAndEn", () => {
    expect(read("messages/fr/profile.json")).toContain("(pour l'arbitrage : nécessaire au service une fois la version 9 des conditions acceptée, sans opposition propre — ton opposition d'arbitre, retenue, t'en retire toujours ; avant,");
    expect(read("messages/en/profile.json")).toContain("(for the refereeing: necessary for the service once version 9 of the terms is accepted, with no separate objection — your referee objection, once upheld, still removes you from it; before that,");
  });
});
