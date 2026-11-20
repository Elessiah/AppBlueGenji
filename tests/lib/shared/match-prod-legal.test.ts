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
    expect(page("app/rgpd/page.tsx")).toContain("pseudos des casters et de la prod d");
    expect(page("app/rgpd/RgpdEn.tsx")).toContain("casters and prod");
    expect(page("app/rgpd/page.tsx")).toContain('href="/rgpd/registre#t16"');
    expect(page("app/rgpd/RgpdEn.tsx")).toContain('href="/rgpd/registre#t16"');
  });
});
