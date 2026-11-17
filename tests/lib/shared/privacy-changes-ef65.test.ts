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
    expect(source).toContain('<section id="suppression-et-palmares"');
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
    expect(REGISTER_UPDATED_AT >= "2026-11-18").toBe(true);
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

describe("revue juridique EF-65 — pseudo d'emprunt suffixé et borne des noms essayés", () => {
  const SUFFIX_ID = "2026-11-pseudo-emprunt-suffixe";

  it("privacyChanges_suffixEntry_datedLinkedWithEnglish", () => {
    expect(entry(SUFFIX_ID)?.publishedAt).toBe("2026-11-18");
    expect(entry(SUFFIX_ID)?.links?.map((link) => link.href)).toEqual(["/rgpd#suppression-et-palmares"]);
    expect(PRIVACY_CHANGES_EN[SUFFIX_ID]?.linkLabels).toHaveLength(1);
  });

  it("privacyChanges_suffixEntry_declaresGuessFingerprints", () => {
    const fr = (entry(SUFFIX_ID)?.details ?? []).join(" ");
    const en = (PRIVACY_CHANGES_EN[SUFFIX_ID]?.details ?? []).join(" ");

    expect(fr).toContain("en mémoire seulement et au plus 24 heures");
    expect(fr).toContain("passé quatre");
    expect(en).toContain("in memory only and for 24 hours at most");
    expect(en).toContain("past four");
  });

  it("privacyChanges_decisionsEntry_namesModeratorInT11", () => {
    expect((entry("2026-11-decisions-sur-image-et-signalement")?.details ?? []).join(" ")).toContain(
      "le registre des traitements (T11) le cite désormais",
    );
    expect((PRIVACY_CHANGES_EN["2026-11-decisions-sur-image-et-signalement"]?.details ?? []).join(" ")).toContain(
      "the record of processing activities (T11) now lists it",
    );
  });

  it("register_t01_declaresWrongNameFingerprints", () => {
    const t01 = [PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN]
      .map((activities) => activities.find((activity) => activity.ref === "T01"))
      .map((activity) => [...(activity?.dataCategories ?? []), ...(activity?.retention ?? [])].join(" | "))
      .join(" || ");

    expect(t01).toContain("sous une empreinte HMAC dont la clé n'est enregistrée nulle part");
    expect(t01).toContain("as an HMAC fingerprint whose key is never written");
    expect(t01).toContain("en mémoire seulement, 24 heures au plus");
    expect(t01).toContain("in memory only, 24 hours at most");
  });

  it.each([
    ["app/rgpd/page.tsx", "une forme qui signale un compte supprimé", "passé quatre, son lien demeure, vers la page introuvable"],
    ["app/rgpd/RgpdEn.tsx", "a form that marks a deleted account", "past four, its link stays, to the page not found"],
  ])("rgpd_%s_saysFormMarksDeletionAndLinkLimit", (path, form, limit) => {
    const source = readSource(path);

    expect(source).toContain(form);
    expect(source).toContain(limit);
  });
});
