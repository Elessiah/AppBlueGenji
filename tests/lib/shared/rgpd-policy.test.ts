import { describe, expect, it } from "@jest/globals";
import {
  DONNEES_PROFIL,
  DONNEE_TOURNOIS,
  DROITS,
  RGPD_CONTACT_EMAIL,
} from "@/lib/shared/rgpd-policy";

describe("DONNEES_PROFIL", () => {
  it("covers all five profile data types", () => {
    const names = DONNEES_PROFIL.map((d) => d.donnee);
    expect(names).toContain("Pseudo site");
    expect(names).toContain("Pseudo Overwatch 2");
    expect(names).toContain("Pseudo Discord");
    expect(names).toContain("Pseudo Marvel Rivals");
    expect(names).toContain("Avatar");
  });

  it("has exactly 5 entries", () => {
    expect(DONNEES_PROFIL).toHaveLength(5);
  });

  it("every profile entry uses Consentement as legal basis", () => {
    for (const entry of DONNEES_PROFIL) {
      expect(entry.base).toBe("Consentement");
    }
  });

  it("every profile entry has a non-empty finalite and duree", () => {
    for (const entry of DONNEES_PROFIL) {
      expect(entry.finalite.trim().length).toBeGreaterThan(0);
      expect(entry.duree.trim().length).toBeGreaterThan(0);
    }
  });

  it("profile data is tied to account lifetime", () => {
    for (const entry of DONNEES_PROFIL) {
      expect(entry.duree).toBe("Durée du compte");
    }
  });
});

describe("DONNEE_TOURNOIS", () => {
  it("uses Intérêt légitime as legal basis (not Consentement)", () => {
    expect(DONNEE_TOURNOIS.base).toBe("Intérêt légitime");
    expect(DONNEE_TOURNOIS.base).not.toBe("Consentement");
  });

  it("has an indefinite retention period", () => {
    expect(DONNEE_TOURNOIS.duree).toMatch(/[Ii]ndéfini/);
  });

  it("has a non-empty finalite", () => {
    expect(DONNEE_TOURNOIS.finalite.trim().length).toBeGreaterThan(0);
  });
});

describe("DROITS", () => {
  it("has exactly 6 GDPR rights (art. 15–22)", () => {
    expect(DROITS).toHaveLength(6);
  });

  it("covers the right to erasure (effacement)", () => {
    const found = DROITS.some((d) =>
      d.title.toLowerCase().includes("effacement")
    );
    expect(found).toBe(true);
  });

  it("covers the right to access (accès)", () => {
    const found = DROITS.some((d) =>
      d.title.toLowerCase().includes("accès")
    );
    expect(found).toBe(true);
  });

  it("covers the right to opposition", () => {
    const found = DROITS.some((d) =>
      d.title.toLowerCase().includes("opposition")
    );
    expect(found).toBe(true);
  });

  it("every right has a non-empty title and text", () => {
    for (const droit of DROITS) {
      expect(droit.title.trim().length).toBeGreaterThan(0);
      expect(droit.text.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("RGPD_CONTACT_EMAIL", () => {
  it("is a valid email address", () => {
    expect(RGPD_CONTACT_EMAIL).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });
});
