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

  it("dit que les suppressions sont réappliquées à la restauration", () => {
    expect(SOURCE).toMatch(/suppressions\s+intervenues\s+depuis\s+sont\s+réappliquées/);
  });

  it("déclare la ligne « Copies de sauvegarde » du tableau", () => {
    expect(SOURCE).toContain("DONNEE_SAUVEGARDES.duree");
  });
});
