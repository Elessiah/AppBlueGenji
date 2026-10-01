import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La section « Destinataires et transferts » de `/rgpd` doit nommer le
 * mécanisme de chaque destinataire (par `transferBasis`, partagé avec le
 * registre), situer les sauvegardes là où leur contrat les place (Hetzner, en
 * Allemagne, sans transfert) et dire la retransmission des matchs.
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
    expect(section).toContain("SPICEWORKS_SCC_FALLBACK");
    expect(section).toContain("SPICEWORKS_PROCESSOR_FRAMEWORK");
    expect(section).not.toMatch(/en cours de vérification/);
  });

  it("place les sauvegardes chez Hetzner, en Allemagne, sans transfert ni Microsoft", () => {
    expect(section).toContain("HETZNER_BACKUP_FRAMEWORK");
    expect(section).toMatch(/aucun transfert hors de l&apos;Union/);
    expect(section).not.toMatch(/OneDrive/);
    expect(section).not.toContain('transferBasis(["MICROSOFT"])');
  });

  it("garde Microsoft pour la seule messagerie de la personne à contacter", () => {
    expect(section).toMatch(/<strong>Microsoft<\/strong> \(Outlook\.com\)/);
    expect(section.match(/<strong>Microsoft<\/strong>/g)).toHaveLength(1);
  });

  it("place la garantie dans le chiffrement avant envoi, clés chez le seul hébergeur", () => {
    expect(section).toMatch(/chiffrés sur le Raspberry Pi avant tout envoi/);
    expect(section).toMatch(/jamais\s+transmises à Hetzner/);
    expect(section).toContain("{DATA_CONTACT_NAME}");
  });

  it("informe de la retransmission et du droit d'opposition, sans transfert par le site", () => {
    const retransmission = section.slice(section.indexOf('id="retransmission"'));
    expect(section).toContain('id="retransmission"');
    expect(retransmission).toMatch(/jamais de webcam ni le chat vocal/);
    expect(retransmission).toMatch(/nom neutre/);
    expect(retransmission).toMatch(/catégorie RGPD/);
    expect(section).toMatch(/Le\s+site ne leur transmet rien/);
  });
});
