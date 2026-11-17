import { afterEach, describe, expect, it, jest } from "@jest/globals";

import {
  anotherModalOpen,
  escapeBelongsElsewhere,
  focusTrail,
  focusTrapTarget,
  handOffRestoreTargets,
  restoreFocusTarget,
  watchModals,
  watchModalsClosed,
  watchUrgentModalOpened,
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

  it("laisse Échap à un « i » déplié qui contient la cible, pas à un « i » replié", () => {
    const inside = (owner: boolean) => ({ closest: (selector: string) => (owner && selector === "[data-escape-owner]" ? {} : null) });
    expect(escapeBelongsElsewhere([], inside(true))).toBe(true);
    expect(escapeBelongsElsewhere([], inside(false))).toBe(false);
  });

  it("laisse Échap à un « i » déplié n'importe où dans la modale, focus parti sur un champ", () => {
    const container = (owner: boolean) => ({ querySelector: (selector: string) => (owner && selector === "[data-escape-owner]" ? {} : null) });
    expect(escapeBelongsElsewhere([], target({}), container(true))).toBe(true);
    expect(escapeBelongsElsewhere([], target({}), container(false))).toBe(false);
    expect(escapeBelongsElsewhere([], target({}), null)).toBe(false);
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

  it("focus sur le conteneur (ouverture, clic sur le texte) : un bord, Maj+Tab ne sort pas de la modale", () => {
    const container = { ...base, active: "modal", onContainer: true };
    expect(focusTrapTarget(container)).toBe("a");
    expect(focusTrapTarget({ ...container, shiftKey: true })).toBe("c");
    expect(focusTrapTarget({ ...container, extra: ["x", "y"], shiftKey: true })).toBe("y");
    // Sans le drapeau, un élément du milieu garde l'ordre natif.
    expect(focusTrapTarget({ ...base, active: "b", onContainer: false, shiftKey: true })).toBeNull();
  });

  it("ramène dans la modale un focus parti ailleurs", () => {
    const outside = { ...base, active: "z", inModal: false };
    expect(focusTrapTarget(outside)).toBe("a");
    expect(focusTrapTarget({ ...outside, shiftKey: true })).toBe("c");
  });
});

/**
 * Racine simulée : des modales ouvertes, chacune cédant ou non sa place
 * (`data-modal-yields`) ; la recherche « sans celles qui cèdent » se lit au
 * `:not(...)` du sélecteur.
 */
function rootWith(...yields: boolean[]) {
  const seen: string[] = [];
  const root = {
    seen,
    querySelector: (selector: string) => {
      seen.push(selector);
      const candidates = selector.includes(":not([data-modal-yields])") ? yields.filter((y) => !y) : yields;
      return candidates.length > 0 ? {} : null;
    },
  };
  return root as typeof root & Pick<ParentNode, "querySelector">;
}

describe("anotherModalOpen", () => {
  it("lit une modale `aria-modal` ou en chargement", () => {
    expect(anotherModalOpen(rootWith(false))).toBe(true);
    expect(anotherModalOpen(rootWith())).toBe(false);
  });

  it("cherche aussi la place d'une modale en chargement", () => {
    const root = rootWith();
    anotherModalOpen(root);
    expect(root.seen[0]).toContain("[data-modal-pending]");
  });

  it("une ouverture urgente passe une modale qui cède sa place, pas les autres", () => {
    expect(anotherModalOpen(rootWith(true), { overYielding: true })).toBe(false);
    expect(anotherModalOpen(rootWith(true, false), { overYielding: true })).toBe(true);
    // Sans l'option, toute modale retient.
    expect(anotherModalOpen(rootWith(true))).toBe(true);
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
    let callback: ((records: unknown[]) => void) | null = null;
    globals.document = { querySelector: () => (state.modal ? {} : null) };
    globals.MutationObserver = class {
      constructor(cb: (records: unknown[]) => void) {
        callback = cb;
      }
      observe(_root: unknown, options: unknown) {
        state.observed = options;
      }
      disconnect() {
        state.disconnected += 1;
      }
    };
    return { state, mutate: (records: unknown[] = []) => callback?.(records) };
  }

  it("prévient une fois la dernière modale fermée, relectures espacées, puis se débranche", () => {
    jest.useFakeTimers();
    const { state, mutate } = fakeDom();
    const calls: number[] = [];
    watchModalsClosed(() => calls.push(1));
    expect(state.observed).toEqual(expect.objectContaining({ childList: true, subtree: true }));
    mutate();
    jest.advanceTimersByTime(1_100);
    expect(calls).toHaveLength(0);
    state.modal = false;
    mutate();
    mutate();
    expect(calls).toHaveLength(0);
    jest.advanceTimersByTime(1_100);
    expect(calls).toHaveLength(1);
    expect(state.disconnected).toBe(1);
  });

  it("watchUrgentModalOpened : réagit sans délai à un élément ajouté, ignore les textes", () => {
    const { state, mutate } = fakeDom(false);
    const calls: number[] = [];
    watchUrgentModalOpened(() => calls.push(1), globals.document as Node & ParentNode);
    const text = { nodeType: 3 };
    const element = { nodeType: 1 };
    // Un texte du plateau mis à jour : la page n'est pas relue.
    state.modal = true;
    mutate([{ type: "childList", addedNodes: [text] }]);
    expect(calls).toHaveLength(0);
    mutate([{ type: "childList", addedNodes: [element] }]);
    expect(calls).toHaveLength(1);
    expect(state.disconnected).toBe(1);
  });

  it("watchUrgentModalOpened : une urgente déjà ouverte prévient aussitôt", () => {
    const { state } = fakeDom(true);
    const calls: number[] = [];
    watchUrgentModalOpened(() => calls.push(1), globals.document as Node & ParentNode);
    expect(calls).toHaveLength(1);
    expect(state.observed).toBeNull();
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
    const stop = watchModals(() => !state.modal, () => calls.push(1), {} as Node);
    state.modal = false;
    mutate();
    stop();
    jest.advanceTimersByTime(1_100);
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

/** Élément factice : liens de parenté et présence dans la page posés à la main. */
interface FakeNode {
  name: string;
  parentElement: FakeNode | null;
  nextElementSibling: FakeNode | null;
  previousElementSibling: FakeNode | null;
  connected: boolean;
  /** Enfants d'aujourd'hui (une liste rafraîchie les remplace). */
  children: FakeNode[];
  /** Premier focalisable de ce nœud, lui compris. */
  focusable: FakeNode | null;
}

function fakeNode(name: string, parent: FakeNode | null = null): FakeNode {
  const node: FakeNode = {
    name,
    parentElement: parent,
    nextElementSibling: null,
    previousElementSibling: null,
    connected: true,
    children: [],
    focusable: null,
  };
  parent?.children.push(node);
  return node;
}

/** `root > section > [header > add] + ul > [li1 > b1, li2 > b2, li3 > b3]`. */
function listPage() {
  const root = fakeNode("root");
  const section = fakeNode("section", root);
  const header = fakeNode("header", section);
  const add = fakeNode("add", header);
  const ul = fakeNode("ul", section);
  header.nextElementSibling = ul;
  ul.previousElementSibling = header;
  const rows = [1, 2, 3].map((n) => {
    const li = fakeNode(`li${n}`, ul);
    const button = fakeNode(`b${n}`, li);
    li.focusable = button;
    return { li, button };
  });
  rows[0].li.nextElementSibling = rows[1].li;
  rows[1].li.previousElementSibling = rows[0].li;
  rows[1].li.nextElementSibling = rows[2].li;
  rows[2].li.previousElementSibling = rows[1].li;
  header.focusable = add;
  section.focusable = add;
  return { root, section, header, add, ul, rows };
}

/** Retire une ligne de la page, avec son bouton. */
function removeRow(row: { li: FakeNode; button: FakeNode }) {
  row.li.connected = false;
  row.button.connected = false;
}

const isConnected = (n: FakeNode) => n.connected;
const firstFocusable = (n: FakeNode) => n.focusable;

describe("focusTrail", () => {
  it("focusTrail_nullTarget_returnsEmpty", () => {
    expect(focusTrail<FakeNode>(null)).toEqual([]);
  });

  it("focusTrail_nestedTarget_recordsEachAncestorWithSiblings", () => {
    const { root, section, header, ul, rows } = listPage();

    const trail = focusTrail(rows[1].button);

    expect(trail).toEqual([
      { parent: rows[1].li, next: null, previous: null, index: 0 },
      { parent: ul, next: rows[2].li, previous: rows[0].li, index: 1 },
      { parent: section, next: null, previous: header, index: 1 },
      { parent: root, next: null, previous: null, index: 0 },
    ]);
  });
});

describe("focusTrail — bornes du relevé", () => {
  it("focusTrail_boundary_stopsAfterBoundaryParent", () => {
    const { section, rows, ul } = listPage();

    const trail = focusTrail(rows[1].button, (node) => node === section);

    expect(trail.map((step) => step.parent)).toEqual([rows[1].li, ul, section]);
  });

  it("focusTrail_noBoundary_capsTheClimbOnDeepPages", () => {
    let node = fakeNode("n0");
    for (let depth = 1; depth <= 40; depth += 1) node = fakeNode(`n${depth}`, node);
    expect(focusTrail(node)).toHaveLength(16);
  });
});

describe("restoreFocusTarget — déclencheur retiré (suppression confirmée)", () => {
  it("restoreFocusTarget_nullTarget_returnsNull", () => {
    expect(restoreFocusTarget<FakeNode>(null, [], isConnected, firstFocusable)).toBeNull();
  });

  it("restoreFocusTarget_connectedTarget_returnsTarget", () => {
    const { rows } = listPage();
    const trail = focusTrail(rows[1].button);

    expect(restoreFocusTarget(rows[1].button, trail, isConnected, firstFocusable)).toBe(rows[1].button);
  });

  it("restoreFocusTarget_removedRow_returnsNextRowFocusable", () => {
    const { rows } = listPage();
    const trail = focusTrail(rows[1].button);
    removeRow(rows[1]);

    expect(restoreFocusTarget(rows[1].button, trail, isConnected, firstFocusable)).toBe(rows[2].button);
  });

  it("restoreFocusTarget_removedLastRow_returnsPreviousRowFocusable", () => {
    const { rows } = listPage();
    const trail = focusTrail(rows[2].button);
    removeRow(rows[2]);

    expect(restoreFocusTarget(rows[2].button, trail, isConnected, firstFocusable)).toBe(rows[1].button);
  });

  it("restoreFocusTarget_nextWithoutFocusable_fallsBackToPrevious", () => {
    const { rows } = listPage();
    const trail = focusTrail(rows[1].button);
    removeRow(rows[1]);
    rows[2].li.focusable = null;

    expect(restoreFocusTarget(rows[1].button, trail, isConnected, firstFocusable)).toBe(rows[0].button);
  });

  it("restoreFocusTarget_siblingsRemoved_fallsBackToListFocusable", () => {
    const { ul, rows } = listPage();
    const trail = focusTrail(rows[1].button);
    removeRow(rows[0]);
    removeRow(rows[1]);
    removeRow(rows[2]);
    const replacement = fakeNode("fallback-row", ul);
    ul.focusable = replacement;

    expect(restoreFocusTarget(rows[1].button, trail, isConnected, firstFocusable)).toBe(replacement);
  });

  it("restoreFocusTarget_listRefreshedWhileOpen_usesTodaysRowAtTheSameRank", () => {
    const { ul, rows } = listPage();
    const trail = focusTrail(rows[1].button);
    // La liste est rendue de nouveau : les trois lignes relevées sont remplacées, la deuxième a disparu.
    for (const row of rows) removeRow(row);
    ul.children = [];
    const fresh = [1, 3].map((n) => {
      const li = fakeNode(`new-li${n}`, ul);
      li.focusable = fakeNode(`new-b${n}`, li);
      return li;
    });

    expect(restoreFocusTarget(rows[1].button, trail, isConnected, firstFocusable)).toBe(fresh[1].focusable);
  });

  it("restoreFocusTarget_refreshedLastRow_usesPreviousRowAtRankMinusOne", () => {
    const { ul, rows } = listPage();
    const trail = focusTrail(rows[2].button);
    for (const row of rows) removeRow(row);
    ul.children = [];
    const fresh = [1, 2].map((n) => {
      const li = fakeNode(`new-li${n}`, ul);
      li.focusable = fakeNode(`new-b${n}`, li);
      return li;
    });

    expect(restoreFocusTarget(rows[2].button, trail, isConnected, firstFocusable)).toBe(fresh[1].focusable);
  });

  it("restoreFocusTarget_emptiedList_climbsToAddButton", () => {
    const { add, rows } = listPage();
    const trail = focusTrail(rows[0].button);
    removeRow(rows[0]);
    removeRow(rows[1]);
    removeRow(rows[2]);

    expect(restoreFocusTarget(rows[0].button, trail, isConnected, firstFocusable)).toBe(add);
  });

  it("restoreFocusTarget_disconnectedParent_skipsStep", () => {
    const { add, ul, rows } = listPage();
    const trail = focusTrail(rows[1].button);
    removeRow(rows[1]);
    ul.connected = false;

    expect(restoreFocusTarget(rows[1].button, trail, isConnected, firstFocusable)).toBe(add);
  });

  it("restoreFocusTarget_nothingFocusable_returnsNull", () => {
    const { section, header, rows } = listPage();
    const trail = focusTrail(rows[0].button);
    removeRow(rows[0]);
    removeRow(rows[1]);
    removeRow(rows[2]);
    header.focusable = null;
    section.focusable = null;

    expect(restoreFocusTarget(rows[0].button, trail, isConnected, firstFocusable)).toBeNull();
  });
});
