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
import { ASSOCIATION_GMAIL_FRAMEWORK } from "@/lib/shared/processing-register";

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
    expect(PRIVACY_CHANGES_EN[ID]?.linkLabels).toHaveLength(2);
    for (const page of ["app/rgpd/page.tsx", "app/rgpd/RgpdEn.tsx"]) {
      expect(read(page)).toContain('<section id="destinataires"');
      expect(read(page)).toContain('<section id="notifications"');
    }
  });
});

describe("politique du bot (LEGAL-LOT-1)", () => {
  const fr = JSON.stringify(PRIVACY_POLICY.fr);
  const en = JSON.stringify(PRIVACY_POLICY.en);

  it("botPrivacyPolicy_host_saysNoHostingProviderAndHetznerAssociationProcessorFrAndEn", () => {
    expect(fr).toContain("aucun prestataire d'hébergement, donc pas de sous-traitant");
    expect(fr).toContain("dans l'Union européenne : sous-traitant de l'association.");
    expect(fr).not.toContain("sous-traitant ultérieur");
    expect(en).toContain("no hosting provider, so no processor");
    expect(en).toContain("within the European Union: processor of the association.");
    expect(en).not.toContain("sub-processor");
  });

  it("botPrivacyPolicy_moderationNotice_listsRestoredTeamLogoFrAndEn", () => {
    expect(fr).toContain("logo d'équipe masqué, retiré, supprimé ou rétabli");
    expect(en).toContain("a team logo masked, removed, deleted or restored");
  });

  it("botPrivacyPolicy_liveEvening_listsInAdvanceOnlyStartTimeBroadcastsFrAndEn", () => {
    expect(fr).toContain("ceux programmés d'ici la fin de la soirée dont la diffusion doit s'ouvrir à leur heure de début");
    expect(en).toContain("those scheduled until the end of the evening whose broadcast is set to open at their start time");
  });

  it("botPrivacyPolicy_legalBasis_namesTeamDirectMessagesAndObjectionFrAndEn", () => {
    expect(fr).toContain("pour les messages privés d'équipe — demande d'adhésion, invitation d'une équipe, reprise d'une équipe fantôme proposée, propriété d'équipe transférée —, auxquels chacun peut s'opposer sur demande");
    expect(en).toContain("for team direct messages — join request, a team's invitation, offered takeover of a ghost team, transferred team ownership —, which anyone may object to on request");
  });

  it("botPrivacyPolicy_staffLog_namesAccountDeletionRequestsFrAndEn", () => {
    expect(fr).toContain("demandes de suppression de compte et leur réactivation, « un joueur »");
    expect(en).toContain("account deletion requests and their reactivation, “a player”");
  });

  it("botPrivacyPolicy_lastUpdated_datedWithSiteRectification", () => {
    expect([PRIVACY_POLICY.fr.lastUpdated, PRIVACY_POLICY.en.lastUpdated]).toEqual(["13 novembre 2026", "13 November 2026"]);
  });
});
