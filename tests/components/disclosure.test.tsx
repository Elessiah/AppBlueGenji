import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

// Environnement Node, sans DOM : les crochets sont rejoués à la main (un état, un effet, un identifiant).
const harness = { state: [] as unknown[], cursor: 0, server: false, subscribed: [] as (() => void)[] };
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
    useSyncExternalStore: (subscribe: (onChange: () => void) => () => void, snapshot: () => unknown, serverSnapshot: () => unknown) => {
      harness.subscribed.push(subscribe(() => undefined));
      return harness.server ? serverSnapshot() : snapshot();
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
  harness.subscribed = [];
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
  harness.server = false;
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

  it("Disclosure_always_titleIsAnH2WithTheButtonInside", () => {
    expect(renderToStaticMarkup(<Disclosure {...base} />)).toMatch(/<h2[^>]*><button/);
  });

  it("Disclosure_withAside_flagsRootForHeadingWidth", () => {
    expect(renderToStaticMarkup(<Disclosure {...base} aside={<i />} />)).toContain("data-aside");
    expect(renderToStaticMarkup(<Disclosure {...base} />)).not.toContain("data-aside");
  });

  it("Disclosure_storedOne_opensOnFirstRender", () => {
    globals.localStorage = { getItem: jest.fn(() => "1"), setItem: jest.fn() };

    expect(toggleOf(render({ ...base, storageKey: "k" })).props["aria-expanded"]).toBe(true);
  });

  it("Disclosure_storedOneOnServer_rendersDefaultToKeepHydrationEqual", () => {
    globals.localStorage = { getItem: jest.fn(() => "1"), setItem: jest.fn() };
    harness.server = true;

    expect(toggleOf(render({ ...base, storageKey: "k" })).props["aria-expanded"]).toBe(false);
  });

  it("Disclosure_storedZeroOverDefaultOpen_staysCollapsed", () => {
    globals.localStorage = { getItem: jest.fn(() => "0"), setItem: jest.fn() };

    expect(toggleOf(render({ ...base, defaultOpen: true, storageKey: "k" })).props["aria-expanded"]).toBe(false);
  });

  it("Disclosure_noStorageKey_neverReadsStorage", () => {
    const getItem = jest.fn(() => "1");
    globals.localStorage = { getItem, setItem: jest.fn() };

    expect(toggleOf(render(base)).props["aria-expanded"]).toBe(false);
    expect(getItem).not.toHaveBeenCalled();
  });

  it("Disclosure_visitChoice_beatsStoredValue", () => {
    globals.localStorage = { getItem: jest.fn(() => "1"), setItem: jest.fn() };
    click(render({ ...base, storageKey: "k" }));

    expect(toggleOf(render({ ...base, storageKey: "k" })).props["aria-expanded"]).toBe(false);
  });

  it("Disclosure_subscribe_listensToStorageEventsAndUnsubscribes", () => {
    const add = jest.fn();
    const remove = jest.fn();
    const target = globalThis as unknown as { addEventListener?: unknown; removeEventListener?: unknown };
    const saved = { add: target.addEventListener, remove: target.removeEventListener };
    target.addEventListener = add;
    target.removeEventListener = remove;
    try {
      render({ ...base, storageKey: "k" });
      harness.subscribed.forEach((unsubscribe) => unsubscribe());
    } finally {
      target.addEventListener = saved.add;
      target.removeEventListener = saved.remove;
    }

    expect(add).toHaveBeenCalledWith("storage", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("storage", add.mock.calls[0]?.[1]);
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

    expect(toggleOf(render({ ...base, storageKey: "k" })).props["aria-expanded"]).toBe(false);
    click(render({ ...base, storageKey: "k" }));

    expect(toggleOf(render({ ...base, storageKey: "k" })).props["aria-expanded"]).toBe(true);
  });
});
