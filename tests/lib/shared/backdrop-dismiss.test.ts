import { describe, expect, it } from "@jest/globals";
import { isBackdropDismiss } from "@/lib/shared/backdrop-dismiss";

// Des objets suffisent : la règle ne compare que des identités de cibles.
const backdrop = { name: "voile" } as unknown as EventTarget;
const field = { name: "champ" } as unknown as EventTarget;
const panel = { name: "panneau" } as unknown as EventTarget;

describe("isBackdropDismiss", () => {
  it("ferme sur un appui et un relâchement sur le voile", () => {
    expect(isBackdropDismiss(backdrop, backdrop, backdrop)).toBe(true);
  });

  it("ne ferme pas une sélection de texte commencée dans un champ et relâchée sur le voile", () => {
    // Le `click` part vers l'ancêtre commun, donc vers le voile.
    expect(isBackdropDismiss(field, backdrop, backdrop)).toBe(false);
  });

  it("ne ferme pas un appui sur le voile relâché dans le panneau", () => {
    expect(isBackdropDismiss(backdrop, panel, backdrop)).toBe(false);
  });

  it("ne ferme pas un clic dans le panneau", () => {
    expect(isBackdropDismiss(panel, panel, backdrop)).toBe(false);
  });

  it("ne ferme pas sans appui connu (clic synthétique, appui hors du voile)", () => {
    expect(isBackdropDismiss(null, backdrop, backdrop)).toBe(false);
  });

  it("ne ferme jamais sans voile", () => {
    expect(isBackdropDismiss(null, null, null)).toBe(false);
  });
});
