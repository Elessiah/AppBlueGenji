import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN, REGISTER_UPDATED_AT } from "@/lib/shared/processing-register";
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

  it("prodEntry_linksRegisterT16", () => {
    expect(frEntry().links?.map((link) => link.href)).toEqual(["/rgpd/registre#t16"]);
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

  it("registerT03_suivre_listsCastersAndProdUsernames", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T03")).toContain("pseudos des engagés, des casters et de la prod d'un match");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T03")).toContain("usernames of the participants and of a match's casters and prod");
  });

  it("registerT16_prodBasis_legitimateInterestNotContract", () => {
    const fr = activity(PROCESSING_ACTIVITIES, "T16");

    expect(fr).toContain("base : intérêt légitime de l'association (RGPD, art. 6.1.f : organiser les bénévoles qui diffusent ses tournois), comme le planning (T20)");
    expect(fr).not.toContain("exécution du service auquel il s'inscrit ou qu'il accepte");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T16")).toContain("basis: the association's legitimate interest (GDPR, art. 6.1.f");
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

  it("rgpdPages_suivre_doesNotClaimDiscordShowsProd", () => {
    expect(page("app/rgpd/page.tsx")).not.toContain("casters et de la prod d&apos;un match — ce que les retransmissions et Discord");
    expect(page("app/rgpd/RgpdEn.tsx")).not.toContain("casters and prod — what streams and Discord");
  });

  it("rgpdPages_prodParagraph_namesLogsAndOnlyOthersGestures", () => {
    expect(page("app/rgpd/page.tsx")).toContain("la prod est prévenue quand un autre qu&apos;elle la place ou l&apos;en retire");
    expect(page("app/rgpd/page.tsx")).toContain("l&apos;auteur d&apos;un geste du staff et le compte visé dans les journaux du serveur");
    expect(page("app/rgpd/RgpdEn.tsx")).toContain("the prod is notified when someone other than themselves places or removes them");
    expect(page("app/rgpd/RgpdEn.tsx")).toContain("the author of a staff action and the account concerned in the server logs");
  });
});
