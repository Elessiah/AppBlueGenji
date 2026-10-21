import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * `useCertificationPrompt` (`docs/features/CERTIFICATION_PROMPT.md`) : quand
 * l'invitation s'ouvre, attend, s'efface ou se tait. Sans DOM ni moteur de rendu
 * dans ce dépôt, les crochets de React sont rejoués par un banc minimal : états,
 * références, rappels mémorisés et effets à dépendances, rendu relancé tant
 * qu'un état change.
 */

type Deps = readonly unknown[] | undefined;
type Cleanup = void | (() => void);
type EffectSlot = { deps: Deps; cleanup: Cleanup; pending?: () => Cleanup };

const bench = {
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  callbacks: [] as { deps: Deps; fn: unknown }[],
  effects: [] as EffectSlot[],
  index: { state: 0, ref: 0, callback: 0, effect: 0 },
  dirty: false,
};

function sameDeps(a: Deps, b: Deps): boolean {
  return a !== undefined && b !== undefined && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

jest.mock("react", () => ({
  useState: (initial: unknown) => {
    const slot = bench.index.state++;
    if (!(slot in bench.states)) bench.states[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    const set = (value: unknown) => {
      const next = typeof value === "function" ? (value as (prev: unknown) => unknown)(bench.states[slot]) : value;
      if (Object.is(next, bench.states[slot])) return;
      bench.states[slot] = next;
      bench.dirty = true;
    };
    return [bench.states[slot], set];
  },
  useRef: (initial: unknown) => {
    const slot = bench.index.ref++;
    bench.refs[slot] ??= { current: initial };
    return bench.refs[slot];
  },
  useCallback: (fn: unknown, deps: Deps) => {
    const slot = bench.index.callback++;
    const previous = bench.callbacks[slot];
    if (previous && sameDeps(previous.deps, deps)) return previous.fn;
    bench.callbacks[slot] = { deps, fn };
    return fn;
  },
  useEffect: (effect: () => Cleanup, deps: Deps) => {
    const slot = bench.index.effect++;
    const previous = bench.effects[slot];
    if (previous && sameDeps(previous.deps, deps)) return;
    bench.effects[slot] = { deps, cleanup: previous?.cleanup, pending: effect };
  },
}));


const modals = {
  open: false,
  yieldWatchers: [] as (() => void)[],
  stopped: 0,
};
jest.mock("@/lib/shared/dialog-focus", () => ({
  anotherModalOpen: () => modals.open,
  watchUrgentModalOpened: (onMet: () => void) => {
    modals.yieldWatchers.push(onMet);
    return () => {
      modals.stopped += 1;
    };
  },
}));

import { useCertificationPrompt } from "@/app/(secured)/tournois/[id]/_hooks/useCertificationPrompt";

// Appelé hors composant, par le banc : le nom neutre le dit aux règles des crochets.
const runHook = useCertificationPrompt;
import {
  CERTIFICATION_PROMPT_CLOSED_KEY,
  CERTIFICATION_PROMPT_OFF_KEY,
  type CertificationPrompt,
} from "@/lib/shared/certification-prompt";

type HookResult = ReturnType<typeof useCertificationPrompt>;

/** Un rendu, puis ses effets, jusqu'à ce que plus aucun état ne change. */
function render(prompt: CertificationPrompt | null | undefined, frozen = false): HookResult {
  let result: HookResult;
  let rounds = 0;
  do {
    bench.dirty = false;
    bench.index = { state: 0, ref: 0, callback: 0, effect: 0 };
    result = runHook(prompt, frozen);
    for (const slot of bench.effects) {
      if (!slot.pending) continue;
      if (typeof slot.cleanup === "function") slot.cleanup();
      slot.cleanup = slot.pending();
      slot.pending = undefined;
    }
    rounds += 1;
  } while (bench.dirty && rounds < 20);
  return result;
}

/** Act : un geste hors rendu (rappel d'un guet, clic), puis le rendu qu'il déclenche. */
function act(gesture: () => void, prompt: CertificationPrompt | null | undefined, frozen = false): HookResult {
  gesture();
  return render(prompt, frozen);
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const globals = globalThis as unknown as { window?: unknown; document?: unknown };
let local = memoryStorage();
let session = memoryStorage();

const PROMPT: CertificationPrompt = {
  reason: "MANAGER",
  discordVerified: false,
  battletagVerified: true,
  battletagRelevant: true,
};

beforeEach(() => {
  bench.states = [];
  bench.refs = [];
  bench.callbacks = [];
  bench.effects = [];
  modals.open = false;
  modals.yieldWatchers = [];
  modals.stopped = 0;
  local = memoryStorage();
  session = memoryStorage();
  globals.window = { localStorage: local, sessionStorage: session };
  globals.document = {};
});

afterEach(() => {
  delete globals.window;
  delete globals.document;
});

describe("useCertificationPrompt", () => {
  it("ouvre l'invitation dès que le contexte en porte une, et pas avant", () => {
    expect(render(undefined).prompt).toBeNull();
    expect(render(PROMPT).prompt).toBe(PROMPT);
  });

  it("« Plus tard » la ferme pour l'onglet ; une relecture du contexte ne la rouvre pas", () => {
    const first = render(PROMPT);
    const after = act(() => first.close(), PROMPT);
    expect(after.prompt).toBeNull();
    expect(session.values.get(CERTIFICATION_PROMPT_CLOSED_KEY)).toBe("1");
    expect(local.values.has(CERTIFICATION_PROMPT_OFF_KEY)).toBe(false);
    expect(render({ ...PROMPT }).prompt).toBeNull();
  });

  it("« Ne plus voir » cochée : la fermeture la tait pour de bon", () => {
    const first = render(PROMPT);
    const ticked = act(() => first.setNeverAgain(true), PROMPT);
    expect(ticked.neverAgain).toBe(true);
    act(() => ticked.close(), PROMPT);
    expect(local.values.get(CERTIFICATION_PROMPT_OFF_KEY)).toBe("1");
  });

  it("ne s'ouvre pas déjà fermée dans l'onglet, ni après « Ne plus voir »", () => {
    session.setItem(CERTIFICATION_PROMPT_CLOSED_KEY, "1");
    expect(render(PROMPT).prompt).toBeNull();
    bench.states = [];
    bench.refs = [];
    bench.effects = [];
    session = memoryStorage();
    local.setItem(CERTIFICATION_PROMPT_OFF_KEY, "1");
    globals.window = { localStorage: local, sessionStorage: session };
    expect(render(PROMPT).prompt).toBeNull();
  });

  it("une autre modale déjà ouverte l'écarte pour la page, sans rien retenir", () => {
    modals.open = true;
    expect(render(PROMPT).prompt).toBeNull();
    // L'annonce de lancement se ferme au départ du match : rien ne surgit.
    modals.open = false;
    expect(render({ ...PROMPT }).prompt).toBeNull();
    expect(session.values.size + local.values.size).toBe(0);
  });

  it("cède sa place à une modale urgente pour le reste de la page, sans rien retenir", () => {
    render(PROMPT);
    expect(modals.yieldWatchers).toHaveLength(1);
    const yielded = act(() => modals.yieldWatchers[0](), PROMPT);
    expect(yielded.prompt).toBeNull();
    expect(session.values.size + local.values.size).toBe(0);
    // L'annonce de lancement se ferme : l'invitation ne revient pas sur cette page…
    expect(render({ ...PROMPT }).prompt).toBeNull();
    // …même retirée puis revenue (lecture en échec à une reconnexion).
    render(null);
    expect(render({ ...PROMPT }).prompt).toBeNull();
  });

  it("cédant sa place, une case « Ne plus voir » cochée est retenue pour de bon", () => {
    const first = render(PROMPT);
    act(() => first.setNeverAgain(true), PROMPT);
    act(() => modals.yieldWatchers.at(-1)?.(), PROMPT);
    expect(local.values.get(CERTIFICATION_PROMPT_OFF_KEY)).toBe("1");
    expect(session.values.has(CERTIFICATION_PROMPT_CLOSED_KEY)).toBe(false);
  });

  it("une invitation retirée ferme la modale sans rien retenir ; revenue, elle repasse par la décision", () => {
    render(PROMPT);
    expect(render(null).prompt).toBeNull();
    expect(session.values.size + local.values.size).toBe(0);
    expect(render(PROMPT).prompt).toBe(PROMPT);
    render(null);
    // Une autre modale s'est ouverte entre-temps : écartée…
    modals.open = true;
    expect(render(PROMPT).prompt).toBeNull();
    // …mais une invitation retirée puis revenue repasse par la décision.
    modals.open = false;
    render(null);
    expect(render({ ...PROMPT }).prompt).toEqual(PROMPT);
  });

  it("une fiche figée masque la modale et n'ouvre rien", () => {
    expect(render(PROMPT, true).prompt).toBeNull();
    expect(modals.yieldWatchers).toHaveLength(0);
  });

  it("stockage inaccessible : la modale s'ouvre et se ferme sans mémoire", () => {
    delete globals.window;
    const first = render(PROMPT);
    expect(first.prompt).toBe(PROMPT);
    expect(() => act(() => first.close(), PROMPT)).not.toThrow();
  });
});
