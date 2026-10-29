import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ClientPowerInput } from "@/lib/shared/client-power";
import { powerPolicy } from "@/lib/shared/client-power";

const FULL_INPUT: ClientPowerInput = {
  attention: "FOCUSED",
  matchFocus: false,
  reducedMotion: false,
  motionSetting: false,
  performanceLimited: false,
};
const ECO_INPUT: ClientPowerInput = { ...FULL_INPUT, reducedMotion: true };
let powerInput: ClientPowerInput = FULL_INPUT;
jest.mock("@/lib/shared/hooks/useClientPower", () => ({ getClientPowerInput: () => powerInput }));

import {
  FOCUS_WATCH_MS,
  FOCUS_WATCH_RELAXED_MS,
  focusRowAfterChange,
} from "@/app/(secured)/tournois/[id]/_components/ForfeitRowAction";

/**
 * Focus après un abandon ou son annulation : le nouvel état peut s'afficher
 * plusieurs trames après la fin de `refresh()` (rendu groupé du flux). La
 * veille rend le focus au geste de la ligne, ou à la ligne, chaque fois qu'il
 * tombe sur `<body>`, et s'arrête dès que le lecteur va ailleurs ou agit
 * (`pointerdown`, `keydown`). Une ligne n'est focalisable par script qu'au
 * moment de la reprise du focus.
 */
type Listener = () => void;
type FakeElement = {
  name: string;
  isConnected: boolean;
  tabIndex: number;
  attributes: Map<string, string>;
  listeners: Map<string, Listener>;
  focus: () => void;
  blur: () => void;
  contains: (other: unknown) => boolean;
  hasAttribute: (name: string) => boolean;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  addEventListener: (type: string, listener: Listener) => void;
};

const globals = globalThis as { document?: unknown; requestAnimationFrame?: unknown; setTimeout?: unknown };
const saved = { document: globals.document, requestAnimationFrame: globals.requestAnimationFrame, setTimeout: globals.setTimeout };

let frames: (() => void)[] = [];
let timers: { callback: () => void; delay: number }[] = [];
let clock = 0;
const body = { name: "body" };
const documentListeners = new Map<string, Set<unknown>>();
const doc = {
  body,
  activeElement: body as unknown,
  nodes: {} as Record<string, FakeElement | null>,
  querySelector(selector: string) {
    return this.nodes[selector] ?? null;
  },
  addEventListener(type: string, listener: unknown) {
    documentListeners.set(type, (documentListeners.get(type) ?? new Set()).add(listener));
  },
  removeEventListener(type: string, listener: unknown) {
    documentListeners.get(type)?.delete(listener);
  },
};

/** Le lecteur agit : les écouteurs du document reçoivent l'évènement. */
function readerActs(type: "pointerdown" | "keydown") {
  for (const listener of [...(documentListeners.get(type) ?? [])]) (listener as Listener)();
}

function element(name: string, children: FakeElement[] = [], tabIndex = 0): FakeElement {
  const el: FakeElement = {
    name,
    isConnected: true,
    tabIndex,
    attributes: new Map(),
    listeners: new Map(),
    focus: () => {
      doc.activeElement = el;
    },
    blur: () => {
      doc.activeElement = body;
      el.listeners.get("blur")?.();
    },
    contains: (other) => other === el || children.includes(other as FakeElement),
    hasAttribute: (attribute) => el.attributes.has(attribute),
    setAttribute: (attribute, value) => {
      el.attributes.set(attribute, value);
      if (attribute === "tabindex") el.tabIndex = Number(value);
    },
    removeAttribute: (attribute) => {
      el.attributes.delete(attribute);
      if (attribute === "tabindex") el.tabIndex = -1;
    },
    addEventListener: (type, listener) => {
      el.listeners.set(type, listener);
    },
  };
  return el;
}

/** Un conteneur de ligne ou un cadenas : non focalisable de lui-même. */
const unfocusable = (name: string, children: FakeElement[] = []) => element(name, children, -1);

function runFrame(advance = 16) {
  clock += advance;
  const pending = frames;
  frames = [];
  for (const frame of pending) frame();
}

function runTimers(advance = FOCUS_WATCH_RELAXED_MS) {
  clock += advance;
  const pending = timers;
  timers = [];
  for (const timer of pending) timer.callback();
}

beforeEach(() => {
  frames = [];
  timers = [];
  clock = 0;
  powerInput = FULL_INPUT;
  documentListeners.clear();
  doc.activeElement = body;
  doc.nodes = {};
  globals.document = doc;
  globals.requestAnimationFrame = (cb: () => void) => {
    frames.push(cb);
    return frames.length;
  };
  globals.setTimeout = (callback: () => void, delay: number) => {
    timers.push({ callback, delay });
    return timers.length;
  };
});
afterEach(() => {
  globals.document = saved.document;
  globals.requestAnimationFrame = saved.requestAnimationFrame;
  globals.setTimeout = saved.setTimeout;
});

const listenerCount = () => [...documentListeners.values()].reduce((sum, set) => sum + set.size, 0);

describe("focusRowAfterChange", () => {
  it("rend le focus au geste de la ligne quand il est tombé sur <body>", () => {
    const button = element("button");
    doc.nodes['[data-row-action="7"]'] = button;
    doc.nodes['[data-row-focus="7"]'] = unfocusable("row", [button]);
    focusRowAfterChange(7, () => clock);
    runFrame();
    expect(doc.activeElement).toBe(button);
  });

  it("à défaut de geste, rend le focus à la ligne", () => {
    const row = unfocusable("row");
    doc.nodes['[data-row-focus="7"]'] = row;
    focusRowAfterChange(7, () => clock);
    runFrame();
    expect(doc.activeElement).toBe(row);
  });

  it("rattrape un rendu tardif : la ligne déplacée après coup reprend le focus", () => {
    const oldButton = element("old");
    const row = unfocusable("row", [oldButton]);
    doc.nodes['[data-row-action="7"]'] = oldButton;
    doc.nodes['[data-row-focus="7"]'] = row;
    doc.activeElement = oldButton;
    focusRowAfterChange(7, () => clock);
    runFrame();
    expect(doc.activeElement).toBe(oldButton);
    // Le rendu groupé arrive plus tard : la ligne change de place, le focus tombe.
    runFrame(500);
    const newButton = element("new");
    doc.nodes['[data-row-action="7"]'] = newButton;
    doc.nodes['[data-row-focus="7"]'] = unfocusable("row", [newButton]);
    doc.activeElement = body;
    runFrame();
    expect(doc.activeElement).toBe(newButton);
  });

  it("s'arrête dès que le lecteur porte le focus hors de la ligne", () => {
    const button = element("button");
    doc.nodes['[data-row-action="7"]'] = button;
    doc.nodes['[data-row-focus="7"]'] = unfocusable("row", [button]);
    doc.activeElement = element("elsewhere");
    focusRowAfterChange(7, () => clock);
    runFrame();
    expect(frames).toHaveLength(0);
    expect(listenerCount()).toBe(0);
  });

  it("veille au plus FOCUS_WATCH_MS, sans boucle de fond, et retire ses écouteurs", () => {
    const button = element("button");
    doc.nodes['[data-row-action="7"]'] = button;
    doc.nodes['[data-row-focus="7"]'] = unfocusable("row", [button]);
    focusRowAfterChange(7, () => clock);
    runFrame(FOCUS_WATCH_MS + 1);
    expect(frames).toHaveLength(0);
    expect(listenerCount()).toBe(0);
    doc.activeElement = body;
    runFrame();
    expect(doc.activeElement).toBe(body);
  });

  it("ne fait rien côté serveur", () => {
    globals.document = undefined;
    expect(() => focusRowAfterChange(7)).not.toThrow();
  });
});

describe("focusRowAfterChange — le lecteur agit", () => {
  it.each(["pointerdown", "keydown"] as const)("un %s arrête la veille : le focus tombé sur <body> n'est pas repris", (type) => {
    const row = unfocusable("row");
    doc.nodes['[data-row-focus="7"]'] = row;
    focusRowAfterChange(7, () => clock);
    readerActs(type);
    runFrame();
    expect(doc.activeElement).toBe(body);
    expect(frames).toHaveLength(0);
    expect(listenerCount()).toBe(0);
  });

  it("avant tout geste du lecteur, le focus est bien repris", () => {
    const row = unfocusable("row");
    doc.nodes['[data-row-focus="7"]'] = row;
    focusRowAfterChange(7, () => clock);
    expect(listenerCount()).toBe(2);
    runFrame();
    expect(doc.activeElement).toBe(row);
  });
});

describe("focusRowAfterChange — focalisable seulement à la reprise", () => {
  it("pose tabindex=-1 sur la ligne au moment de lui rendre le focus, et le retire au départ du focus", () => {
    const row = unfocusable("row");
    doc.nodes['[data-row-focus="7"]'] = row;
    expect(row.hasAttribute("tabindex")).toBe(false);
    focusRowAfterChange(7, () => clock);
    runFrame();
    expect(row.attributes.get("tabindex")).toBe("-1");
    row.blur();
    expect(row.hasAttribute("tabindex")).toBe(false);
  });

  it("n'ajoute rien à un geste déjà focalisable (bouton)", () => {
    const button = element("button", [], 0);
    doc.nodes['[data-row-action="7"]'] = button;
    doc.nodes['[data-row-focus="7"]'] = unfocusable("row", [button]);
    focusRowAfterChange(7, () => clock);
    runFrame();
    expect(doc.activeElement).toBe(button);
    expect(button.hasAttribute("tabindex")).toBe(false);
  });

  it("le cadenas d'une ligne figée, non focalisable, l'est le temps de la reprise", () => {
    const lock = unfocusable("lock");
    doc.nodes['[data-row-action="7"]'] = lock;
    doc.nodes['[data-row-focus="7"]'] = unfocusable("row", [lock]);
    focusRowAfterChange(7, () => clock);
    runFrame();
    expect(doc.activeElement).toBe(lock);
    expect(lock.attributes.get("tabindex")).toBe("-1");
  });
});

describe("focusRowAfterChange — régime de charge", () => {
  it("régime FULL : une vérification par trame, aucun minuteur", () => {
    expect(powerPolicy(FULL_INPUT).mode).toBe("FULL");
    doc.nodes['[data-row-focus="7"]'] = unfocusable("row");
    focusRowAfterChange(7, () => clock);
    expect(frames).toHaveLength(1);
    expect(timers).toHaveLength(0);
  });

  it("hors FULL : vérifications espacées (minuteur), jamais à chaque trame", () => {
    powerInput = ECO_INPUT;
    expect(powerPolicy(ECO_INPUT).mode).not.toBe("FULL");
    const row = unfocusable("row");
    doc.nodes['[data-row-focus="7"]'] = row;
    focusRowAfterChange(7, () => clock);
    expect(frames).toHaveLength(0);
    expect(timers).toEqual([{ callback: expect.any(Function), delay: FOCUS_WATCH_RELAXED_MS }]);
    runTimers();
    expect(doc.activeElement).toBe(row);
    expect(frames).toHaveLength(0);
    expect(timers).toHaveLength(1);
    runTimers(FOCUS_WATCH_MS);
    expect(timers).toHaveLength(0);
    expect(listenerCount()).toBe(0);
  });
});
