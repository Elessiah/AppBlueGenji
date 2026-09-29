import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La section « Destinataires et transferts » de `/rgpd` doit nommer le
 * mécanisme de chaque destinataire (par `transferBasis`, partagé avec le
 * registre) et ne rien affirmer de la localisation des sauvegardes, que
 * Microsoft ne garantit pas pour un compte personnel.
 */
const source = readFileSync(join(process.cwd(), "app/rgpd/page.tsx"), "utf8");
const start = source.indexOf('id="destinataires"');
const section = source.slice(start, source.indexOf("</section>", start));

describe("/rgpd — destinataires et transferts", () => {
  it("trouve la section", () => {
    expect(start).toBeGreaterThan(-1);
  });

  it("nomme les mécanismes par la règle du registre, pour tous les destinataires", () => {
    expect(section).toContain("transferBasis(ALL_TRANSFER_RECIPIENTS)");
    expect(section).toContain("ONEDRIVE_BACKUP_FRAMEWORK");
  });

  it("n'affirme aucune localisation des sauvegardes ni un DPA", () => {
    expect(section).not.toMatch(/Irlande|Pays-Bas|Data Protection Addendum|\bDPA\b/);
    expect(section).not.toMatch(/stockage possible\s+aux États-Unis/);
  });

  it("place la garantie dans le chiffrement de l'association, celui de Microsoft en complément", () => {
    expect(section).toMatch(/chiffrés sur le Raspberry Pi avant tout envoi/);
    expect(section).toMatch(/jamais transmise à\s+Microsoft/);
    expect(section).toMatch(/mesures complémentaires/);
    // Le mécanisme de Microsoft vient du registre, jamais d'une phrase recopiée.
    expect(section).toContain('transferBasis(["MICROSOFT"])');
    expect(section).not.toMatch(/certification EU-U\.S\. Data Privacy Framework\s+de Microsoft/);
  });
});
