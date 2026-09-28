import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Texte affiché de la page : sans les commentaires ni les imports. */
function visibleSource(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/&apos;/g, "'");
}

describe("page /accessibilite — vouvoiement", () => {
  it.each<[string]>([
    ["app/accessibilite/page.tsx"],
    ["lib/shared/accessibility-statement.ts"],
    ["lib/shared/accessibility-settings.ts"],
    ["components/accessibility/AccessibilityMenu.tsx"],
  ])("%s ne tutoie pas le lecteur", (path) => {
    // Bornes écrites à la main : `\b` ne connaît que l'ASCII, et « Arrête »
    // y contiendrait un « te » isolé.
    expect(visibleSource(path)).not.toMatch(/(?<!\p{L})(?:(?:tu|ton|ta|tes|toi|te)(?!\p{L})|t')/iu);
  });

  it("met les moyens de contact directement sous une limite contournée par une demande", () => {
    const page = read("app/accessibilite/page.tsx");
    expect(page).toContain("issue.requestByContact ? <ContactList />");
  });
});
