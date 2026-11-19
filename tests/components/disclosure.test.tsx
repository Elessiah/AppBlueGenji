import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

// Environnement Node, sans DOM : les crochets sont rejoués à la main (un état, un effet, un identifiant).
const harness = { state: [] as unknown[], cursor: 0, effects: [] as (() => void)[] };
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useId: () => "body-id",
    useState: (initial: unknown) => {
      const index = harness.cursor++;
      if (!(index in harness.state)) harness.state[index] = initial;
      return [harness.state[index], (next: unknown) => (harness.state[index] = next)];
    },
    useEffect: (effect: () => void) => {
      harness.effects.push(effect);
    },
  };
});

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";
import { Disclosure } from "@/components/ui/disclosure";

type Props = Parameters<typeof Disclosure>[0];
type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;

function render(props: Props): Node {
  harness.cursor = 0;
  harness.effects = [];
  return Disclosure(props) as unknown as Node;
}

function walk(node: unknown, visit: (element: Node) => void): void {
  if (Array.isArray(node)) node.forEach((child) => walk(child, visit));
  else if (node && typeof node === "object" && "props" in node) {
    visit(node as Node);
    walk((node as Node).props.children, visit);
  }
}

function find(root: Node, test: (element: Node) => boolean): Node | undefined {
  let found: Node | undefined;
  walk(root, (element) => {
    if (!found && test(element)) found = element;
  });
  return found;
}

const toggleOf = (root: Node) => find(root, (element) => element.type === "button") as Node;
const body = (root: Node) => find(root, (element) => element.props.id === "body-id");
const click = (root: Node) => (toggleOf(root).props.onClick as () => void)();
const base: Props = { title: "Matchs passés", children: "contenu" };

const globals = globalThis as { localStorage?: unknown };
const saved = globals.localStorage;

beforeEach(() => {
  harness.state = [];
});
afterEach(() => {
  globals.localStorage = saved;
});

describe("Disclosure", () => {
  it("Disclosure_firstRender_isCollapsedWithoutBody", () => {
    const root = render(base);

    expect(toggleOf(root).props["aria-expanded"]).toBe(false);
    expect(body(root)).toBeUndefined();
  });

  it("Disclosure_defaultOpen_rendersBodyAndExpanded", () => {
    const root = render({ ...base, defaultOpen: true });

    expect(toggleOf(root).props["aria-expanded"]).toBe(true);
    expect(body(root)?.props.hidden).toBe(false);
  });

  it("Disclosure_toggleClicked_opensThenCollapsesAgain", () => {
    click(render(base));
    const opened = render(base);
    expect(toggleOf(opened).props["aria-expanded"]).toBe(true);
    expect(body(opened)).toBeDefined();

    click(opened);

    expect(toggleOf(render(base)).props["aria-expanded"]).toBe(false);
  });

  it("Disclosure_open_ariaControlsPointsAtBodyId", () => {
    const opened = render({ ...base, defaultOpen: true });

    expect(toggleOf(opened).props["aria-controls"]).toBe(body(opened)?.props.id);
  });

  it("Disclosure_collapsedWithoutKeepMounted_noAriaControlsToAbsentId", () => {
    expect(toggleOf(render(base)).props["aria-controls"]).toBeUndefined();
  });

  it("Disclosure_keepMountedAndCollapsed_bodyStaysMountedButHidden", () => {
    const root = render({ ...base, keepMounted: true });

    expect(body(root)?.props.hidden).toBe(true);
  });

  it("Disclosure_countGiven_showsCountInTitle", () => {
    const html = renderToStaticMarkup(<Disclosure {...base} count={12} />);

    expect(html).toContain("Matchs passés");
    expect(html).toContain("(12)");
  });

  it("Disclosure_levelThree_usesH3", () => {
    expect(renderToStaticMarkup(<Disclosure {...base} level={3} />)).toContain("<h3");
  });

  it("Disclosure_storedOne_opensAfterMount", () => {
    globals.localStorage = { getItem: jest.fn(() => "1"), setItem: jest.fn() };
    render({ ...base, storageKey: "k" });

    harness.effects.forEach((effect) => effect());

    expect(toggleOf(render({ ...base, storageKey: "k" })).props["aria-expanded"]).toBe(true);
  });

  it("Disclosure_storedZeroOverDefaultOpen_staysCollapsed", () => {
    globals.localStorage = { getItem: jest.fn(() => "0"), setItem: jest.fn() };
    render({ ...base, defaultOpen: true, storageKey: "k" });

    harness.effects.forEach((effect) => effect());

    expect(toggleOf(render({ ...base, defaultOpen: true, storageKey: "k" })).props["aria-expanded"]).toBe(false);
  });

  it("Disclosure_toggleWithStorage_writesChoice", () => {
    const setItem = jest.fn();
    globals.localStorage = { getItem: jest.fn(() => null), setItem };

    click(render({ ...base, storageKey: "k" }));

    expect(setItem).toHaveBeenCalledWith("k", "1");
  });

  it("Disclosure_storageThrows_keepsDefaultAndStillToggles", () => {
    const failing = () => {
      throw new Error("blocked");
    };
    globals.localStorage = { getItem: failing, setItem: failing };
    render({ ...base, storageKey: "k" });

    expect(() => harness.effects.forEach((effect) => effect())).not.toThrow();
    click(render({ ...base, storageKey: "k" }));

    expect(toggleOf(render({ ...base, storageKey: "k" })).props["aria-expanded"]).toBe(true);
  });
});
