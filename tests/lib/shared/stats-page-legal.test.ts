import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN, REGISTER_UPDATED_AT } from "@/lib/shared/processing-register";
import { readSource } from "../../helpers/read-source";

/**
 * STATS-PAGE (D75) : la mesure détaillée est déclarée — registre T19, `/rgpd`
 * FR et EN, nouvelle entrée de l'historique des changements.
 */
const ENTRY_ID = "2026-11-statistiques-frequentation-detaillees";

describe("registre T19", () => {
  it("register_t19_declaredInBothLanguages", () => {
    expect(PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T19")?.name).toBe("Statistiques de fréquentation détaillées");
    expect(PROCESSING_ACTIVITIES_EN.find((activity) => activity.ref === "T19")?.name).toBe("Detailed audience statistics");
  });

  it("register_t19Retention_thirteenMonthsAndSaltErasedNextDay", () => {
    const retention = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T19")?.retention.join(" | ") ?? "";

    expect(retention).toContain("13 mois");
    expect(retention).toContain("Sel du jour : en base le temps de la journée");
    expect(retention).toContain("effacé le lendemain");
    expect(retention).toContain("deux minutes au plus");
  });

  it("register_updatedAt_notBeforeTheStatsPageDate", () => {
    // Avancé depuis par l'empreinte perceptuelle des avatars bloqués (EF-72).
    expect(REGISTER_UPDATED_AT >= "2026-11-18").toBe(true);
  });
});

describe("historique des changements", () => {
  it("privacyChanges_statsEntry_followedByPhashEntryAndDated", () => {
    // Suivie de l'empreinte perceptuelle des avatars bloqués (EF-72), de « Tester mes MP », des rôles de plateforme et de la vue joueur.
    expect(PRIVACY_CHANGES.at(-15)?.id).toBe(ENTRY_ID);
    expect(PRIVACY_CHANGES.at(-15)?.publishedAt).toBe("2026-11-18");
    expect(PRIVACY_CHANGES.at(-15)?.links?.map((link) => link.href)).toEqual(["/rgpd#audience-detaillee", "/rgpd#audience"]);
  });

  it("privacyChanges_statsEntry_hasEnglish", () => {
    expect(PRIVACY_CHANGES_EN[ENTRY_ID]?.linkLabels).toHaveLength(2);
  });
});

describe("/rgpd", () => {
  it("rgpdFr_detailedAudienceSection_present", () => {
    expect(readSource("app/rgpd/page.tsx")).toContain('<h3 id="audience-detaillee">');
  });

  it("rgpdEn_detailedAudienceSection_present", () => {
    expect(readSource("app/rgpd/RgpdEn.tsx")).toContain('<h3 id="audience-detaillee">');
  });
});
