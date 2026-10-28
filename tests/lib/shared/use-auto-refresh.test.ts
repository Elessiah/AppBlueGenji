import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * `useAutoRefresh` (`lib/shared/hooks/useAutoRefresh.ts`) : options ajoutées
 * pour la fenêtre de certification Discord (EF-04) — sans période, retour par
 * le cache avant/arrière, lecture faite hors du crochet, relecture à
 * l'activation, reprise d'un rafraîchissement qui n'a pas tranché. Sans DOM :
 * les crochets de React sont rejoués par un banc minimal (références par
 * rang, effets lancés à chaque rendu dont les dépendances changent).
 */

type Deps = readonly unknown[];
const bench = {
  refs: [] as { current: unknown }[],
  effects: [] as { deps: Deps; cleanup?: void | (() => void) }[],
  index: { ref: 0, effect: 0 },
};

jest.mock("react", () => ({
  useRef: (initial: unknown) => {
    const slot = bench.index.ref++;
    bench.refs[slot] ??= { current: initial };
    return bench.refs[slot];
  },
  useEffect: (effect: () => void | (() => void), deps: Deps) => {
    const slot = bench.index.effect++;
    const previous = bench.effects[slot];
    if (previous && previous.deps.length === deps.length && previous.deps.every((value, i) => Object.is(value, deps[i]))) return;
    if (typeof previous?.cleanup === "function") previous.cleanup();
    bench.effects[slot] = { deps, cleanup: effect() };
  },
}));

import { useAutoRefresh, type AutoRefreshOutcome } from "@/lib/shared/hooks/useAutoRefresh";

/** Appelé hors composant, par le banc. */
const runHook = useAutoRefresh;
type Options = Parameters<typeof useAutoRefresh>[1];

class Target {
  readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  fire(type: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
  count(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

const globals = globalThis as unknown as { window?: unknown; document?: unknown };
let win: Target;
let doc: Target & { visibilityState: string };

function render(refresh: (signal: AbortSignal) => AutoRefreshOutcome | Promise<AutoRefreshOutcome>, options: Options) {
  bench.index = { ref: 0, effect: 0 };
  runHook(refresh, options);
}

function unmount() {
  for (const slot of bench.effects) if (typeof slot.cleanup === "function") slot.cleanup();
  bench.effects = [];
}

/** Laisse se régler la promesse de l'issue d'un rafraîchissement. */
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1_000_000);
  bench.refs = [];
  bench.effects = [];
  win = new Target();
  doc = Object.assign(new Target(), { visibilityState: "visible" });
  globals.window = win;
  globals.document = doc;
});

afterEach(() => {
  unmount();
  delete globals.window;
  delete globals.document;
  jest.useRealTimers();
});

describe("useAutoRefresh — sans période (intervalMs: null)", () => {
  it("aucun minuteur ; seuls les retours sur l'onglet relisent, étranglés", () => {
    const refresh = jest.fn<() => void>();
    render(refresh, { intervalMs: null, focusMinIntervalMs: 30_000 });
    jest.advanceTimersByTime(10 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
    doc.fire("visibilitychange");
    expect(refresh).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(29_999);
    doc.fire("visibilitychange");
    expect(refresh).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    doc.fire("visibilitychange");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("une période nulle ou négative désactive toujours tout", () => {
    const refresh = jest.fn<() => void>();
    render(refresh, { intervalMs: 0, runOnEnable: true, focusMinIntervalMs: 0 });
    doc.fire("visibilitychange");
    expect(refresh).not.toHaveBeenCalled();
    expect(doc.count("visibilitychange")).toBe(0);
  });

  it("une période donnée garde son minuteur, muet onglet caché", () => {
    const refresh = jest.fn<() => void>();
    render(refresh, { intervalMs: 1_000 });
    jest.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    doc.visibilityState = "hidden";
    jest.advanceTimersByTime(5_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("useAutoRefresh — options de la fenêtre de certification (EF-04)", () => {
  it("pageShow : un retour par le cache avant/arrière relit ; sans l'option, rien n'écoute", () => {
    const refresh = jest.fn<() => void>();
    render(refresh, { intervalMs: null, focusMinIntervalMs: 0 });
    expect(win.count("pageshow")).toBe(0);
    unmount();
    bench.refs = [];
    render(refresh, { intervalMs: null, focusMinIntervalMs: 0, pageShow: true });
    win.fire("pageshow");
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();
    expect(win.count("pageshow")).toBe(0);
  });

  it("freshAt : une lecture faite hors du crochet compte pour l'étranglement", () => {
    const refresh = jest.fn<() => void>();
    const freshAt = { current: 0 };
    render(refresh, { intervalMs: null, focusMinIntervalMs: 30_000, freshAt });
    freshAt.current = Date.now();
    jest.advanceTimersByTime(20_000);
    doc.fire("visibilitychange");
    expect(refresh).not.toHaveBeenCalled();
    jest.advanceTimersByTime(10_000);
    doc.fire("visibilitychange");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("runOnEnable : relit à l'activation si le délai est passé, pas sinon, ni onglet caché", () => {
    const refresh = jest.fn<() => void>();
    const freshAt = { current: Date.now() - 10_000 };
    render(refresh, { intervalMs: null, enabled: true, focusMinIntervalMs: 30_000, freshAt, runOnEnable: true });
    expect(refresh).not.toHaveBeenCalled();
    render(refresh, { intervalMs: null, enabled: false, focusMinIntervalMs: 30_000, freshAt, runOnEnable: true });
    jest.advanceTimersByTime(20_000);
    render(refresh, { intervalMs: null, enabled: true, focusMinIntervalMs: 30_000, freshAt, runOnEnable: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    render(refresh, { intervalMs: null, enabled: false, focusMinIntervalMs: 30_000, freshAt, runOnEnable: true });
    jest.advanceTimersByTime(60_000);
    doc.visibilityState = "hidden";
    render(refresh, { intervalMs: null, enabled: true, focusMinIntervalMs: 30_000, freshAt, runOnEnable: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("« RETRY » : retenté une fois au retour du focus, même avant le délai", async () => {
    const refresh = jest.fn<() => AutoRefreshOutcome>().mockReturnValue("RETRY");
    render(refresh, { intervalMs: null, focusMinIntervalMs: 30_000 });
    doc.fire("visibilitychange");
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    win.fire("focus");
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
    // La reprise elle-même n'a pas tranché : pas de troisième essai.
    win.fire("focus");
    win.fire("online");
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("« RETRY » repris au retour du réseau ; un rafraîchissement tranché n'est jamais repris", async () => {
    const refresh = jest.fn<() => AutoRefreshOutcome>().mockReturnValueOnce("RETRY").mockReturnValue(undefined);
    render(refresh, { intervalMs: null, focusMinIntervalMs: 30_000 });
    doc.fire("visibilitychange");
    await settle();
    win.fire("online");
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
    win.fire("focus");
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("un focus sans reprise due ne relit rien ; onglet caché, la reprise attend", async () => {
    const refresh = jest.fn<() => AutoRefreshOutcome>().mockReturnValue("RETRY");
    render(refresh, { intervalMs: null, focusMinIntervalMs: 30_000 });
    win.fire("focus");
    expect(refresh).not.toHaveBeenCalled();
    doc.fire("visibilitychange");
    await settle();
    doc.visibilityState = "hidden";
    win.fire("focus");
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("un rafraîchissement en échec (rejet) ne casse rien et n'est pas repris", async () => {
    const refresh = jest.fn<() => Promise<AutoRefreshOutcome>>().mockRejectedValue(new Error("offline"));
    render(refresh, { intervalMs: null, focusMinIntervalMs: 30_000 });
    doc.fire("visibilitychange");
    await settle();
    win.fire("focus");
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("démonté : le rafraîchissement en vol est abandonné, plus aucun écouteur", () => {
    const signals: AbortSignal[] = [];
    render((signal) => void signals.push(signal), { intervalMs: null, focusMinIntervalMs: 0, pageShow: true });
    doc.fire("visibilitychange");
    unmount();
    expect(signals[0].aborted).toBe(true);
    expect([doc.count("visibilitychange"), win.count("online"), win.count("focus"), win.count("pageshow")]).toEqual([0, 0, 0, 0]);
  });
});
