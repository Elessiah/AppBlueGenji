import { afterEach, describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GET } from "@/app/rgpd/registre.csv/route";
import { RGPD_CONTACT_EMAIL_FALLBACK } from "@/lib/shared/rgpd-policy";
import { registerExportFilename } from "@/lib/shared/processing-register";

const saved = process.env.RGPD_CONTACT_EMAIL;
afterEach(() => {
  if (saved === undefined) delete process.env.RGPD_CONTACT_EMAIL;
  else process.env.RGPD_CONTACT_EMAIL = saved;
});

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

  it("porte le contact RGPD configuré sur le serveur", async () => {
    process.env.RGPD_CONTACT_EMAIL = "contact@exemple.invalid";
    expect(await GET().text()).toContain("contact@exemple.invalid");
  });

  it("retombe sur le contact par défaut", async () => {
    delete process.env.RGPD_CONTACT_EMAIL;
    expect(await GET().text()).toContain(RGPD_CONTACT_EMAIL_FALLBACK);
  });

  it("est rendu à la demande, pas figé à la compilation", () => {
    const source = readFileSync(join(__dirname, "..", "..", "app", "rgpd", "registre.csv", "route.ts"), "utf8");
    expect(source).toContain('export const dynamic = "force-dynamic"');
  });
});

describe("/rgpd — accès au registre", () => {
  const page = readFileSync(join(__dirname, "..", "..", "app", "rgpd", "page.tsx"), "utf8");

  it("propose le téléchargement et la consultation", () => {
    expect(page).toContain('href="/rgpd/registre.csv"');
    expect(page).toContain('href="/rgpd/registre"');
  });
});
