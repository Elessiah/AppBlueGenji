import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Modales de gestion de la vitrine (chiffres et piliers de la section 03,
 * partenaires).
 *
 * Le harnais tourne en environnement `node` : un composant React n'y est pas
 * montable, les invariants se gardent donc sur la **source**. Le défaut a été
 * constaté dans un navigateur : rendue dans `<section id="assoc">`, dont la
 * racine crée un contexte d'empilement, la modale « Ajouter une carte »
 * passait sous la section des partenaires selon le défilement, et la page
 * défilait sous le voile.
 */

const LANDING = join(__dirname, "..", "..", "components", "cyber", "landing");
const read = (file: string) => readFileSync(join(LANDING, file), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

describe("LandingDialog", () => {
  const src = stripComments(read("LandingDialog.tsx"));

  it("est portée dans document.body", () => {
    expect(src).toMatch(/createPortal\([\s\S]*document\.body\s*,?\s*\)/);
  });

  it("confie focus, Échap, tabulation et verrou de défilement à useDialogBehavior", () => {
    expect(src).toMatch(/useDialogBehavior\(\{[^}]*open: true/);
    expect(src).toMatch(/useDialogBehavior\(\{[^}]*locked: busy/);
    expect(src).toContain("ref={dialogRef}");
  });

  it("ne ferme le voile que sur un appui commencé et relâché sur lui, et jamais pendant un envoi", () => {
    expect(src).toContain("onPointerDown");
    expect(src).toContain("onPointerUp");
    expect(src).toContain("isBackdropDismiss(");
    expect(src).toMatch(/dismiss && !busy/);
  });

  it("reste une modale annoncée comme telle", () => {
    expect(src).toContain('role="dialog"');
    expect(src).toContain('aria-modal="true"');
  });
});

describe.each(["AboutStats.tsx", "AboutPillars.tsx", "SponsorsGrid.tsx"])("%s", (file) => {
  const src = stripComments(read(file));

  it("passe par LandingDialog", () => {
    expect(src).toContain("<LandingDialog");
  });

  it("ne recopie pas son propre cadre de modale", () => {
    expect(src).not.toContain("createPortal");
    expect(src).not.toContain('role="dialog"');
    expect(src).not.toContain("modalOverlay");
    // Ni écouteur Échap ni verrou de défilement maison : la pile partagée de
    // `useDialogBehavior` les tient, un `overflow` sauvegardé à la main serait
    // levé sous la modale par la fermeture d'une autre.
    expect(src).not.toMatch(/addEventListener\(\s*["']keydown["']/);
    expect(src).not.toContain("document.body.style.overflow");
  });
});
