import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { siteCopyField } from "@/lib/shared/site-copy";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Lit une entrée d'une archive ZIP par son répertoire central (un `.docx` en
 * est une), sans dépendance : suffisant pour une entrée stockée ou « deflate ».
 */
function readZipEntry(zip: Buffer, name: string): string {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const entryName = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (entryName === name) {
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const data = zip.subarray(start, start + compressedSize);
      return (method === 0 ? data : inflateRawSync(data)).toString("utf8");
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`entrée ${name} absente`);
}

/** Texte brut d'un `document.xml`, balises retirées. */
function docxText(xml: string): string {
  return (xml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) ?? [])
    .map((run) => run.replace(/<[^>]+>/g, ""))
    .join("")
    .replace(/&amp;/g, "&");
}

describe("section « Adhérer » de /association", () => {
  const source = read("app/association/page.tsx");

  it("ne présente plus la création d'un compte comme une adhésion", () => {
    expect(source).not.toContain("Il suffit de créer un compte");
    expect(source).not.toContain("Gratuit, sans engagement, sans limite de durée");
    expect(source).not.toContain("Validation moyenne");
    expect(source).not.toContain("déjà adhérent");
    expect(source).not.toContain("GRATUIT · SANS ENGAGEMENT");
  });

  it("dit qu'un compte joueur ne fait pas un membre", () => {
    expect(source).toContain("il ne fait pas de toi un membre de l'association");
  });

  it("annonce les conditions statutaires : 16 ans, un an, agrément du bureau", () => {
    expect(source).toContain('["16 ans", "Âge minimum"]');
    expect(source).toContain('["1 an", "Durée de l\'adhésion"]');
    expect(source).toContain('["Bureau", "Agrément"]');
  });

  it("mène au bulletin d'adhésion, et nomme le compte joueur pour ce qu'il est", () => {
    expect(source).toMatch(/href="\/bulletin_adhesion\.docx"\s+download>\s*Télécharger le bulletin/);
    expect(source).toContain("Créer un compte joueur");
  });

  it("n'affirme plus de date de fondation dans les descriptions", () => {
    expect(source).not.toContain("fondée en 2020");
  });

  it("donne à l'accroche éditable une valeur d'origine qui parle de bulletin et d'agrément", () => {
    const entry = siteCopyField("association.membership.lede");
    expect(entry?.defaultValue).toContain("bulletin d'adhésion");
    expect(entry?.defaultValue).toContain("agrément du bureau");
    expect(entry?.defaultValue).not.toContain("accès complet à tous nos tournois");
    expect(entry?.defaultValue.length ?? 0).toBeLessThanOrEqual(entry?.maxLength ?? 0);
  });
});

describe("mention d'information du bulletin d'adhésion", () => {
  const text = docxText(
    readZipEntry(readFileSync(join(ROOT, "public", "bulletin_adhesion.docx")), "word/document.xml"),
  );

  it.each([
    "article 13 du RGPD",
    "Responsable du traitement",
    "4 impasse des Cyprès, 51210 Janvilliers",
    "bluegenji-esport.fr/mentions-legales",
    "Finalité",
    "Base légale",
    "article 6.1.b du RGPD",
    "Destinataires",
    "membres du Bureau",
    "PayPal",
    "bot Discord de l’association",
    "rappel de renouvellement",
    "Durée de conservation",
    "Vos droits",
    "bluegenji-esport.fr/rgpd",
    "CNIL",
  ])("mentionne « %s »", (fragment) => {
    expect(text).toContain(fragment);
  });

  it("n'annonce pas de droit d'opposition, inapplicable sur la base du contrat (art. 21)", () => {
    expect(text).not.toContain("opposition");
  });

  it("ne met ni courriel ni téléphone en clair", () => {
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(text).not.toMatch(/(?:\+33|0)[1-9](?:[ .]?\d{2}){4}/);
  });

  it("garde le reste du bulletin", () => {
    expect(text).toContain("Bulletin d’adhésion à l’association Bluegenji Esport");
    expect(text).toContain("Tag Discord");
    expect(text).toContain("(Signature du Président de l’association)");
  });
});
