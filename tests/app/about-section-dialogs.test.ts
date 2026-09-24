import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Modales « Ajouter une carte » de la section 03 (chiffres et piliers).
 *
 * Le harnais tourne en environnement `node` : un composant React n'y est pas
 * montable, les invariants se gardent donc sur la **source**. Le défaut a été
 * constaté dans un navigateur : rendue dans `<section id="assoc">`, dont la
 * racine pose `position: relative; z-index: 1`, la modale restait prisonnière
 * de ce contexte d'empilement — son `z-index: 1000` ne valait que dans la
 * section, et la section des partenaires, peinte après, passait par-dessus.
 * La page, elle, continuait de défiler sous le voile.
 */

const ROOT = join(__dirname, "..", "..");
const LANDING = join(ROOT, "components", "cyber", "landing");
const read = (...parts: string[]) => readFileSync(join(...parts), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

describe.each(["AboutStats.tsx", "AboutPillars.tsx"])("%s", (file) => {
  const src = stripComments(read(LANDING, file));

  it("porte sa modale dans document.body", () => {
    expect(src).toMatch(/createPortal\([\s\S]*document\.body\s*,?\s*\)/);
    // Le portail n'existe qu'une fois monté côté client.
    expect(src).toContain("open && mounted && createPortal(");
  });

  it("confie focus, Échap, tabulation et verrou de défilement à useDialogBehavior", () => {
    expect(src).toContain("useDialogBehavior({ open: open && mounted, onClose: close, locked: busy })");
    expect(src).toContain("ref={dialogRef}");
    // Plus d'écouteur clavier maison, qui ne verrouillait pas le défilement.
    expect(src).not.toMatch(/addEventListener\(\s*["']keydown["']/);
  });

  it("reste une modale annoncée comme telle", () => {
    expect(src).toContain('role="dialog"');
    expect(src).toContain('aria-modal="true"');
  });
});

describe("contexte d'empilement de la section 03", () => {
  it("existe bien — c'est lui qui impose le portail", () => {
    // Si la racine cesse un jour de créer un contexte d'empilement, le test
    // ci-dessus reste juste ; celui-ci documente pourquoi il existe.
    const css = read(LANDING, "AboutSection.module.css");
    expect(css).toMatch(/\.root\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;/);
  });
});
