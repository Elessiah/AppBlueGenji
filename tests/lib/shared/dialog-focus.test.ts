import { afterEach, describe, expect, it } from "@jest/globals";

import {
  anotherModalOpen,
  claimAutoOpenModal,
  escapeBelongsElsewhere,
  focusTrapTarget,
  watchModalsClosed,
  type FocusTrapState,
} from "@/lib/shared/dialog-focus";

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

  it("reboucle depuis un titre d'ouverture placé avant le premier focalisable", () => {
    const onTitle = { ...base, active: "title", beforeStart: true };
    expect(focusTrapTarget({ ...onTitle, shiftKey: true })).toBe("c");
    expect(focusTrapTarget({ ...onTitle, shiftKey: true, extra: ["x", "y"] })).toBe("y");
    // Tab avance dans l'ordre natif, vers le premier focalisable.
    expect(focusTrapTarget(onTitle)).toBeNull();
  });

  it("ramène dans la modale un focus parti ailleurs", () => {
    const outside = { ...base, active: "z", inModal: false };
    expect(focusTrapTarget(outside)).toBe("a");
    expect(focusTrapTarget({ ...outside, shiftKey: true })).toBe("c");
  });
});

const withModal = { querySelector: () => ({}) } as unknown as ParentNode;
const withoutModal = { querySelector: () => null } as unknown as ParentNode;

describe("anotherModalOpen et réservation d'une ouverture d'office", () => {
  it("lit une modale `aria-modal` du DOM", () => {
    expect(anotherModalOpen(withModal)).toBe(true);
    expect(anotherModalOpen(withoutModal)).toBe(false);
  });

  it("compte une modale réservée, pas encore montée, jusqu'à sa libération (idempotente)", () => {
    const release = claimAutoOpenModal();
    expect(anotherModalOpen(withoutModal)).toBe(true);
    const other = claimAutoOpenModal();
    release();
    release();
    expect(anotherModalOpen(withoutModal)).toBe(true);
    other();
    expect(anotherModalOpen(withoutModal)).toBe(false);
  });
});

describe("watchModalsClosed", () => {
  const globals = globalThis as unknown as { document?: unknown; MutationObserver?: unknown };
  const saved = { document: globals.document, MutationObserver: globals.MutationObserver };

  afterEach(() => {
    globals.document = saved.document;
    globals.MutationObserver = saved.MutationObserver;
  });

  /** DOM et observateur simulés : `mutate()` joue une mutation. */
  function fakeDom() {
    const state = { modal: true, disconnected: 0, observed: null as unknown };
    let callback: (() => void) | null = null;
    globals.document = { querySelector: () => (state.modal ? {} : null) };
    globals.MutationObserver = class {
      constructor(cb: () => void) {
        callback = cb;
      }
      observe(_root: unknown, options: unknown) {
        state.observed = options;
      }
      disconnect() {
        state.disconnected += 1;
      }
    };
    return { state, mutate: () => callback?.() };
  }

  it("prévient une fois la dernière modale fermée, puis se débranche", () => {
    const { state, mutate } = fakeDom();
    const calls: number[] = [];
    watchModalsClosed(() => calls.push(1), {} as Node);
    expect(state.observed).toEqual(expect.objectContaining({ childList: true, subtree: true }));
    mutate();
    expect(calls).toHaveLength(0);
    state.modal = false;
    mutate();
    expect(calls).toHaveLength(1);
    expect(state.disconnected).toBe(1);
  });

  it("l'arrêt débranche l'observateur", () => {
    const { state } = fakeDom();
    const stop = watchModalsClosed(() => undefined, {} as Node);
    stop();
    expect(state.disconnected).toBe(1);
  });
});
