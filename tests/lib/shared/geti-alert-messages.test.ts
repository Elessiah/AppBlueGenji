import { describe, expect, it } from "@jest/globals";

import { getiAlertDm, getiAlertPath, getiAlertPush, type GetiAlertNotice } from "@/lib/shared/push-messages";
import { PUSH_TOPICS } from "@/lib/shared/push-notifications";
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
