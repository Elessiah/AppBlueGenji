import { afterEach, describe, expect, it, jest } from "@jest/globals";

import {
  anotherModalOpen,
  escapeBelongsElsewhere,
  focusTrapTarget,
  handOffRestoreTargets,
  watchModals,
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

/** Élément de modale simulé : `yields` = elle cède sa place (`data-modal-yields` sur sa racine). */
function modal(yields = false) {
  return { hasAttribute: (name: string) => yields && name === "data-modal-yields" };
}
const rootWith = (...modals: unknown[]) =>
  ({ querySelectorAll: () => modals }) as unknown as Pick<ParentNode, "querySelectorAll">;

describe("anotherModalOpen", () => {
  it("lit une modale `aria-modal` ou en chargement", () => {
    expect(anotherModalOpen(rootWith(modal()))).toBe(true);
    expect(anotherModalOpen(rootWith())).toBe(false);
  });

  it("cherche aussi la place d'une modale en chargement", () => {
    const seen: string[] = [];
    const root = {
      querySelectorAll: (selector: string) => {
        seen.push(selector);
        return [];
      },
    } as unknown as ParentNode;
    anotherModalOpen(root);
    expect(seen[0]).toContain("[data-modal-pending]");
  });

  it("une ouverture urgente passe une modale qui cède sa place, pas les autres", () => {
    expect(anotherModalOpen(rootWith(modal(true)), { overYielding: true })).toBe(false);
    expect(anotherModalOpen(rootWith(modal(true), modal()), { overYielding: true })).toBe(true);
    // Sans l'option, toute modale retient.
    expect(anotherModalOpen(rootWith(modal(true)))).toBe(true);
  });
});

describe("watchModals / watchModalsClosed", () => {
  const globals = globalThis as unknown as { document?: unknown; MutationObserver?: unknown };
  const saved = { document: globals.document, MutationObserver: globals.MutationObserver };

  afterEach(() => {
    globals.document = saved.document;
    globals.MutationObserver = saved.MutationObserver;
    jest.useRealTimers();
  });

  /** DOM et observateur simulés : `mutate()` joue une mutation. */
  function fakeDom(initiallyOpen = true) {
    const state = { modal: initiallyOpen, disconnected: 0, observed: null as unknown };
    let callback: (() => void) | null = null;
    globals.document = { querySelectorAll: () => (state.modal ? [modal()] : []) };
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

  it("prévient une fois la dernière modale fermée, relectures espacées, puis se débranche", () => {
    jest.useFakeTimers();
    const { state, mutate } = fakeDom();
    const calls: number[] = [];
    watchModalsClosed(() => calls.push(1));
    expect(state.observed).toEqual(expect.objectContaining({ childList: true, subtree: true }));
    mutate();
    jest.advanceTimersByTime(300);
    expect(calls).toHaveLength(0);
    state.modal = false;
    mutate();
    mutate();
    expect(calls).toHaveLength(0);
    jest.advanceTimersByTime(300);
    expect(calls).toHaveLength(1);
    expect(state.disconnected).toBe(1);
  });

  it("sans délai (`throttleMs: 0`), prévient dès le lot de mutations", () => {
    const { state, mutate } = fakeDom();
    const calls: number[] = [];
    watchModals(() => !state.modal, () => calls.push(1), { root: {} as Node, throttleMs: 0 });
    state.modal = false;
    mutate();
    expect(calls).toHaveLength(1);
    expect(state.disconnected).toBe(1);
  });

  it("prévient aussitôt si la condition tient déjà, sans observer", () => {
    const { state } = fakeDom(false);
    const calls: number[] = [];
    watchModalsClosed(() => calls.push(1));
    expect(calls).toHaveLength(1);
    expect(state.observed).toBeNull();
  });

  it("l'arrêt débranche l'observateur et annule la relecture prévue", () => {
    jest.useFakeTimers();
    const { state, mutate } = fakeDom();
    const calls: number[] = [];
    const stop = watchModals(() => !state.modal, () => calls.push(1), { root: {} as Node });
    state.modal = false;
    mutate();
    stop();
    jest.advanceTimersByTime(300);
    expect(calls).toHaveLength(0);
    expect(state.disconnected).toBe(1);
  });
});

describe("handOffRestoreTargets", () => {
  it("les modales du dessus qui visaient la modale fermée héritent de sa cible", () => {
    const launch = Symbol("launch");
    const other = Symbol("other");
    const targets = new Map<symbol, string | null>([
      [launch, "titre-invitation"],
      [other, "bouton-page"],
    ]);
    handOffRestoreTargets(targets, (element) => element === "titre-invitation", "body");
    expect(targets.get(launch)).toBe("body");
    expect(targets.get(other)).toBe("bouton-page");
  });

  it("laisse une cible absente telle quelle", () => {
    const token = Symbol("t");
    const targets = new Map<symbol, string | null>([[token, null]]);
    handOffRestoreTargets(targets, () => true, "x");
    expect(targets.get(token)).toBeNull();
  });
});
