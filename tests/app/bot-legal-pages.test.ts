import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HEBERGEUR_HREF,
  PRIVACY_POLICY,
  TERMS_OF_SERVICE,
  type BilingualDoc,
} from "@/lib/shared/bot-legal-content";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const DOCS: [string, BilingualDoc][] = [
  ["Terms of Service", TERMS_OF_SERVICE],
  ["Privacy Policy", PRIVACY_POLICY],
];

describe("bot legal content is fully bilingual", () => {
  it.each(DOCS)("%s exposes both fr and en variants", (_name, doc) => {
    expect(doc.fr).toBeDefined();
    expect(doc.en).toBeDefined();
  });

  it.each(DOCS)("%s keeps the same section count across languages", (_name, doc) => {
    expect(doc.fr.sections.length).toBe(doc.en.sections.length);
    expect(doc.fr.sections.length).toBeGreaterThanOrEqual(8);
  });

  it.each(DOCS)("%s keeps section numbering aligned across languages", (_name, doc) => {
    const frNums = doc.fr.sections.map((s) => s.num);
    const enNums = doc.en.sections.map((s) => s.num);
    expect(frNums).toEqual(enNums);
    // Numérotation séquentielle et zéro-paddée (01, 02, …).
    frNums.forEach((num, i) => expect(num).toBe(String(i + 1).padStart(2, "0")));
  });

  it.each(DOCS)("%s never ships an empty section or block", (_name, doc) => {
    for (const lang of [doc.fr, doc.en]) {
      expect(lang.title.trim().length).toBeGreaterThan(0);
      expect(lang.intro.trim().length).toBeGreaterThan(0);
      for (const section of lang.sections) {
        expect(section.title.trim().length).toBeGreaterThan(0);
        expect(section.blocks.length).toBeGreaterThan(0);
        for (const block of section.blocks) {
          if (block.kind === "bullets") {
            expect(block.items && block.items.length).toBeTruthy();
            block.items?.forEach((item) => expect(item.trim().length).toBeGreaterThan(0));
          } else {
            expect(block.text && block.text.trim().length).toBeTruthy();
          }
        }
      }
    }
  });
});

describe("bot legal content carries the contact details", () => {
  it.each(DOCS)("%s mentions the support email and Discord in both languages", (_name, doc) => {
    for (const lang of [doc.fr, doc.en]) {
      const flat = JSON.stringify(lang);
      expect(flat).toContain("keryan.h@outlook.fr");
      expect(flat).toContain("elessiah");
    }
  });
});

describe("hébergeur redirect points at the mentions légales section", () => {
  it("exposes the shared anchor constant", () => {
    expect(HEBERGEUR_HREF).toBe("/mentions-legales#hebergement");
  });

  it.each(DOCS)("%s carries a hosting block linking to that anchor", (_name, doc) => {
    for (const lang of [doc.fr, doc.en]) {
      expect(lang.hosting.title.trim().length).toBeGreaterThan(0);
      expect(lang.hosting.linkLabel.trim().length).toBeGreaterThan(0);
    }
  });

  it("the mentions-legales page owns the #hebergement anchor", () => {
    const source = read("app/mentions-legales/page.tsx");
    expect(source).toContain('id: "hebergement"');
    expect(source).toContain("id={section.id}");
  });
});

describe("terms of service specifics", () => {
  it("links to the Discord terms and community guidelines", () => {
    const flat = JSON.stringify(TERMS_OF_SERVICE);
    expect(flat).toContain("https://discord.com/terms");
    expect(flat).toContain("https://discord.com/guidelines");
  });

  it("cross-links to the bot privacy policy page", () => {
    const flat = JSON.stringify(TERMS_OF_SERVICE);
    expect(flat).toContain("/privacy-policy-bot");
  });
});

describe("privacy policy specifics", () => {
  it("references the Discord server for change announcements", () => {
    const flat = JSON.stringify(PRIVACY_POLICY);
    expect(flat).toContain("https://discord.gg/5kG9DDKx");
  });
});

describe("route pages wire the right documents", () => {
  it("/terms-of-service-bot renders the ToS doc", () => {
    const source = read("app/terms-of-service-bot/page.tsx");
    expect(source).toContain("TERMS_OF_SERVICE");
    expect(source).toContain("BotLegalDoc");
  });

  it("/privacy-policy-bot renders the Privacy doc", () => {
    const source = read("app/privacy-policy-bot/page.tsx");
    expect(source).toContain("PRIVACY_POLICY");
    expect(source).toContain("BotLegalDoc");
  });

  it("the shared component is a client component with a language switch", () => {
    const source = read("components/legal/BotLegalDoc.tsx");
    expect(source).toContain('"use client"');
    expect(source).toContain("useState");
    expect(source).toContain("aria-pressed");
    expect(source).toContain("HEBERGEUR_HREF");
  });
});
