import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { FOCUS_WATCH_MS, focusRowAfterChange } from "@/app/(secured)/tournois/[id]/_components/ForfeitRowAction";

/**
 * Focus après un abandon ou son annulation : le nouvel état peut s'afficher
 * plusieurs trames après la fin de `refresh()` (rendu groupé du flux). La
 * veille rend le focus au geste de la ligne, ou à la ligne, chaque fois qu'il
 * tombe sur `<body>`, et s'arrête dès que le lecteur va ailleurs.
 */
type FakeElement = { name: string; isConnected: boolean; focus: () => void; contains: (other: unknown) => boolean };

const globals = globalThis as { document?: unknown; requestAnimationFrame?: unknown };
const saved = { document: globals.document, requestAnimationFrame: globals.requestAnimationFrame };

let frames: (() => void)[] = [];
let clock = 0;
const body = { name: "body" };
const doc = {
  body,
  activeElement: body as unknown,
  nodes: {} as Record<string, FakeElement | null>,
  querySelector(selector: string) {
    return this.nodes[selector] ?? null;
  },
};

function element(name: string, children: FakeElement[] = []): FakeElement {
  const el: FakeElement = {
    name,
    isConnected: true,
    focus: () => {
      doc.activeElement = el;
    },
    contains: (other) => other === el || children.includes(other as FakeElement),
  };
  return el;
}

function runFrame(advance = 16) {
  clock += advance;
  const pending = frames;
  frames = [];
  for (const frame of pending) frame();
}

beforeEach(() => {
  frames = [];
  clock = 0;
  doc.activeElement = body;
  doc.nodes = {};
  globals.document = doc;
  globals.requestAnimationFrame = (cb: () => void) => {
    frames.push(cb);
    return frames.length;
  };
});
afterEach(() => {
  globals.document = saved.document;
  globals.requestAnimationFrame = saved.requestAnimationFrame;
});

describe("focusRowAfterChange", () => {
  it("rend le focus au geste de la ligne quand il est tombé sur <body>", () => {
    const button = element("button");
    doc.nodes['[data-row-action="7"]'] = button;
    doc.nodes['[data-row-focus="7"]'] = element("row", [button]);
    focusRowAfterChange(7, () => clock);
    runFrame();
    expect(doc.activeElement).toBe(button);
  });

  it("à défaut de geste, rend le focus à la ligne", () => {
    const row = element("row");
    doc.nodes['[data-row-focus="7"]'] = row;
    focusRowAfterChange(7, () => clock);
    runFrame();
    expect(doc.activeElement).toBe(row);
  });

  it("rattrape un rendu tardif : la ligne déplacée après coup reprend le focus", () => {
    const oldButton = element("old");
    const row = element("row", [oldButton]);
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
    doc.nodes['[data-row-focus="7"]'] = element("row", [newButton]);
    doc.activeElement = body;
    runFrame();
    expect(doc.activeElement).toBe(newButton);
  });

  it("s'arrête dès que le lecteur porte le focus hors de la ligne", () => {
    const button = element("button");
    doc.nodes['[data-row-action="7"]'] = button;
    doc.nodes['[data-row-focus="7"]'] = element("row", [button]);
    doc.activeElement = element("elsewhere");
    focusRowAfterChange(7, () => clock);
    runFrame();
    expect(frames).toHaveLength(0);
  });

  it("veille au plus FOCUS_WATCH_MS, sans boucle de fond", () => {
    const button = element("button");
    doc.nodes['[data-row-action="7"]'] = button;
    doc.nodes['[data-row-focus="7"]'] = element("row", [button]);
    focusRowAfterChange(7, () => clock);
    runFrame(FOCUS_WATCH_MS + 1);
    expect(frames).toHaveLength(0);
    doc.activeElement = body;
    runFrame();
    expect(doc.activeElement).toBe(body);
  });

  it("ne fait rien côté serveur", () => {
    globals.document = undefined;
    expect(() => focusRowAfterChange(7)).not.toThrow();
  });
});
