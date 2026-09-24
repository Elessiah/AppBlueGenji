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

  // Dans les deux cas suivants, le `click` part vers l'ancêtre commun — le
  // voile — : seules les cibles de l'appui et du relâchement les distinguent.
  it("ne ferme pas une sélection de texte commencée dans un champ et relâchée sur le voile", () => {
    expect(isBackdropDismiss(field, backdrop, backdrop)).toBe(false);
  });

  it("ne ferme pas un appui sur le voile relâché dans le panneau", () => {
    expect(isBackdropDismiss(backdrop, field, backdrop)).toBe(false);
  });

  it("ne ferme pas un clic dans le panneau", () => {
    expect(isBackdropDismiss(panel, panel, backdrop)).toBe(false);
  });

  it("ne ferme pas sans appui ou relâchement connu (clic synthétique)", () => {
    expect(isBackdropDismiss(null, backdrop, backdrop)).toBe(false);
    expect(isBackdropDismiss(backdrop, null, backdrop)).toBe(false);
  });

  it("ne ferme jamais sans voile", () => {
    expect(isBackdropDismiss(null, null, null)).toBe(false);
  });
});
