import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN, REGISTER_UPDATED_AT } from "@/lib/shared/processing-register";
import { EN_T16_PROD_BASIS, FR_T16_PROD_BASIS, enT16WithoutProdBasis, frT16WithoutProdBasis } from "../../helpers/match-prod-basis";
import { readSource } from "../../helpers/read-source";

/**
 * MATCH-CAST-PROD (`docs/features/MATCH_PROD.md`) : la prod d'un match, telle
 * que l'historique, le registre (T16) et `/rgpd` (FR et EN) la déclarent.
 */
const ENTRY_ID = "2026-11-prod-match";

function frEntry() {
  const found = PRIVACY_CHANGES.find((change) => change.id === ENTRY_ID);
  if (!found) throw new Error(`entrée ${ENTRY_ID} absente`);
  return found;
}

function activity(list: typeof PROCESSING_ACTIVITIES, ref: string): string {
  const found = list.find((entry) => entry.ref === ref);
  if (!found) throw new Error(`${ref} absente`);
  return JSON.stringify(found);
}

function sheet(list: typeof PROCESSING_ACTIVITIES, ref: string) {
  const found = list.find((entry) => entry.ref === ref);
  if (!found) throw new Error(`${ref} absente`);
  return found;
}

const page = (path: string) => readSource(path).replace(/\s+/g, " ");

describe("historique des changements — prod d'un match", () => {
  it("prodEntry_lastEntry_datedWithRegisterForEveryone", () => {
    expect(PRIVACY_CHANGES.at(-1)?.id).toBe(ENTRY_ID);
    expect(frEntry().publishedAt).toBe("2026-11-23");
    expect(REGISTER_UPDATED_AT).toBe("2026-11-23");
    expect(frEntry().audience).toBeUndefined();
    expect(frEntry().asksTermsAcceptance).toBeUndefined();
  });

  it("prodEntry_english_sameShape", () => {
    expect(PRIVACY_CHANGES_EN[ENTRY_ID].details).toHaveLength(frEntry().details.length);
    expect(PRIVACY_CHANGES_EN[ENTRY_ID].linkLabels).toHaveLength(frEntry().links?.length ?? -1);
  });

  it("prodEntry_linksRegisterT16T04T05T03", () => {
    expect(frEntry().links?.map((link) => link.href)).toEqual([
      "/rgpd/registre#t16",
      "/rgpd/registre#t04",
      "/rgpd/registre#t05",
      "/rgpd/registre#t03",
    ]);
  });

  it("prodEntry_englishLinkLabels_nameT16T04T05T03", () => {
    expect(PRIVACY_CHANGES_EN[ENTRY_ID].linkLabels).toEqual([
      "Read record T16 of the register",
      "Read record T04 of the register",
      "Read record T05 of the register",
      "Read record T03 of the register",
    ]);
  });

  it("registerT16_prodBasis_playedMatchKeptAsTournamentHistory", () => {
    expect(FR_T16_PROD_BASIS.endsWith("un match joué gardant sa prod, qui fait partie de l'histoire du tournoi")).toBe(true);
    expect(EN_T16_PROD_BASIS.endsWith("a played match keeping its prod, which is part of the tournament's history")).toBe(true);
  });

  it("registerT16_subPurpose_namesProdRoleExplicitly", () => {
    const fr = activity(PROCESSING_ACTIVITIES, "T16");

    expect(fr).toContain("membre qui a le rôle prod");
    expect(fr).not.toContain("membre qui a ce rôle");
  });

  it("rgpdEn_prodNotice_canBeTurnedOffInMyProfile", () => {
    expect(page("app/rgpd/RgpdEn.tsx")).toContain("the prod is notified (can be turned off in “My profile”) when");
    expect(page("app/rgpd/RgpdEn.tsx")).not.toContain("(set in “My profile”)");
  });

  it("prodEntry_staffLog_namesNobody", () => {
    expect(frEntry().details.join(" ")).toContain("sans nommer personne");
  });
});

describe("registre — T16 déclare la prod", () => {
  it("registerT16_french_declaresProdSubjectAndData", () => {
    const t16 = activity(PROCESSING_ACTIVITIES, "T16");
    expect(t16).toContain("Prods des matchs");
    expect(t16).toContain("Prod d'un match : son compte et son pseudo");
  });

  it("registerT16_english_declaresProd", () => {
    expect(activity(PROCESSING_ACTIVITIES_EN, "T16")).toContain("Match prods");
  });
});

describe("/rgpd — la prod d'un match, en français et en anglais", () => {
  it("rgpdPages_bothLanguages_mentionTheProdWithRegisterLink", () => {
    expect(page("app/rgpd/page.tsx")).toContain("montrent déjà — et de sa prod");
    expect(page("app/rgpd/RgpdEn.tsx")).toContain("already show — and of its prod");
    expect(page("app/rgpd/page.tsx")).toContain('href="/rgpd/registre#t16"');
    expect(page("app/rgpd/RgpdEn.tsx")).toContain('href="/rgpd/registre#t16"');
  });
});

describe("registre — la prod hors T16 (journaux, avis, /suivre)", () => {
  it("registerT05_frAndEn_declaresProdLogLineAndServerLogTrace", () => {
    const fr = activity(PROCESSING_ACTIVITIES, "T05");
    const en = activity(PROCESSING_ACTIVITIES_EN, "T05");

    expect(fr).toContain("sans nommer la prod ni le staff — dans les journaux du serveur, l'auteur d'un geste du staff et l'identifiant des comptes visés");
    expect(fr).toContain("Prods des matchs (jamais nommées sur Discord");
    expect(fr).toContain("pour un geste du staff sur la prod d'un match : pseudo et identifiant de son auteur");
    expect(fr).toContain("des casters et des prods des matchs (jamais nommés sur Discord");
    expect(en).toContain("without naming the prod or the staff — in the server logs, the author of a staff action");
    expect(en).toContain("Match prods (never named on Discord");
    expect(en).toContain("for a staff action on a match's prod: username and identifier of its author");
    expect(en).toContain("to the casters and prods of the matches (never named on Discord");
  });

  it("registerT04_frAndEn_declaresProdDmAndPushNotice", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T04")).toContain("Prévenir la prod d'un match, en message privé Discord et en push");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T04")).toContain("Notifying a match's prod, by Discord direct message and by push");
  });

  it("registerT03_suivre_avatarAndAccountNumberOnlyForParticipants", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T03")).toContain("pseudos des engagés (et, en tournoi individuel, leur avatar s'il n'est pas masqué et leur numéro de compte interne, pour la marque du podium), pseudos des casters et de la prod d'un match,");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T03")).toContain("usernames of the participants (and, in a solo tournament, their avatar unless hidden and their internal account number, for the podium mark), usernames of a match's casters and prod,");
  });

  it("registerT04_legalBasis_prodDmBySwitchPushByTopic", () => {
    expect(sheet(PROCESSING_ACTIVITIES, "T04").legalBasis).toContain("qui coupe tous leurs messages privés de match ; même intérêt légitime pour l'avis de sa place donnée ou retirée envoyé à la prod d'un match, son message privé coupé par ce même interrupteur et sa push par son sujet ;");
    expect(sheet(PROCESSING_ACTIVITIES_EN, "T04").legalBasis).toContain("that turns off all their match direct messages; the same legitimate interest for the notice of their place given or removed sent to a match's prod, its direct message turned off by the same switch and its push by its topic;");
  });

  it("registerT04_legalBasis_switchNoLongerClaimedToCutProdPush", () => {
    expect(sheet(PROCESSING_ACTIVITIES, "T04").legalBasis).not.toContain("même intérêt légitime et même interrupteur");
    expect(sheet(PROCESSING_ACTIVITIES_EN, "T04").legalBasis).not.toContain("the same legitimate interest and the same switch");
  });

  it("registerT04_dataSubjects_includeMatchProds", () => {
    expect(sheet(PROCESSING_ACTIVITIES, "T04").dataSubjects).toContain("Prods des matchs");
    expect(sheet(PROCESSING_ACTIVITIES_EN, "T04").dataSubjects).toContain("Match prods");
  });

  it("registerT16_legalBasis_endsWithProdLegitimateInterestAndObjection", () => {
    expect(sheet(PROCESSING_ACTIVITIES, "T16").legalBasis.endsWith(` ; ${FR_T16_PROD_BASIS}`)).toBe(true);
    expect(sheet(PROCESSING_ACTIVITIES_EN, "T16").legalBasis.endsWith(`; ${EN_T16_PROD_BASIS}`)).toBe(true);
  });

  it("registerT16_legalBasis_prodLeavesOnlyUnplayedMatches", () => {
    expect(FR_T16_PROD_BASIS).toContain("peut quitter un match pas encore joué");
    expect(FR_T16_PROD_BASIS).not.toContain("à tout moment");
    expect(EN_T16_PROD_BASIS).toContain("can leave a match not yet played");
    expect(EN_T16_PROD_BASIS).not.toContain("at any time");
  });

  it("registerT16_legalBasis_contractPartHasNoLegitimateInterest", () => {
    const frContract = frT16WithoutProdBasis(sheet(PROCESSING_ACTIVITIES, "T16").legalBasis);
    const enContract = enT16WithoutProdBasis(sheet(PROCESSING_ACTIVITIES_EN, "T16").legalBasis);

    expect(frContract).not.toMatch(/intérêt légitime|droit d'opposition/i);
    expect(enContract).not.toMatch(/legitimate interest|right to object/i);
  });

  it("registerT16_subPurpose_feminineWithoutBasis", () => {
    const fr = sheet(PROCESSING_ACTIVITIES, "T16").subPurposes.find((line) => line.startsWith("Organiser la production du direct"));

    expect(fr).toContain("la prod, membre qui a le rôle prod, s'y place ou y est placée par le staff (une au plus par match), est montrée");
    expect(fr).toContain("est prévenue quand un autre qu'elle la place ou l'en retire");
    expect(fr).not.toContain("un membre qui a le rôle de prod");
    expect(fr).not.toContain("base :");
  });

  it("registerT12_prodPush_generalWithoutCaseList", () => {
    const fr = activity(PROCESSING_ACTIVITIES, "T12");

    expect(fr).toContain("Place de prod d'un match donnée ou retirée par un autre qu'elle (par le staff ou d'office)");
    expect(fr).not.toContain("retirée d'office (compte suspendu");
  });
});

describe("historique et /rgpd — base, lecteurs, journaux de la prod", () => {
  it("prodEntry_frAndEn_basisWhoSeesItAndServerLogs", () => {
    const fr = frEntry().details.join(" ");
    const en = PRIVACY_CHANGES_EN[ENTRY_ID].details.join(" ");

    expect(fr).toContain("Base : intérêt légitime");
    expect(fr).toContain("y compris sans compte");
    expect(fr).toContain("quand un autre qu'elle la place ou l'en retire");
    expect(fr).toContain("les journaux du serveur gardent l'auteur d'un geste du staff et le compte visé");
    expect(en).toContain("Basis: legitimate interest");
    expect(en).toContain("including without an account");
    expect(en).toContain("when someone other than themselves places or removes them");
    expect(en).toContain("the server logs keep the author of a staff action and the account concerned");
  });

  it("rgpdPages_suivre_castersShownByStreamsOnly", () => {
    expect(page("app/rgpd/page.tsx")).toContain("pseudos des casters d&apos;un match — ce que les retransmissions montrent déjà — et de sa prod,");
    expect(page("app/rgpd/RgpdEn.tsx")).toContain("usernames of a match&apos;s casters — what streams already show — and of its prod,");
  });

  it("rgpdPages_prod_ownPlaceLoggedAndBasisWithObjection", () => {
    expect(page("app/rgpd/page.tsx")).toContain("sa place prise ou quittée et ces gestes sont notés sans nom au journal du staff sur Discord");
    expect(page("app/rgpd/page.tsx")).toContain("base : intérêt légitime, la prod pouvant quitter un match pas encore joué et s&apos;y opposer par le formulaire de signalement");
    expect(page("app/rgpd/RgpdEn.tsx")).toContain("their place taken or left and these actions are noted without a name in the staff log on Discord");
    expect(page("app/rgpd/RgpdEn.tsx")).toContain("basis: legitimate interest, the prod being able to leave a match not yet played and object through the report form");
  });

  it("rgpdPages_prodNotice_settableInMyProfile", () => {
    expect(page("app/rgpd/page.tsx")).toContain("la prod est prévenue (réglable dans « Mon profil ») quand");
    expect(page("app/rgpd/RgpdEn.tsx")).toContain("the prod is notified (can be turned off in “My profile”) when");
  });

  it("prodEntry_frAndEn_dmCutWithMatchDmsPushByTopic", () => {
    const fr = frEntry().details.join(" ");
    const en = PRIVACY_CHANGES_EN[ENTRY_ID].details.join(" ");

    expect(fr).toContain("message privé Discord, qui se coupe avec ses autres messages privés de match, et notification push, qui se coupe par son sujet");
    expect(fr).not.toContain("réglables dans « Mon profil »");
    expect(en).toContain("Discord direct message, turned off with their other match direct messages, and push notification, turned off by its topic");
    expect(en).not.toContain("both set in");
  });

  it("prodEntry_frAndEn_ownPlaceTakenOrLeftLoggedAndObjection", () => {
    const fr = frEntry().details.join(" ");
    const en = PRIVACY_CHANGES_EN[ENTRY_ID].details.join(" ");

    expect(fr).toContain("sa place prise ou quittée et ces gestes sont notés au journal du staff sur Discord");
    expect(fr).toContain("la prod peut quitter un match pas encore joué et s'y opposer par le formulaire de signalement (catégorie RGPD)");
    expect(en).toContain("their place taken or left and these actions are noted in the staff log on Discord");
    expect(en).toContain("the prod can leave a match not yet played and object to it through the report form (GDPR category)");
  });

  it("rgpdPages_prodParagraph_namesLogsAndOnlyOthersGestures", () => {
    expect(page("app/rgpd/page.tsx")).toContain("quand un autre qu&apos;elle la place ou l&apos;en retire");
    expect(page("app/rgpd/page.tsx")).toContain("l&apos;auteur d&apos;un geste du staff et le compte visé dans les journaux du serveur");
    expect(page("app/rgpd/RgpdEn.tsx")).toContain("when someone other than themselves places or removes them");
    expect(page("app/rgpd/RgpdEn.tsx")).toContain("the author of a staff action and the account concerned in the server logs");
  });
});
