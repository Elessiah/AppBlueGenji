import { describe, expect, it } from "@jest/globals";
import { BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import {
  DONNEES_PROFIL,
  DONNEE_SAUVEGARDES,
  DONNEE_TOURNOIS,
  DROITS,
  RGPD_CONTACT_EMAIL_FALLBACK,
} from "@/lib/shared/rgpd-policy";

describe("DONNEES_PROFIL", () => {
  it("covers all profile data types", () => {
    const names = DONNEES_PROFIL.map((d) => d.donnee);
    expect(names).toContain("Pseudo site");
    expect(names).toContain("Pseudo Overwatch");
    expect(names).toContain("Pseudo Discord");
    expect(names).toContain("ID Discord");
    expect(names).toContain("Pseudo Marvel Rivals");
    expect(names).toContain("Avatar");
    expect(names).toContain("Certification du pseudo Discord");
    // Les trois portes d'entrée du compte. Ce sont des **moyens de connexion**
    // avant d'être des identifiants techniques : le déclarer est la condition
    // pour que « on ne peut pas retirer le dernier » ait un sens pour le
    // lecteur.
    expect(names).toContain("Identifiant Google");
    expect(names).toContain("Identifiant Blizzard");
  });

  it("has exactly 9 entries", () => {
    expect(DONNEES_PROFIL).toHaveLength(9);
  });

  it("déclare chaque identité OAuth comme un moyen de connexion retirable", () => {
    for (const donnee of ["ID Discord", "Identifiant Google", "Identifiant Blizzard"]) {
      const entry = DONNEES_PROFIL.find((d) => d.donnee === donnee);
      expect(entry?.finalite).toMatch(/moyen de connexion/i);
      expect(entry?.finalite).toMatch(/retirable/i);
    }
  });

  it("ne déclare **aucune** adresse e-mail, qui n'est plus collectée", () => {
    // Le scope `email` a disparu de la demande faite à Google et plus rien ne
    // rattache un compte par son adresse : déclarer une collecte qui n'a plus
    // lieu serait aussi faux que taire celle qui a lieu.
    const google = DONNEES_PROFIL.find((d) => d.donnee === "Identifiant Google");
    expect(google?.finalite).toMatch(/aucune adresse e-mail n’est demandée|aucune adresse e-mail n'est demandée/i);
    expect(DONNEES_PROFIL.map((d) => d.donnee)).not.toContain("Adresse e-mail");
  });

  it("dit que Blizzard renseigne le BattleTag, qu'il écrase à chaque connexion", () => {
    // Sans cette phrase, un joueur qui voit sa saisie changer ne peut pas savoir
    // pourquoi.
    const overwatch = DONNEES_PROFIL.find((d) => d.donnee === "Pseudo Overwatch");
    expect(overwatch?.finalite).toMatch(/Blizzard/);
    expect(overwatch?.finalite).toMatch(/chaque connexion/i);
  });

  it("dit qui lit encore un BattleTag masqué, et jusqu'à quand", () => {
    const overwatch = DONNEES_PROFIL.find((d) => d.donnee === "Pseudo Overwatch");
    expect(overwatch?.finalite).toMatch(/Masqué, il reste lisible des joueurs de tes matchs et de l'arbitrage/);
    expect(overwatch?.finalite).toMatch(/tant que le tournoi n'est pas terminé/);
  });

  it("dit les deux régimes du tag Discord : certifié exposé, non certifié privé", () => {
    // La finalité a changé avec la certification, et une déclaration restée sur
    // l'ancienne serait fausse : le tag certifié est une coordonnée de contact
    // exposée à l'organisation. Les deux régimes coexistent en base, la phrase
    // doit donc nommer les deux.
    const tag = DONNEES_PROFIL.find((d) => d.donnee === "Pseudo Discord");
    expect(tag?.finalite).toMatch(/certifié/i);
    expect(tag?.finalite).toMatch(/arbitres?/i);
    expect(tag?.finalite).toMatch(/Non certifié/i);
  });

  it("déclare la certification elle-même, et qu'elle se perd", () => {
    const certification = DONNEES_PROFIL.find(
      (d) => d.donnee === "Certification du pseudo Discord",
    );
    expect(certification?.finalite).toMatch(/modifié/i);
  });

  it("nomme les **deux** chemins de certification, dont celui qui n'est pas demandé", () => {
    // Se connecter par Discord certifie le tag tout seul (c'est la preuve
    // même), donc l'exposition peut commencer sans qu'aucun bouton ait été
    // pressé. Une déclaration qui ne parlerait que de « Mon profil » laisserait
    // croire à un geste toujours délibéré — et un membre qui entre toujours par
    // Discord ne visite peut-être jamais cette page.
    const certification = DONNEES_PROFIL.find(
      (d) => d.donnee === "Certification du pseudo Discord",
    );
    expect(certification?.finalite).toMatch(/profil/i);
    expect(certification?.finalite).toMatch(/connect/i);
  });

  it("discloses that the Discord user ID is stored for Discord login", () => {
    const idDiscord = DONNEES_PROFIL.find((d) => d.donnee === "ID Discord");
    expect(idDiscord).toBeDefined();
    expect(idDiscord?.finalite).toMatch(/Discord/);
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
    // **Bornée par** la durée du compte, et non strictement égale : la
    // certification du tag Discord se perd dès que le tag change, donc plus tôt.
    // Ce qu'il faut tenir est qu'aucune donnée de profil ne survive au compte —
    // pas que toutes vivent exactement aussi longtemps que lui.
    for (const entry of DONNEES_PROFIL) {
      expect(entry.duree.toLowerCase()).toContain("durée du compte");
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

describe("RGPD_CONTACT_EMAIL_FALLBACK", () => {
  it("is a valid email address", () => {
    expect(RGPD_CONTACT_EMAIL_FALLBACK).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });
});

describe("DONNEE_SAUVEGARDES", () => {
  it("annonce la durée réelle des sauvegardes, pas « quelques jours »", () => {
    expect(DONNEE_SAUVEGARDES.duree).toBe(`${BACKUP_RETENTION_DAYS} jours au plus`);
    expect(BACKUP_RETENTION_DAYS).toBe(30);
  });

  it("nomme l'hébergeur et le chiffrement", () => {
    expect(DONNEE_SAUVEGARDES.finalite).toMatch(/Microsoft/);
    expect(DONNEE_SAUVEGARDES.finalite).toMatch(/chiffrées/i);
  });
});
