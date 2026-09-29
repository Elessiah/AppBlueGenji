import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `/rgpd` ne se monte pas hors de Next (`PublicHeader`) : la promesse se
 * contrôle sur la source, comme `rgpd-jsx-spacing.test.ts`.
 */
const SOURCE = readFileSync(join(__dirname, "..", "..", "app", "rgpd", "page.tsx"), "utf8");

describe("/rgpd — sauvegardes", () => {
  it("n'annonce plus « quelques jours » pour des sauvegardes gardées un mois", () => {
    expect(SOURCE).not.toMatch(/quelques\s+jours/);
  });

  it("tire la durée de la constante partagée, jamais d'un nombre écrit à la main", () => {
    expect(SOURCE).toContain("{BACKUP_RETENTION_DAYS} jours");
  });

  it("ne promet le rejeu à la restauration que pour les suppressions de compte", () => {
    // Seul le journal des suppressions de compte est rejoué (`replay:deletions`) :
    // « les suppressions intervenues depuis », sans qualificatif, promettait aussi
    // les effacements de tag, de réglage ou de signalement.
    expect(SOURCE).toMatch(/suppressions de compte<\/strong>\s+intervenues\s+depuis\s+sont\s+réappliquées/);
    expect(SOURCE).not.toMatch(/les suppressions intervenues depuis/);
    expect(SOURCE).toMatch(/autres effacements postérieurs à\s+l'archive/);
  });

  it("ne dit plus que seule l'association détient la clé des sauvegardes", () => {
    expect(SOURCE).not.toMatch(/seule l&apos;association détient/);
    expect(SOURCE).toMatch(/responsable technique de l&apos;association — qui est\s+aussi l&apos;hébergeur du site/);
  });

  it("déclare la ligne « Copies de sauvegarde » du tableau", () => {
    expect(SOURCE).toContain("DONNEE_SAUVEGARDES.duree");
  });
});
