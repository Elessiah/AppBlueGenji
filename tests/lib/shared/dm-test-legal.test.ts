import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN, REGISTER_UPDATED_AT } from "@/lib/shared/processing-register";
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
