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

    expect(fr.subPurposes.join("\n")).toContain("Qu'une alerte ne prévienne pas deux fois de la même annonce tant que celle-ci reste sur le site");
    expect(en.subPurposes.join("\n")).toContain("Making sure an alert does not notify twice of the same post while it stays on the site");
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

describe("cycle juridique 2 — « jamais deux fois » borné à l'annonce gardée, listes du bot complétées", () => {
  const entry = PRIVACY_CHANGES.find((change) => change.id === "2026-11-alertes-d-annonces-geti");
  const english = PRIVACY_CHANGES_EN["2026-11-alertes-d-annonces-geti"];

  it("rgpdAlerts_neverTwice_isBoundToPostStayingOnSiteFrAndEn", () => {
    const fr = readSource("app/rgpd/page.tsx").replace(/\s+/g, " ");
    const en = readSource("app/rgpd/RgpdEn.tsx").replace(/\s+/g, " ");

    expect(fr).toContain("ne prévienne pas deux fois de la même annonce tant que celle-ci reste sur le site");
    expect(fr).toContain("une annonce qui revient ensuite compte comme nouvelle");
    expect(en).toContain("does not notify twice of the same post while it stays on the site");
    expect(en).toContain("a post that comes back afterwards counts as new");
  });

  it("getiAlertPrivacyChange_traceLeaves_asSoonAsPostLeavesSiteFrAndEn", () => {
    expect(entry?.details.join(" ")).toContain("dès qu'elle quitte le site (par exemple supprimée ou vidée de son texte");
    expect(english?.details.join(" ")).toContain("as soon as it leaves the site (for instance deleted or emptied of its text");
  });

  it("getiAlertPrivacyChange_deadlineDms_certifiedOnlyChangeDeclaredFrAndEn", () => {
    expect(entry?.details.join(" ")).toContain(
      "les messages de date butoir de planification ne partent plus qu'aux comptes dont le tag Discord est certifié",
    );
    expect(english?.details.join(" ")).toContain(
      "scheduling deadline messages now go only to accounts with a certified Discord tag",
    );
  });

  it("getiAlertPrivacyChange_nothingChangesClaim_absentFrAndEn", () => {
    expect(entry?.details.join(" ")).not.toContain("rien ne change dans ce qui est envoyé");
    expect(english?.details.join(" ")).not.toContain("nothing changes in what is sent");
  });

  it("getiAlertPrivacyChange_t21Change_linkedAndNamedFrAndEn", () => {
    expect(entry?.links?.map((link) => link.href)).toContain("/rgpd/registre#t21");
    expect(english?.linkLabels).toContain("Read record T21 of the register");
    expect(entry?.details.join(" ")).toContain("La fiche T21 du registre cite aussi la comparaison des annonces aux alertes");
    expect(english?.details.join(" ")).toContain("Record T21 of the register also mentions the comparison of posts with alerts");
  });

  it("registerT22_retention_traceErasedWhenPostLeavesSite", () => {
    const { fr, en } = record("T22");

    expect(fr.retention.join(" ")).toContain("effacée avec l'annonce dès qu'elle quitte le site");
    expect(en.retention.join(" ")).toContain("erased with the post as soon as it leaves the site");
  });

  it("registerT21_alerts_subPurposeAndRecipientDeclaredFrAndEn", () => {
    const { fr, en } = record("T21");

    expect(fr.subPurposes.join(" ")).toContain("Comparer chaque nouvelle annonce aux alertes que des comptes ont créées sur la page des annonces (T22)");
    expect(fr.recipients.join(" ")).toContain("Titulaires d'une alerte (T22)");
    expect(en.subPurposes.join(" ")).toContain("Comparing each new post with the alerts accounts created on the posts page (T22)");
    expect(en.recipients.join(" ")).toContain("Holders of an alert (T22)");
  });

  it("botPrivacyPolicy_getiAlertLink_openedOnReportedPost", () => {
    expect(JSON.stringify(PRIVACY_POLICY.fr)).toContain("un lien vers la page filtrée comme elle, ouverte sur l'annonce signalée, ni pseudo");
    expect(JSON.stringify(PRIVACY_POLICY.en)).toContain("a link to the page filtered like it, opened on the reported post, neither");
  });

  it("botPrivacyPolicy_siteMessages_listDeadlinesNewMatchProdAndPlanning", () => {
    const fr = JSON.stringify(PRIVACY_POLICY.fr);
    const en = JSON.stringify(PRIVACY_POLICY.en);

    expect(fr).toContain("date butoir de planification d'un match, ses rappels et le double forfait prononcé faute d'horaire");
    expect(fr).toContain("annonce d'un nouveau match aux membres de ses deux équipes");
    expect(fr).toContain("avis envoyé à la prod d'un match dont la place lui est donnée ou retirée");
    expect(fr).toContain("avis du planning des casts et arbitres aux arbitres, casters et prods qui le tiennent");
    expect(fr).toContain("ceux des matchs (horaire, rappel, retrait d'un match, check-in du match, date butoir, nouveau match, place de prod, retrait d'un cast) ne partent qu'aux comptes dont le tag Discord est certifié");
    expect(en).toContain("a match's scheduling deadline, its reminders and the double forfeit declared for lack of an agreed time");
    expect(en).toContain("announcement of a new match to the members of its two teams");
    expect(en).toContain("notice to a match's prod that the place is given to or taken from them");
    expect(en).toContain("notices of the cast and referee schedule to the referees, casters and prods who staff it");
    expect(en).toContain("those about matches (time, reminder, removal from a match, match check-in, scheduling deadline, new match, prod place, removal of a cast) only go to accounts with a Discord tag certified");
  });

  it("botPrivacyPolicy_basis_coversPlanningT20AndGetiAlertsT22", () => {
    const fr = JSON.stringify(PRIVACY_POLICY.fr);
    const en = JSON.stringify(PRIVACY_POLICY.en);

    expect(fr).toContain("registre du site T20) pour les avis du planning des casts et arbitres");
    expect(fr).toContain("exécution du service demandé par le compte (registre du site T22) pour les alertes d'annonces GETI");
    expect(en).toContain("the website's register T20) for the cast and referee schedule notices");
    expect(en).toContain("performance of the service the account asked for (the website's register T22) for GETI post alerts");
  });

  it("botTerms_article01_listsDeadlinesNewMatchProdAndPlanning", () => {
    const fr = JSON.stringify(TERMS_OF_SERVICE.fr.sections[0]);
    const en = JSON.stringify(TERMS_OF_SERVICE.en.sections[0]);

    expect(fr).toContain("dates butoirs de planification, annonces d'un nouveau match, avis de prod");
    expect(fr).toContain("avis du planning des casts et arbitres");
    expect(en).toContain("scheduling deadlines, announcements of a new match, prod notices");
    expect(en).toContain("cast and referee schedule notices");
  });

  it("registerT08_siteMessages_listProdPlanningStaffMessagesAndLogoRestored", () => {
    const { fr, en } = record("T08");
    const frText = fr.subPurposes.join(" ");
    const enText = en.subPurposes.join(" ");

    expect(frText).toContain("avis envoyé à la prod d'un match dont la place lui est donnée ou retirée");
    expect(frText).toContain("avis du planning des casts et arbitres (T20");
    expect(frText).toContain("messages du staff d'un tournoi à ses participants");
    expect(frText).toContain("logo masqué, retiré, supprimé ou rétabli");
    expect(enText).toContain("the notice sent to a match's prod that the place is given to or taken from them");
    expect(enText).toContain("notices of the cast and referee schedule (T20");
    expect(enText).toContain("messages from a tournament's staff to its participants");
    expect(enText).toContain("logo hidden, removed, deleted or restored");
  });
});

describe("cycle juridique 4 — liste des changements bornée, T12 nommée, annonce revenue", () => {
  const entry = PRIVACY_CHANGES.find((change) => change.id === "2026-11-alertes-d-annonces-geti");
  const english = PRIVACY_CHANGES_EN["2026-11-alertes-d-annonces-geti"];

  it("getiAlertPrivacyChange_onlyOneThingChanges_scopedToAlreadyDeliveredMessagesFrAndEn", () => {
    expect(entry?.details.join(" ")).toContain("Pour ces messages déjà remis, une seule chose change");
    expect(english?.details.join(" ")).toContain("For these messages already delivered, only one thing changes");
  });

  it("getiAlertPrivacyChange_logoRestoredNotice_listedFrAndEn", () => {
    expect(entry?.details.join(" ")).toContain("avis de logo rétabli");
    expect(english?.details.join(" ")).toContain("logo restored notices");
  });

  it("getiAlertPrivacyChange_t12Change_linkedAndNamedFrAndEn", () => {
    expect(entry?.links?.map((link) => link.href)).toContain("/rgpd/registre#t12");
    expect(english?.linkLabels).toContain("Read record T12 of the register");
    expect(english?.linkLabels).toHaveLength(entry?.links?.length ?? -1);
    expect(entry?.details.join(" ")).toContain("la fiche T12 (notifications push)");
    expect(english?.details.join(" ")).toContain("record T12 (push notifications)");
  });

  it("getiAlertTexts_returningPost_mayNotifyAgainFrAndEn", () => {
    const rgpdFr = readSource("app/rgpd/page.tsx").replace(/\s+/g, " ");
    const rgpdEn = readSource("app/rgpd/RgpdEn.tsx").replace(/\s+/g, " ");
    const { fr, en } = record("T22");

    expect(entry?.details.join(" ")).toContain("compte comme nouvelle, et peut donc prévenir de nouveau");
    expect(english?.details.join(" ")).toContain("counts as new, and may therefore notify again");
    expect(rgpdFr).toContain("compte comme nouvelle, et peut donc prévenir de nouveau");
    expect(rgpdEn).toContain("counts as new, and may therefore notify again");
    expect(fr.subPurposes.join(" ")).toContain("compte comme nouvelle (et peut donc prévenir de nouveau)");
    expect(en.subPurposes.join(" ")).toContain("counts as new (and may therefore notify again)");
  });
});
