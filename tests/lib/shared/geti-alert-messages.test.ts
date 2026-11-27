import { describe, expect, it } from "@jest/globals";

import { getiAlertDm, getiAlertPath, getiAlertPush, type GetiAlertNotice } from "@/lib/shared/push-messages";
import { PUSH_TOPICS } from "@/lib/shared/push-notifications";
import {
  GETI_ALERT_COOLDOWN_MINUTES,
  GETI_ALERT_HIT_RETENTION_DAYS,
  GETI_ALERT_MAX_PER_USER,
} from "@/lib/shared/geti/alerts";
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "@/lib/shared/bot-legal-content";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register";
import { readSource } from "../../helpers/read-source";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import enPush from "@/messages/en/push.json";
import frPush from "@/messages/fr/push.json";

/** Ce que disent la notification push et le message privé d'une alerte d'annonces GETI. */

const NOTICE: GetiAlertNotice = {
  alertId: 7,
  category: "lfp",
  name: "Tank EU",
  search: "?role=tank",
  messageId: "100000000000000901",
};

describe("getiAlertPath", () => {
  it("getiAlertPath_alertWithFilters_pointsToThePostCardOnTheFilteredPage", () => {
    expect(getiAlertPath(NOTICE)).toBe("/geti-info/lfp?role=tank#post-100000000000000901");
  });
});

describe("getiAlertPush", () => {
  it("getiAlertPush_namedAlertInFrench_saysTheAlertNameAndLinksThePost", () => {
    expect(getiAlertPush(NOTICE, "fr")).toEqual({
      title: "Nouvelle annonce GETI",
      body: "Elle correspond à ton alerte « Tank EU ».",
      url: "/geti-info/lfp?role=tank#post-100000000000000901",
      tag: "geti-alert-7",
    });
  });

  it("getiAlertPush_unnamedAlert_usesTheCategoryTitle", () => {
    const push = getiAlertPush({ ...NOTICE, name: null }, "fr");

    expect(push.body).toBe("Elle correspond à ton alerte « Je cherche un joueur ».");
  });

  it("getiAlertPush_english_isWrittenInEnglishWithAPrefixedLink", () => {
    const push = getiAlertPush(NOTICE, "en");

    expect(push.title).toBe("New GETI post");
    expect(push.body).toBe("It matches your alert “Tank EU”.");
    expect(push.url).toBe("/en/geti-info/lfp?role=tank#post-100000000000000901");
  });
});

describe("getiAlertDm", () => {
  it("getiAlertDm_french_isTheSentenceOfTheSpecWithAnAbsoluteLink", () => {
    expect(getiAlertDm(NOTICE, "https://site.test", "fr")).toBe(
      "Nouvelle annonce GETI qui correspond à ton alerte « Tank EU » : https://site.test/geti-info/lfp?role=tank#post-100000000000000901",
    );
  });

  it("getiAlertDm_english_linksTheEnglishPage", () => {
    expect(getiAlertDm(NOTICE, "https://site.test", "en")).toBe(
      "New GETI post matching your alert “Tank EU”: https://site.test/en/geti-info/lfp?role=tank#post-100000000000000901",
    );
  });

  it("getiAlertDm_nameWithMentionAndMarkdown_isNeutralized", () => {
    const dm = getiAlertDm({ ...NOTICE, name: "@everyone **gras**" }, "https://site.test", "fr");

    expect(dm).not.toContain("@everyone");
    expect(dm).not.toContain("**gras**");
  });
});

describe("sujet GETI_ALERT", () => {
  it("pushTopics_getiAlert_isOpenToEveryAccountAndLabelledInBothLanguages", () => {
    expect(PUSH_TOPICS.GETI_ALERT.audience).toBeNull();
    expect(frPush.topics.GETI_ALERT.label).toBe(PUSH_TOPICS.GETI_ALERT.label);
    expect(enPush.topics.GETI_ALERT.label).toBe("GETI post alerts");
  });
});

describe("privacy change « alertes d'annonces GETI »", () => {
  // L'entrée est un historique écrit en clair : changer le délai ou la garde des
  // traces fait échouer ce test, et appelle une nouvelle entrée.
  it("getiAlertPrivacyChange_frenchAndEnglish_stateTheCurrentCooldownAndHitRetention", () => {
    const entry = PRIVACY_CHANGES.find((change) => change.id === "2026-11-alertes-d-annonces-geti");
    const english = PRIVACY_CHANGES_EN["2026-11-alertes-d-annonces-geti"];
    expect(english).toBeDefined();

    expect(entry?.details.join(" ")).toContain(`toutes les ${GETI_ALERT_COOLDOWN_MINUTES} minutes`);
    expect(entry?.details.join(" ")).toContain(`au bout de ${GETI_ALERT_HIT_RETENTION_DAYS} jours`);
    expect(english.details.join(" ")).toContain(`every ${GETI_ALERT_COOLDOWN_MINUTES} minutes`);
    expect(english.details.join(" ")).toContain(`after ${GETI_ALERT_HIT_RETENTION_DAYS} days`);
  });
});

/** Textes d'une fiche du registre, en français et en anglais. */
function record(ref: string) {
  const fr = PROCESSING_ACTIVITIES.find((activity) => activity.ref === ref);
  const en = PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === ref);
  if (!fr || !en) throw new Error(`fiche ${ref} absente`);
  return { fr, en };
}

describe("registre — T22 (cycle juridique 1)", () => {
  it("registerT22_dataSubjects_includePostAuthorsFrAndEn", () => {
    const { fr, en } = record("T22");

    expect(fr.dataSubjects.join("\n")).toContain("Auteurs des annonces recopiées (T21)");
    expect(en.dataSubjects.join("\n")).toContain("Authors of the copied posts (T21)");
  });

  it("registerT22_legalBasis_citesArt61bWithoutTermsOfUse", () => {
    const { fr, en } = record("T22");

    expect(fr.legalBasis).toContain("(RGPD, art. 6.1.b)");
    expect(fr.legalBasis).not.toContain("conditions d'utilisation");
    expect(en.legalBasis).toContain("(GDPR, art. 6.1.b)");
    expect(en.legalBasis).not.toContain("terms of use");
  });

  it("registerT22_hitRetention_leavesWithThePostAndAtTheLatestAfterRetentionDays", () => {
    const { fr, en } = record("T22");

    expect(fr.retention.join("\n")).toContain("effacée avec l'annonce");
    expect(fr.retention.join("\n")).toContain(`au plus tard ${GETI_ALERT_HIT_RETENTION_DAYS} jours après sa pose`);
    expect(en.retention.join("\n")).toContain("erased with the post");
    expect(en.retention.join("\n")).toContain(`at the latest ${GETI_ALERT_HIT_RETENTION_DAYS} days after it is made`);
  });

  it("registerT22_messageLink_saysItCarriesTheAlertFiltersAndSuspendedAccountsAreNotNotified", () => {
    const { fr, en } = record("T22");

    expect(fr.subPurposes.join("\n")).toContain("le lien reprend ses filtres");
    expect(fr.subPurposes.join("\n")).toContain("un compte suspendu garde ses alertes mais n'est plus prévenu");
    expect(en.subPurposes.join("\n")).toContain("the link carries its filters");
    expect(en.subPurposes.join("\n")).toContain("a suspended account keeps its alerts but is no longer notified");
  });

  it("registerT22_neverTwice_isPromisedPerAlertOnly", () => {
    const { fr, en } = record("T22");

    expect(fr.subPurposes.join("\n")).toContain("Qu'une alerte ne prévienne jamais deux fois de la même annonce");
    expect(en.subPurposes.join("\n")).toContain("Making sure an alert never notifies twice of the same post");
  });
});

describe("registre — T08 et documents du bot", () => {
  it("registerT08_siteMessages_listGetiPostAlerts", () => {
    const { fr, en } = record("T08");

    expect(fr.subPurposes.join("\n")).toContain("alertes d'annonces GETI (T22, aux seuls tags Discord certifiés)");
    expect(en.subPurposes.join("\n")).toContain("GETI post alerts (T22, to certified Discord tags only)");
  });

  it("botPrivacyPolicy_siteMessages_listGetiPostAlertCertifiedOnlyAndTopicOptOut", () => {
    const fr = JSON.stringify(PRIVACY_POLICY.fr);
    const en = JSON.stringify(PRIVACY_POLICY.en);

    expect(fr).toContain("alerte d'annonces GETI — une nouvelle annonce de recrutement correspond à une recherche que vous avez gardée sur le site");
    expect(fr).toContain("les alertes d'annonces GETI ne partent, elles aussi, qu'aux tags certifiés, et se coupent par leur sujet de notifications dans « Mon profil »");
    expect(en).toContain("GETI post alert — a new recruitment post matches a search you saved on the website");
    expect(en).toContain("GETI post alerts, too, only go to certified tags, and are turned off by their notification topic in “My profile”");
  });

  it("botTerms_article01_listsGetiPostAlerts", () => {
    expect(JSON.stringify(TERMS_OF_SERVICE.fr.sections[0])).toContain("alertes d'annonces GETI (aux seuls comptes dont le tag Discord est certifié)");
    expect(JSON.stringify(TERMS_OF_SERVICE.en.sections[0])).toContain("GETI post alerts (only to accounts with a certified Discord tag)");
  });
});

describe("privacy change « alertes d'annonces GETI » — cycle juridique 1", () => {
  const entry = PRIVACY_CHANGES.find((change) => change.id === "2026-11-alertes-d-annonces-geti");
  const english = PRIVACY_CHANGES_EN["2026-11-alertes-d-annonces-geti"];

  it("getiAlertPrivacyChange_details_stateTracesLeaveWithPostLinkFiltersAndSuspensionFrAndEn", () => {
    const fr = entry?.details.join(" ") ?? "";
    const en = english?.details.join(" ") ?? "";

    expect(fr).toContain("La trace d'une annonce déjà signalée part avec l'annonce");
    expect(fr).toContain("le lien reprend donc ses filtres");
    expect(fr).toContain("Un compte suspendu garde ses alertes mais n'est plus prévenu.");
    expect(en).toContain("The record of a post already reported leaves with the post");
    expect(en).toContain("the link therefore carries its filters");
    expect(en).toContain("A suspended account keeps its alerts but is no longer notified.");
  });

  it("getiAlertPrivacyChange_position_isTheLastEntry", () => {
    expect(PRIVACY_CHANGES.at(-1)?.id).toBe("2026-11-alertes-d-annonces-geti");
  });

  it("getiAlertPrivacyChange_maxAlerts_matchesTheConstantWrittenInLetters", () => {
    expect(GETI_ALERT_MAX_PER_USER).toBe(10);
    expect(entry?.details.join(" ")).toContain("Dix alertes au plus par compte.");
    expect(english?.details.join(" ")).toContain("Ten alerts at most per account.");
  });
});

describe("/rgpd — alertes d'annonces (cycle juridique 1)", () => {
  it("rgpdFr_pushSectionAndAlertParagraph_listAlertsExportAndSuspension", () => {
    const source = readSource("app/rgpd/page.tsx");

    expect(source).toContain("d&apos;une nouvelle annonce GETI qui correspond à l&apos;une de vos");
    expect(source).toContain('<a href="#alertes-geti">alertes</a>');
    expect(source).toContain("Les alertes et leurs traces figurent dans l&apos;export des données du");
    expect(source).toContain("Un compte suspendu garde ses alertes mais n&apos;est plus prévenu.");
  });

  it("rgpdEn_pushSectionAndAlertParagraph_listAlertsExportAndSuspension", () => {
    const source = readSource("app/rgpd/RgpdEn.tsx");

    expect(source).toContain("of a new GETI post that matches one of your");
    expect(source).toContain('<a href="#alertes-geti">alerts</a>');
    expect(source).toContain("are included in the export of the account&apos;s data.");
    expect(source).toContain("account keeps its alerts but is no longer notified.");
  });
});
