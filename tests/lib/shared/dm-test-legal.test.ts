import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN, REGISTER_UPDATED_AT } from "@/lib/shared/processing-register";
import frProfile from "@/messages/fr/profile.json";
import enProfile from "@/messages/en/profile.json";
import { readSource } from "../../helpers/read-source";

/**
 * « Tester mes MP » : le message de test est déclaré — registre T04, `/rgpd`
 * FR et EN, nouvelle entrée de l'historique des changements.
 */
const ENTRY_ID = "2026-11-test-messages-prives";

describe("registre T04", () => {
  it("register_t04_mentionsDmTestInBothLanguages", () => {
    const fr = JSON.stringify(PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T04"));
    const en = JSON.stringify(PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T04"));

    expect(fr).toContain("Tester mes MP");
    expect(en).toContain("Test my DMs");
  });

  it("register_updatedAt_notBeforeTheDmTestDate", () => {
    expect(REGISTER_UPDATED_AT >= "2026-11-20").toBe(true);
  });
});

describe("historique des changements", () => {
  it("privacyChanges_dmTestEntry_isLastAndDated", () => {
    expect(PRIVACY_CHANGES.at(-1)?.id).toBe(ENTRY_ID);
    expect(PRIVACY_CHANGES.at(-1)?.publishedAt).toBe("2026-11-20");
  });

  it("privacyChanges_dmTestEntry_hasEnglish", () => {
    expect(PRIVACY_CHANGES_EN[ENTRY_ID]).toBeDefined();
  });
});

describe("/rgpd", () => {
  it("rgpd_dmTestParagraph_presentInFrenchAndEnglish", () => {
    expect(readSource("app/rgpd/page.tsx")).toContain('id="test-messages-prives"');
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain('id="test-messages-prives"');
  });
});

/** Le paragraphe `/rgpd` du test, d'une langue : de son ancre à la fin du `<p>`. */
function rgpdParagraph(path: string): string {
  const source = readSource(path);
  const start = source.indexOf('id="test-messages-prives"');
  return source.slice(start, source.indexOf("</p>", start)).replace(/\s+/g, " ");
}

function activity(list: typeof PROCESSING_ACTIVITIES, ref: string) {
  const found = list.find((entry) => entry.ref === ref);
  if (!found) throw new Error(`activité ${ref} absente`);
  return found;
}

const frEntry = () => JSON.stringify(PRIVACY_CHANGES.find((change) => change.id === ENTRY_ID));
const enEntry = () => JSON.stringify(PRIVACY_CHANGES_EN[ENTRY_ID]);

describe("le plafond d'essais : en mémoire, remis à zéro au redémarrage", () => {
  it("rgpdFr_dmTestParagraph_saysNormallyAndRestart", () => {
    const paragraph = rgpdParagraph("app/rgpd/page.tsx");

    expect(paragraph).toContain("Normalement au plus");
    expect(paragraph).toContain("repart de zéro quand le site redémarre");
  });

  it("rgpdEn_dmTestParagraph_saysNormallyAndRestart", () => {
    const paragraph = rgpdParagraph("app/rgpd/RgpdEn.tsx");

    expect(paragraph).toContain("Normally at most");
    expect(paragraph).toContain("when the site restarts");
  });

  it("privacyChanges_dmTestEntry_saysNormallyAndRestartInBothLanguages", () => {
    expect(frEntry()).toContain("Normalement au plus");
    expect(frEntry()).toContain("quand le site redémarre");
    expect(enEntry()).toContain("Normally at most");
    expect(enEntry()).toContain("when the site restarts");
  });

  it("register_t04_purposeSaysNormallyAndRestart", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T04").subPurposes.join(" ")).toContain("normalement au plus");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T04").subPurposes.join(" ")).toContain("normally at most");
  });
});

describe("ce qui est gardé en mémoire : numéro du compte et heure de chaque essai", () => {
  it("legalTexts_fr_declareTryTimesAndLastClick", () => {
    const retention = activity(PROCESSING_ACTIVITIES, "T04").retention.join(" ");

    expect(rgpdParagraph("app/rgpd/page.tsx")).toContain("l&apos;heure de chacun de vos essais");
    expect(rgpdParagraph("app/rgpd/page.tsx")).toContain("dernier clic sur le bouton");
    expect(frEntry()).toContain("l'heure de chacun de tes essais");
    expect(retention).toContain("l'heure de chacun de ses essais");
    expect(retention).toContain("dernier clic sur le bouton");
  });

  it("legalTexts_en_declareTryTimesAndLastClick", () => {
    const retention = activity(PROCESSING_ACTIVITIES_EN, "T04").retention.join(" ");

    expect(rgpdParagraph("app/rgpd/RgpdEn.tsx")).toContain("the time of each of your tries");
    expect(rgpdParagraph("app/rgpd/RgpdEn.tsx")).toContain("last click on the button");
    expect(enEntry()).toContain("the time of each of your tries");
    expect(retention).toContain("the time of each of its tries");
    expect(retention).toContain("last click on the button");
  });

  it("legalTexts_lastTryWording_isGone", () => {
    expect(rgpdParagraph("app/rgpd/page.tsx")).not.toContain("dernier essai");
    expect(frEntry()).not.toContain("dernier essai");
    expect(enEntry()).not.toContain("last try");
  });
});

describe("la ligne du journal du staff pour un message non remis", () => {
  it("register_t04_recipientsNameTheDmTestLogLine", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T04").recipients.join(" ")).toContain("« Tester mes MP » non remis");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T04").recipients.join(" ")).toContain("undelivered “Test my DMs”");
  });

  it("register_t05_subPurposesListTheDmTestLine", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T05").subPurposes.join(" ")).toContain("« Tester mes MP » non remis");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T05").subPurposes.join(" ")).toContain("Undelivered “Test my DMs”");
  });

  it("legalTexts_noLongerSayTheResultIsNotRecordedAtAll", () => {
    expect(rgpdParagraph("app/rgpd/page.tsx")).toContain("le site ne l&apos;enregistre pas");
    expect(rgpdParagraph("app/rgpd/page.tsx")).toContain("une ligne qui en donne l&apos;issue");
    expect(rgpdParagraph("app/rgpd/RgpdEn.tsx")).toContain("leaves a line giving its outcome");
  });
});

describe("registre T04 : base, personnes et catégories du test", () => {
  it("register_t04_legalBasisCoversDmTest", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T04").legalBasis).toContain("pour le message de test « Tester mes MP »");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T04").legalBasis).toContain("for the “Test my DMs” test message");
  });

  it("register_t04_dataSubjectsCoverDmTest", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T04").dataSubjects.join(" ")).toContain("« Tester mes MP »");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T04").dataSubjects.join(" ")).toContain("“Test my DMs”");
  });

  it("register_t04_dataCategoriesCoverDmTest", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T04").dataCategories.join(" ")).toContain("l'heure de chacun de ses essais");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T04").dataCategories.join(" ")).toContain("the time of each of its tries");
  });
});

describe("anglais : « certifié » se dit certified", () => {
  it("englishTexts_dmTest_sayCertifiedNotVerified", () => {
    const t04 = activity(PROCESSING_ACTIVITIES_EN, "T04").subPurposes.join(" ");

    expect(rgpdParagraph("app/rgpd/RgpdEn.tsx")).toContain("your tag is certified");
    expect(enEntry()).toContain("your tag is certified");
    expect(t04).toContain("their tag is certified");
    expect(`${rgpdParagraph("app/rgpd/RgpdEn.tsx")} ${enEntry()} ${t04}`).not.toContain("tag is verified");
  });
});

describe("le bot cherche le joueur sur tous les serveurs BlueGenji", () => {
  it("legalTexts_dmTest_namePluralServers", () => {
    expect(rgpdParagraph("app/rgpd/page.tsx")).toContain("absent des serveurs");
    expect(rgpdParagraph("app/rgpd/RgpdEn.tsx")).toContain("not on any BlueGenji server");
    expect(frEntry()).toContain("absent des serveurs BlueGenji");
    expect(enEntry()).toContain("not on any BlueGenji server");
  });

  it("legalTexts_dmTest_singularServerIsGone", () => {
    expect(rgpdParagraph("app/rgpd/page.tsx")).not.toContain("absent du serveur");
    expect(frEntry()).not.toContain("absent du serveur");
    expect(enEntry()).not.toContain("not on the BlueGenji server");
  });
});

describe("la case des messages privés de match ne s'applique pas au test", () => {
  it("legalTexts_dmTest_sayTheDmSwitchDoesNotApply", () => {
    expect(rgpdParagraph("app/rgpd/page.tsx")).toContain("ne s&apos;applique pas à ce test");
    expect(rgpdParagraph("app/rgpd/RgpdEn.tsx")).toContain("does not apply to this test");
    expect(frEntry()).toContain("ne s'applique pas à ce test");
    expect(enEntry()).toContain("does not apply to this test");
  });
});

describe("T05 : la ligne du test, complète et cohérente", () => {
  it("register_t05_legalBasisCoversDmTestLine", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T05").legalBasis).toContain("la ligne d'un message de test « Tester mes MP » non remis");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T05").legalBasis).toContain("the line for a “Test my DMs” test message not delivered");
  });

  it("register_t05_dataSubjectsIncludeDmTesters", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T05").dataSubjects).toContain(
      "Titulaires de compte qui demandent le message de test « Tester mes MP » (jamais nommés ni désignés)",
    );
    expect(activity(PROCESSING_ACTIVITIES_EN, "T05").dataSubjects).toContain(
      "Account holders who request the “Test my DMs” test message (never named or designated)",
    );
  });

  it("register_t05_dataCategoriesDescribeCountsOrError", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T05").dataCategories.join(" ")).toContain(
      "l'issue en nombres (remis, introuvables, injoignables) ou l'erreur rendue",
    );
    expect(activity(PROCESSING_ACTIVITIES_EN, "T05").dataCategories.join(" ")).toContain(
      "the outcome as counts (delivered, not found, unreachable) or the error returned",
    );
  });

  it("register_t05_subPurpose_saysDatedByDiscordNotTime", () => {
    const fr = activity(PROCESSING_ACTIVITIES, "T05").subPurposes.join(" ");
    const en = activity(PROCESSING_ACTIVITIES_EN, "T05").subPurposes.join(" ");

    expect(fr).toContain("datée par Discord");
    expect(en).toContain("dated by Discord");
    expect(fr).not.toContain("l'issue et l'heure");
    expect(en).not.toContain("outcome and time");
  });
});

describe("T04 : la finalité couvre la vérification à la demande", () => {
  it("register_t04_purposeCoversReachabilityCheck", () => {
    expect(activity(PROCESSING_ACTIVITIES, "T04").purpose).toContain("que le bot peut le joindre en message privé");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T04").purpose).toContain("that the bot can reach them by direct message");
  });
});

describe("un envoi que le bot ne parvient pas à faire laisse une ligne d'erreur", () => {
  it("legalTexts_dmTest_declareErrorLine", () => {
    expect(rgpdParagraph("app/rgpd/page.tsx")).toContain("une ligne qui donne l&apos;erreur");
    expect(rgpdParagraph("app/rgpd/RgpdEn.tsx")).toContain("a line giving the error");
    expect(frEntry()).toContain("une ligne qui donne l'erreur");
    expect(enEntry()).toContain("a line giving the error");
    expect(activity(PROCESSING_ACTIVITIES, "T04").retention.join(" ")).toContain("une ligne qui donne l'erreur");
    expect(activity(PROCESSING_ACTIVITIES_EN, "T04").retention.join(" ")).toContain("a line giving the error");
  });
});

describe("les notifications parlent de tous les serveurs BlueGenji", () => {
  it("profileTexts_notInServer_namePluralServers", () => {
    expect(frProfile.dmTest.notInServer).toContain("sur aucun serveur Discord BlueGenji");
    expect(frProfile.dmTest.hintInvite).toContain("Sur aucun serveur BlueGenji");
    expect(enProfile.dmTest.notInServer).toContain("on any BlueGenji Discord server");
    expect(enProfile.dmTest.hintInvite).toContain("Not on any BlueGenji server");
  });

  it("profileTexts_notInServer_singularServerIsGone", () => {
    expect(frProfile.dmTest.notInServer).not.toContain("sur le serveur Discord BlueGenji");
    expect(enProfile.dmTest.notInServer).not.toContain("on the BlueGenji Discord server");
  });
});
