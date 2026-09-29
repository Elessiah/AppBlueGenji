import { describe, expect, it } from "@jest/globals";
import { BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import {
  DONNEES_PROFIL,
  DONNEE_SAUVEGARDES,
  DONNEE_TOURNOIS,
  DROITS,
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
    expect(overwatch?.finalite).toMatch(/Masqué, il reste lisible des joueurs de tes matchs, de leur caster et de l'arbitrage/);
    expect(overwatch?.finalite).toMatch(/tant que le tournoi n'est pas terminé/);
  });

  it("dit que le tag Discord enregistré à la connexion n'est pas certifié, donc privé", () => {
    const tag = DONNEES_PROFIL.find((d) => d.donnee === "Pseudo Discord");
    expect(tag?.finalite).toMatch(/Enregistré à ta connexion par Discord, ou saisi par toi/);
    expect(tag?.finalite).toMatch(/sans certification, invisible de tous, administrateurs compris/);
  });

  it("déclare, sur la certification, chaque public qu'elle ouvre — et celui qu'on choisit", () => {
    const certification = DONNEES_PROFIL.find(
      (d) => d.donnee === "Certification du pseudo Discord",
    );
    expect(certification?.finalite).toMatch(/administrateurs en permanence/i);
    expect(certification?.finalite).toMatch(/arbitres/i);
    expect(certification?.finalite).toMatch(/caster de ton match/i);
    expect(certification?.finalite).toMatch(/autres joueurs connectés/i);
    expect(certification?.finalite).toContain("« Tag Discord »");
  });

  it("déclare que la certification se retire, et qu'elle se perd au changement de pseudo", () => {
    const certification = DONNEES_PROFIL.find(
      (d) => d.donnee === "Certification du pseudo Discord",
    );
    expect(certification?.finalite).toMatch(/retirant ton tag/i);
    expect(certification?.finalite).toMatch(/pseudo change/i);
  });

  it("dit que la certification est un geste du joueur, que la connexion ne donne pas", () => {
    // La base « Consentement » ne tient que si le geste est distinct : se
    // connecter est un acte d'authentification, pas un consentement.
    const certification = DONNEES_PROFIL.find(
      (d) => d.donnee === "Certification du pseudo Discord",
    );
    expect(certification?.finalite).toMatch(/profil/i);
    expect(certification?.finalite).toMatch(/se connecter par Discord ne la donne pas/i);
    expect(certification?.finalite).not.toMatch(/automatiquement/i);
    expect(certification?.base).toBe("Consentement");
  });

  it("discloses that the Discord user ID is stored for Discord login", () => {
    const idDiscord = DONNEES_PROFIL.find((d) => d.donnee === "ID Discord");
    expect(idDiscord).toBeDefined();
    expect(idDiscord?.finalite).toMatch(/Discord/);
  });

  it("fonde le compte et la connexion sur le contrat, et non sur un consentement", () => {
    // Un consentement demandé pour des données sans lesquelles le compte
    // n'existe pas ne serait pas libre (RGPD art. 7.4) — et le registre (T01,
    // T02) les fonde déjà sur le contrat : une donnée n'a qu'une base.
    for (const donnee of [
      "Pseudo site",
      "Pseudo Discord",
      "ID Discord",
      "Identifiant Google",
      "Identifiant Blizzard",
    ]) {
      expect(DONNEES_PROFIL.find((d) => d.donnee === donnee)?.base).toBe("Exécution du contrat");
    }
  });

  it("réserve le consentement à ce que le joueur choisit en plus", () => {
    for (const entry of DONNEES_PROFIL) {
      expect(["Exécution du contrat", "Consentement"]).toContain(entry.base);
    }
    // Données facultatives, renseignées et publiées au choix du joueur : un
    // compte fonctionne sans elles, le contrat ne les exige pas.
    for (const donnee of [
      "Certification du pseudo Discord",
      "Pseudo Overwatch",
      "Pseudo Marvel Rivals",
      "Avatar",
    ]) {
      expect(DONNEES_PROFIL.find((d) => d.donnee === donnee)?.base).toBe("Consentement");
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
  it("liste les huit droits : art. 15 à 21, retrait du consentement, directives post-mortem", () => {
    expect(DROITS).toHaveLength(8);
  });

  it("couvre le droit à la limitation (art. 18)", () => {
    const limitation = DROITS.find((d) => d.title.toLowerCase().includes("limitation"));
    expect(limitation?.text).toMatch(/art\. 18/);
  });

  it("couvre les directives après le décès (art. 85 loi Informatique et Libertés)", () => {
    const directives = DROITS.find((d) => /décès/.test(d.title));
    expect(directives?.text).toMatch(/art\. 85 de la loi Informatique et Libertés/);
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

describe("DONNEE_SAUVEGARDES", () => {
  it("annonce la durée réelle des sauvegardes, pas « quelques jours »", () => {
    expect(DONNEE_SAUVEGARDES.duree).toBe(`${BACKUP_RETENTION_DAYS} jours au plus`);
    expect(BACKUP_RETENTION_DAYS).toBe(30);
  });

  it("nomme le détenteur réel de la clé, pas « seule l'association »", () => {
    expect(DONNEE_SAUVEGARDES.finalite).not.toMatch(/seule l'association/);
    expect(DONNEE_SAUVEGARDES.finalite).toMatch(/responsable technique/);
  });

  it("nomme l'hébergeur et le chiffrement", () => {
    expect(DONNEE_SAUVEGARDES.finalite).toMatch(/Microsoft/);
    expect(DONNEE_SAUVEGARDES.finalite).toMatch(/chiffrées/i);
  });
});
