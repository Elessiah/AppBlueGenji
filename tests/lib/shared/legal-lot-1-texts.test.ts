/**
 * LEGAL-LOT-1 : rectificatif publié le 2026-11-13 — aucun prestataire
 * d'hébergement (D1), courriel de l'association en cours de passage à Google
 * Workspace (D2), nouveau sujet push actif d'office sur un appareil déjà
 * abonné (D5). Chaque phrase gardée ici dit une décision ou un fait du code,
 * en français et en anglais.
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRIVACY_POLICY } from "@/lib/shared/bot-legal-content";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { ASSOCIATION_GMAIL_FRAMEWORK, PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";

const ID = "2026-11-rectificatifs-hebergement-courriel-push";
const read = (path: string) => readFileSync(join(__dirname, "..", "..", "..", path), "utf8");
const entry = () => PRIVACY_CHANGES.find((change) => change.id === ID);
const detailsFr = () => entry()?.details.join("\n") ?? "";
const detailsEn = () => PRIVACY_CHANGES_EN[ID]?.details.join("\n") ?? "";

describe("rectificatif hébergement, courriel et push (LEGAL-LOT-1)", () => {
  it("rectificatifHebergement_published_datedAfterLastPublishedEntryForAllAccounts", () => {
    expect(entry()?.publishedAt).toBe("2026-11-13");
    expect(entry()?.audience).toBeUndefined();
    expect(PRIVACY_CHANGES.at(-1)?.id).toBe(ID);
  });

  it("rectificatifHebergement_hosting_saysNoProviderNoContractHetznerProcessorFrAndEn", () => {
    expect(detailsFr()).toContain("Il n'y a pas de prestataire d'hébergement");
    expect(detailsFr()).toContain("il n'est pas sous-traitant, et aucun contrat de sous-traitance n'est requis");
    expect(detailsFr()).toContain("est sous-traitant de l'association");
    expect(detailsEn()).toContain("There is no hosting provider");
    expect(detailsEn()).toContain("they are not a processor, and no processing agreement is required");
    expect(detailsEn()).toContain("is a processor of the association");
  });

  it("rectificatifHebergement_gmail_saysMovingToWorkspaceWithoutClaimingItDoneFrAndEn", () => {
    expect(entry()?.summary).toContain("est en cours de passage à Google Workspace");
    expect(detailsFr()).toContain("est en cours de passage à Google Workspace");
    expect(detailsEn()).toContain("is moving to Google Workspace");
    expect(ASSOCIATION_GMAIL_FRAMEWORK).toContain("en cours de passage à Google Workspace");
    expect(ASSOCIATION_GMAIL_FRAMEWORK).not.toMatch(/conditions de traitement des données de Google Workspace/);
  });

  it("rectificatifHebergement_push_saysNewTopicOnByDefaultAndSwitchableFrAndEn", () => {
    expect(detailsFr()).toContain("y est actif d'office, comme les autres ; tu peux le couper dans « Mon profil », sujet par sujet");
    expect(detailsFr()).toContain("suit les mêmes plafonds que le message privé Discord et ne nomme que l'équipe");
    expect(detailsEn()).toContain("is on by default there, like the others; you can turn it off in “My profile”, topic by topic");
    expect(detailsEn()).toContain("follows the same caps as the Discord direct message and only names the team");
  });

  it("rectificatifHebergement_links_pointToExistingRgpdAnchors", () => {
    const hrefs = entry()?.links?.map((link) => link.href);
    expect(hrefs).toEqual(["/rgpd#destinataires", "/rgpd#notifications"]);
    expect(entry()?.links?.[0]?.label).toBe("Lire la section « Destinataires et transferts »");
    expect(PRIVACY_CHANGES_EN[ID]?.linkLabels).toEqual(["Read the “Recipients and transfers” section", "Read the “Push notifications” section"]);
    for (const page of ["app/rgpd/page.tsx", "app/rgpd/RgpdEn.tsx"]) {
      expect(read(page)).toContain('<section id="destinataires"');
      expect(read(page)).toContain('<section id="notifications"');
    }
  });
});

describe("politique du bot (LEGAL-LOT-1)", () => {
  const fr = JSON.stringify(PRIVACY_POLICY.fr);
  const en = JSON.stringify(PRIVACY_POLICY.en);

  // [cas, texte français attendu, texte anglais attendu]
  const sentences: Array<[string, string, string]> = [
    ["host_saysNoHostingProvider", "aucun prestataire d'hébergement, donc pas de sous-traitant", "no hosting provider, so no processor"],
    ["hetzner_isAssociationProcessor", "dans l'Union européenne : sous-traitant de l'association.", "within the European Union: processor of the association."],
    ["moderationNotice_listsRestoredTeamLogo", "logo d'équipe masqué, retiré, supprimé ou rétabli", "a team logo masked, removed, deleted or restored"],
    [
      "liveEvening_listsInAdvanceOnlyStartTimeBroadcasts",
      "ceux programmés d'ici la fin de la soirée dont la diffusion doit s'ouvrir à leur heure de début",
      "those scheduled until the end of the evening whose broadcast is set to open at their start time",
    ],
    [
      "legalBasis_namesTeamDirectMessagesAndObjection",
      "pour les messages privés d'équipe — demande d'adhésion, invitation d'une équipe, reprise d'une équipe fantôme proposée, propriété d'équipe transférée —, auxquels chacun peut s'opposer sur demande",
      "for team direct messages — join request, a team's invitation, offered takeover of a ghost team, transferred team ownership —, which anyone may object to on request",
    ],
    ["staffLog_namesAccountDeletionRequests", "demandes de suppression de compte et leur réactivation, « un joueur »", "account deletion requests and their reactivation, “a player”"],
  ];

  it.each(sentences)("botPrivacyPolicy_%s_frAndEn", (_case, frText, enText) => {
    expect(fr).toContain(frText);
    expect(en).toContain(enText);
  });

  it("botPrivacyPolicy_hetzner_noLongerSubProcessorThroughHost", () => {
    expect(fr).not.toContain("sous-traitant ultérieur");
    expect(en).not.toContain("sub-processor");
  });

  it("botPrivacyPolicy_lastUpdated_datedWithSiteRectification", () => {
    expect([PRIVACY_POLICY.fr.lastUpdated, PRIVACY_POLICY.en.lastUpdated]).toEqual(["13 novembre 2026", "13 November 2026"]);
  });
});

describe("corrections de la revue (LEGAL-LOT-1)", () => {
  it("registerT03_transfers_listBrowserPushServiceWithDpfBasisFrAndEn", () => {
    const fr = PROCESSING_ACTIVITIES.find((a) => a.ref === "T03")?.transfers.join(" ") ?? "";
    const en = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T03")?.transfers.join(" ") ?? "";

    expect(fr).toContain("service de push du navigateur du joueur prévenu");
    expect(fr).toContain("Google, Mozilla, Apple et Microsoft, certifiés EU-U.S. Data Privacy Framework");
    expect(en).toContain("push service of the notified player's browser");
    expect(en).toContain("Google, Mozilla, Apple and Microsoft, certified under the EU-U.S. Data Privacy Framework");
  });

  it("legalNotice_gmail_saysMovingToWorkspaceFrAndEn", () => {
    expect(read("app/mentions-legales/page.tsx")).toContain("Google (Gmail, en cours de passage à Google Workspace)");
    expect(read("app/mentions-legales/MentionsLegalesEn.tsx")).toContain("Google (Gmail, currently moving to Google Workspace)");
  });

  it("rgpdEn_monthCounts_useMonthsEnHelper", () => {
    const source = read("app/rgpd/RgpdEn.tsx");

    expect(source).toContain("{monthsEn(SUSPENSION_RETENTION_MONTHS)} after it is lifted");
    expect(source).toContain("{monthsEn(SITE_VISITOR_RETENTION_MONTHS)} after that last visit");
    expect(source).not.toMatch(/\{(SUSPENSION|SITE_VISITOR)_RETENTION_MONTHS\} months/);
  });
});
