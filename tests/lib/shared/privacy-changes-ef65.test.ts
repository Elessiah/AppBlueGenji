import { describe, expect, it } from "@jest/globals";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
import { PROCESSING_ACTIVITIES, REGISTER_UPDATED_AT } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
import { readSource } from "../../helpers/read-source";

/**
 * EF-65 : D88 (ancres de la note * et du passage palmarès, entrée nouvelle qui
 * y mène) et D87 (décision close effacée avec son signalement).
 */
const entry = (id: string) => PRIVACY_CHANGES.find((change) => change.id === id);

describe("D88 — renvoi de l'information du 4 novembre", () => {
  it.each(["app/rgpd/page.tsx", "app/rgpd/RgpdEn.tsx"])("rgpd_%s_carriesBothAnchors", (path) => {
    const source = readSource(path);

    expect(source).toContain('<p id="effacement-complet"');
    expect(source).toContain('<div id="suppression-et-palmares"');
  });

  it("privacyChanges_newEntry_linksToTheNewAnchors", () => {
    expect(entry("2026-11-suppression-du-compte-bons-passages")?.links?.map((link) => link.href)).toEqual([
      "/rgpd#effacement-complet",
      "/rgpd#suppression-et-palmares",
    ]);
    expect(PRIVACY_CHANGES_EN["2026-11-suppression-du-compte-bons-passages"]?.linkLabels).toHaveLength(2);
  });

  it("privacyChanges_publishedEntry_untouched", () => {
    expect(entry("2026-11-suppression-inscription-solo-et-fiche")?.links?.map((link) => link.href)).toEqual([
      "/rgpd#donnees-connexion",
    ]);
  });
});

describe("D87 — décision close effacée avec son signalement", () => {
  it("privacyChanges_newEntry_datedWithEnglish", () => {
    expect(entry("2026-11-decisions-sur-image-et-signalement")?.publishedAt).toBe("2026-11-18");
    expect(PRIVACY_CHANGES_EN["2026-11-decisions-sur-image-et-signalement"]).toBeDefined();
    expect(REGISTER_UPDATED_AT).toBe("2026-11-18");
  });

  it("register_t11Retention_decisionErasedWithItsReport", () => {
    const retention = [PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN]
      .flatMap((activities) => activities.find((activity) => activity.ref === "T11")?.retention ?? [])
      .join(" | ");

    expect(retention).toContain("jusqu'à l'effacement du signalement qui l'a motivée");
    expect(retention).toContain("until the report that prompted it is erased");
    expect(retention).not.toContain("Décision de suppression d'un avatar (empreinte, issue de la contestation) : tant que le compte existe");
  });
});
