import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { AudienceBeaconEntry } from "@/lib/shared/audience";

/**
 * `<AudienceBeacon />` avant son installation au repos (cycle standard 5 de
 * `feature/stats-page`) : la page d'arrivée est comptée même quand le visiteur
 * navigue ou part avant le repos. Environnement Node : les hooks de React sont
 * remplacés par des doubles (effets rejoués à la main, refs gardées d'un rendu
 * à l'autre) et le composant est appelé comme une fonction.
 */

type Effect = () => void | (() => void);

const mockHooks = {
  effects: [] as Effect[],
  refs: [] as { current: unknown }[],
  refIndex: 0,
  pathname: "/",
};

jest.mock("react", () => ({
  ...jest.requireActual<typeof import("react")>("react"),
  useEffect: (effect: Effect) => {
    mockHooks.effects.push(effect);
  },
  useRef: (initial: unknown) => {
    const index = mockHooks.refIndex;
    mockHooks.refIndex += 1;
    mockHooks.refs[index] ??= { current: initial };
    return mockHooks.refs[index];
  },
}));
jest.mock("next/navigation", () => ({ usePathname: () => mockHooks.pathname }));
jest.mock("@/lib/shared/client-power", () => ({ powerPolicy: () => ({ clocks: false }) }));
jest.mock("@/lib/shared/hooks/useClientPower", () => ({
  getClientPowerInput: () => ({}),
  subscribeClientPower: () => () => undefined,
}));

import { AudienceBeacon } from "@/components/audience-beacon";

const globals = globalThis as unknown as { window?: unknown; document?: unknown; fetch?: unknown };

let idle: (() => void) | null = null;
let pageHideListeners: (() => void)[] = [];
let pageShowListeners: ((event: { persisted: boolean }) => void)[] = [];
let visibilityListeners: (() => void)[] = [];
let sent: AudienceBeaconEntry[][] = [];

/** Navigateur minimal : chemin affiché, repos différé, écouteurs `pagehide` notés. */
function stubBrowser(pathname: string) {
  const location = { pathname, host: "bluegenji.test" };
  globals.window = {
    location,
    navigator: {},
    innerWidth: 1280,
    requestIdleCallback: (run: () => void) => {
      idle = run;
      return 1;
    },
    cancelIdleCallback: () => {
      idle = null;
    },
    addEventListener: (type: string, listener: () => void) => {
      if (type === "pagehide") pageHideListeners.push(listener);
      if (type === "pageshow") pageShowListeners.push(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === "pagehide") pageHideListeners = pageHideListeners.filter((entry) => entry !== listener);
    },
    setInterval: () => 1,
    clearInterval: () => undefined,
  };
  globals.document = {
    visibilityState: "visible",
    referrer: "https://partenaire.example/article",
    cookie: "",
    addEventListener: (type: string, listener: () => void) => {
      if (type === "visibilitychange") visibilityListeners.push(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === "visibilitychange") visibilityListeners = visibilityListeners.filter((entry) => entry !== listener);
    },
  };
  globals.fetch = jest.fn(async (_url: string, init: { body: string }) => {
    sent.push((JSON.parse(init.body) as { v: AudienceBeaconEntry[] }).v);
    return { ok: true };
  });
  return location;
}

/** Un rendu : les effets de ce rendu sont rendus pour être joués. */
function render(pathname: string): Effect[] {
  mockHooks.pathname = pathname;
  mockHooks.refIndex = 0;
  mockHooks.effects = [];
  AudienceBeacon();
  return mockHooks.effects;
}

function firePageHide() {
  for (const listener of [...pageHideListeners]) listener();
}

/** Change la visibilité de l'onglet et prévient les écouteurs. */
function setVisibility(state: "visible" | "hidden") {
  (globals.document as { visibilityState: string }).visibilityState = state;
  for (const listener of [...visibilityListeners]) listener();
}

/** Suites (temps de lecture) envoyées. */
const continuations = () => sent.flat().filter((entry) => entry.c === 1);

/** Pages vues envoyées (les suites, temps de lecture seul, écartées). */
const entries = () => sent.flat().filter((entry) => entry.c !== 1);

beforeEach(() => {
  idle = null;
  pageHideListeners = [];
  pageShowListeners = [];
  visibilityListeners = [];
  sent = [];
  mockHooks.refs = [];
});

afterEach(() => {
  jest.restoreAllMocks();
  delete globals.window;
  delete globals.document;
  delete globals.fetch;
});

describe("AudienceBeacon — avant le repos", () => {
  it("AudienceBeacon_navigateBeforeIdle_landingCountedThenNewPage", () => {
    const location = stubBrowser("/tournois");
    const [mount, onPath] = render("/tournois");
    mount();
    onPath();
    location.pathname = "/equipes";
    const [, onNavigate] = render("/equipes");

    onNavigate();
    firePageHide();

    expect(entries().map((entry) => [entry.p, entry.f ?? 0])).toEqual([
      ["/tournois", 1],
      ["/equipes", 0],
    ]);
    expect(entries()[0].r).toBe("partenaire.example");
    expect(idle).toBeNull();
  });

  it("AudienceBeacon_pagehideBeforeIdle_landingSent", () => {
    stubBrowser("/tournois");
    const [mount, onPath] = render("/tournois");
    mount();
    onPath();

    firePageHide();

    expect(entries().map((entry) => entry.p)).toEqual(["/tournois"]);
  });

  it("AudienceBeacon_idleInstall_landingCountedOnce", () => {
    stubBrowser("/tournois");
    const [mount, onPath] = render("/tournois");
    mount();
    onPath();

    idle?.();
    firePageHide();

    expect(entries().map((entry) => entry.p)).toEqual(["/tournois"]);
    expect(pageHideListeners).toHaveLength(1);
  });

  it("AudienceBeacon_unmountBeforeIdle_sendsNothing", () => {
    stubBrowser("/tournois");
    const [mount] = render("/tournois");
    const cleanup = mount();

    if (typeof cleanup === "function") cleanup();
    firePageHide();

    expect(entries()).toEqual([]);
    expect(idle).toBeNull();
  });

  it("AudienceBeacon_pagehideBeforeIdleTabHidden_landingStillSent", () => {
    stubBrowser("/tournois");
    const [mount, onPath] = render("/tournois");
    mount();
    onPath();
    // Au départ, le navigateur masque la page avant `pagehide`.
    (globals.document as { visibilityState: string }).visibilityState = "hidden";

    firePageHide();

    expect(entries().map((entry) => entry.p)).toEqual(["/tournois"]);
  });

  it("AudienceBeacon_navigateBeforeIdle_landingTimeFromMount", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    const location = stubBrowser("/tournois");
    const [mount, onPath] = render("/tournois");
    mount();
    onPath();
    now.mockReturnValue(1_000_500);
    location.pathname = "/equipes";
    const [, onNavigate] = render("/equipes");

    onNavigate();
    firePageHide();

    expect(continuations().map((entry) => [entry.p, entry.t])).toEqual([["/tournois", 500]]);
  });

  it("AudienceBeacon_earlyPagehideThenBfcacheRestore_pageResumed", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    stubBrowser("/tournois");
    const [mount, onPath] = render("/tournois");
    mount();
    onPath();
    (globals.document as { visibilityState: string }).visibilityState = "hidden";
    firePageHide();
    sent = [];

    now.mockReturnValue(1_010_000);
    setVisibility("visible");
    now.mockReturnValue(1_014_000);
    setVisibility("hidden");

    expect(entries()).toEqual([]);
    expect(continuations().map((entry) => [entry.p, entry.t])).toEqual([["/tournois", 4_000]]);
  });

  it("AudienceBeacon_installedPagehideThenPageshowPersisted_resumes", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    stubBrowser("/tournois");
    const [mount, onPath] = render("/tournois");
    mount();
    onPath();
    idle?.();
    firePageHide();
    sent = [];

    now.mockReturnValue(1_010_000);
    for (const listener of [...pageShowListeners]) listener({ persisted: true });
    now.mockReturnValue(1_013_000);
    firePageHide();

    expect(continuations().map((entry) => [entry.p, entry.t])).toEqual([["/tournois", 3_000]]);
  });
});
