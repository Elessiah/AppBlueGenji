import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GET } from "@/app/rgpd/registre.csv/route";
import { LEGAL_CONTACT_DISCORD } from "@/lib/shared/legal-contact";
import { registerExportFilename } from "@/lib/shared/processing-register";

describe("GET /rgpd/registre.csv", () => {
  it("rend un CSV téléchargeable, nommé et daté", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${registerExportFilename()}"`,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    // BOM UTF-8 : sans lui, Excel lit les accents de travers.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("porte le contact Discord du responsable, et aucune adresse électronique", async () => {
    const text = await GET().text();
    expect(text).toContain(LEGAL_CONTACT_DISCORD);
    expect(text).not.toMatch(/[^\s@;"]+@[^\s@;"]+\.[a-z]{2,}/i);
  });

  it("ne lit plus l'environnement : aucune variable ne peut y remettre une adresse", () => {
    const source = readFileSync(join(__dirname, "..", "..", "app", "rgpd", "registre.csv", "route.ts"), "utf8");
    expect(source).not.toContain("process.env");
  });
});

describe("/rgpd — accès au registre", () => {
  const page = readFileSync(join(__dirname, "..", "..", "app", "rgpd", "page.tsx"), "utf8");

  it("propose le téléchargement et la consultation", () => {
    expect(page).toContain('href="/rgpd/registre.csv"');
    expect(page).toContain('href="/rgpd/registre"');
  });
});
