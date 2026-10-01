import { describe, expect, it } from "@jest/globals";

import { escapeBelongsElsewhere, focusTrapTarget, type FocusTrapState } from "@/lib/shared/dialog-focus";

const layer = (expanded: boolean) => ({ querySelector: () => (expanded ? {} : null) });
const target = (attrs: Record<string, string>) => ({ getAttribute: (name: string) => attrs[name] ?? null });

describe("escapeBelongsElsewhere", () => {
  it("laisse Échap à un panneau de couche ouvert", () => {
    expect(escapeBelongsElsewhere([layer(false), layer(true)], null)).toBe(true);
  });

  it("laisse Échap à un combobox ouvert", () => {
    expect(escapeBelongsElsewhere([], target({ role: "combobox", "aria-expanded": "true" }))).toBe(true);
  });

  it("garde Échap pour la modale sur un combobox fermé ou un bouton déplié", () => {
    expect(escapeBelongsElsewhere([], target({ role: "combobox", "aria-expanded": "false" }))).toBe(false);
    expect(escapeBelongsElsewhere([], target({ "aria-expanded": "true" }))).toBe(false);
  });

  it("tolère une cible sans getAttribute (window, document)", () => {
    expect(escapeBelongsElsewhere([layer(false)], {})).toBe(false);
    expect(escapeBelongsElsewhere([], undefined)).toBe(false);
  });
});

describe("focusTrapTarget", () => {
  const base: FocusTrapState<string> = {
    items: ["a", "b", "c"],
    extra: [],
    active: "b",
    inModal: true,
    inLayer: false,
    shiftKey: false,
  };

  it("laisse l'ordre natif au milieu de la modale", () => {
    expect(focusTrapTarget(base)).toBeNull();
    expect(focusTrapTarget({ ...base, shiftKey: true })).toBeNull();
  });

  it("reboucle sur la modale seule", () => {
    expect(focusTrapTarget({ ...base, active: "c" })).toBe("a");
    expect(focusTrapTarget({ ...base, active: "a", shiftKey: true })).toBe("c");
  });

  it("passe par les couches exemptées aux bords de la modale", () => {
    const withExtra = { ...base, extra: ["x", "y"] };
    expect(focusTrapTarget({ ...withExtra, active: "c" })).toBe("x");
    expect(focusTrapTarget({ ...withExtra, active: "a", shiftKey: true })).toBe("y");
  });

  it("revient à la modale depuis les bords d'une couche", () => {
    const inLayer = { ...base, extra: ["x", "y"], inModal: false, inLayer: true };
    expect(focusTrapTarget({ ...inLayer, active: "y" })).toBe("a");
    expect(focusTrapTarget({ ...inLayer, active: "x", shiftKey: true })).toBe("c");
    expect(focusTrapTarget({ ...inLayer, active: "x" })).toBeNull();
  });

  it("ramène dans la modale un focus parti ailleurs", () => {
    const outside = { ...base, active: "z", inModal: false };
    expect(focusTrapTarget(outside)).toBe("a");
    expect(focusTrapTarget({ ...outside, shiftKey: true })).toBe("c");
  });
});
