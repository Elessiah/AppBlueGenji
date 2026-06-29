import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const REGLEMENT_URL =
  "https://docs.google.com/document/d/1f3X3tbgs0U7Gwz0qSfotgW-HqMLKIb6DUKqlbz-ZCq8/preview";

const STATUTS = "/statuts.pdf";
const BULLETIN = "/bulletin_adhesion.docx";

describe("legal documents are served from public/", () => {
  it.each([STATUTS, BULLETIN])("ships %s as a non-empty file", (file) => {
    const path = join(ROOT, "public", file.replace(/^\//, ""));
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(0);
  });
});

describe("mentions-legales page wires the right documents", () => {
  const source = read("app/mentions-legales/page.tsx");

  it("links the statuts PDF", () => {
    expect(source).toContain(`href="${STATUTS}"`);
  });

  it("links the bulletin d'adhésion DOCX, not the old broken PDF", () => {
    expect(source).toContain(`href="${BULLETIN}"`);
    expect(source).not.toContain("bulletin-adhesion.pdf");
  });

  it("links the règlement Google Doc via the shared constant", () => {
    expect(source).toContain(`const REGLEMENT_URL =`);
    expect(source).toContain(REGLEMENT_URL);
    expect(source).toContain("href={REGLEMENT_URL}");
  });

  it("uses a read-only /preview règlement link, not the editable surface", () => {
    expect(REGLEMENT_URL).toContain("/preview");
    expect(source).not.toContain("/edit?usp=sharing");
  });

  it("opens document links in a new tab safely", () => {
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noreferrer"');
  });

  it("offers the DOCX as a download rather than a blank tab", () => {
    expect(source).toMatch(/href="\/bulletin_adhesion\.docx"\s+download/);
  });

  it("exposes anchors for the RGPD and cookies sections", () => {
    expect(source).toContain('id: "donnees-personnelles"');
    expect(source).toContain('id: "cookies"');
    expect(source).toContain("id={section.id}");
  });
});

describe("association page wires the right documents", () => {
  const source = read("app/association/page.tsx");

  it("links statuts, bulletin and règlement", () => {
    expect(source).toContain(`href="${STATUTS}"`);
    expect(source).toContain(`href="${BULLETIN}"`);
    expect(source).toContain(REGLEMENT_URL);
  });

  it("drops the dead placeholder links", () => {
    expect(source).not.toContain("reglement-interieur.pdf");
    expect(source).not.toContain("rapport-moral-2025.pdf");
  });
});

describe("public footer wires legal documents", () => {
  const source = read("components/cyber/landing/PublicFooter.tsx");

  it("points Mentions légales, Statuts and Règlement to real targets", () => {
    expect(source).toContain('href="/mentions-legales"');
    expect(source).toContain(`href="${STATUTS}"`);
    expect(source).toContain("href={REGLEMENT_URL}");
  });

  it("routes RGPD and Cookies to the dedicated RGPD page", () => {
    expect(source).toContain('href="/rgpd"');
    expect(source).toContain('href="/rgpd#cookies"');
  });

  it("no longer routes any legal link to a placeholder anchor", () => {
    expect(source).not.toMatch(/href="\/tournois">Règlement/);
    expect(source).not.toContain('href="#top"');
  });

  it("links Partenaires to the landing sponsors section from any page", () => {
    // Bare in-page anchors only resolve on the landing page; the footer is
    // rendered everywhere, so the link must be absolute to /#sponsors.
    expect(source).toContain('href="/#sponsors"');
    expect(source).not.toContain('href="#sponsors"');
  });
});
