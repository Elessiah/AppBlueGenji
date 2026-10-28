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
  useMemo: (factory: () => unknown, deps: Deps) => {
    const slot = bench.index.callback++;
    const previous = bench.callbacks[slot];
    if (previous && sameDeps(previous.deps, deps)) return previous.fn;
    const value = factory();
    bench.callbacks[slot] = { deps, fn: value };
    return value;
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
  CERTIFICATION_PROMPT_OFF_PATH,
  LEGACY_CERTIFICATION_PROMPT_OFF_KEY,
  type CertificationPrompt,
} from "@/lib/shared/certification-prompt";

type HookResult = ReturnType<typeof useCertificationPrompt>;

/** Le compte du lecteur à qui l'invitation est montrée. */
const VIEWER_ID = 7;

/** Un rendu, puis ses effets, jusqu'à ce que plus aucun état ne change. */
function render(
  prompt: CertificationPrompt | null | undefined,
  frozen = false,
  tournamentId = 5,
  viewerUserId: number | null = VIEWER_ID,
): HookResult {
  let result: HookResult;
  let rounds = 0;
  do {
    bench.dirty = false;
    bench.index = { state: 0, ref: 0, callback: 0, effect: 0 };
    result = runHook(tournamentId, prompt, frozen, viewerUserId);
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
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

const globals = globalThis as unknown as { window?: unknown; document?: unknown; fetch?: unknown };
/** Le « Ne plus voir » part au compte : `POST` gardé même si la page se ferme (keepalive). */
let fetchMock = jest.fn<(input: string, init?: RequestInit) => Promise<Response>>();
const savedFetch = globals.fetch;
const neverAgainPosts = () =>
  fetchMock.mock.calls.filter(([input, init]) => input === CERTIFICATION_PROMPT_OFF_PATH && init?.method === "POST");
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
  fetchMock = jest.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => new Response("{}"));
  globals.fetch = fetchMock;
});

afterEach(() => {
  delete globals.window;
  delete globals.document;
  globals.fetch = savedFetch;
});

describe("useCertificationPrompt", () => {
  it("ouvre l'invitation dès que le contexte en porte une, et pas avant", () => {
    expect(render(undefined).prompt).toBeNull();
    expect(render(PROMPT).prompt).toEqual(PROMPT);
  });

  it("« Plus tard » la ferme pour l'onglet ; une relecture du contexte ne la rouvre pas", () => {
    const first = render(PROMPT);
    const after = act(() => first.close(), PROMPT);
    expect(after.prompt).toBeNull();
    expect(session.values.get(CERTIFICATION_PROMPT_CLOSED_KEY)).toBe("1");
    expect(local.values.size).toBe(0);
    expect(neverAgainPosts()).toHaveLength(0);
    expect(render({ ...PROMPT }).prompt).toBeNull();
  });

  it("« Ne plus voir » cochée : la fermeture la garde sur le compte, rien dans le stockage local (EF-04)", () => {
    const first = render(PROMPT);
    first.setNeverAgain(true);
    act(() => first.close(), PROMPT);
    expect(neverAgainPosts()).toHaveLength(1);
    expect(fetchMock.mock.calls[0][1]).toEqual({
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: VIEWER_ID }),
    });
    expect(local.values.size).toBe(0);
  });

  it("« Ne plus voir » désigne le compte à qui la modale a été montrée, pas celui d'un contexte relu depuis", () => {
    const first = render(PROMPT, false, 5, VIEWER_ID);
    first.setNeverAgain(true);
    first.close();
    render(PROMPT, false, 5, 8);
    expect(neverAgainPosts()).toHaveLength(1);
    expect(neverAgainPosts()[0][1]?.body).toBe(JSON.stringify({ userId: VIEWER_ID }));
  });

  it("lecteur inconnu : « Ne plus voir » n'envoie rien plutôt qu'un compte deviné", () => {
    const first = render(PROMPT, false, 5, null);
    first.setNeverAgain(true);
    act(() => first.close(), PROMPT);
    expect(neverAgainPosts()).toHaveLength(0);
  });

  it("une sauvegarde du « Ne plus voir » en échec reste muette : la modale se ferme quand même", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    const first = render(PROMPT);
    first.setNeverAgain(true);
    const after = act(() => first.close(), PROMPT);
    await Promise.resolve();
    expect(after.prompt).toBeNull();
    expect(neverAgainPosts()).toHaveLength(1);
  });

  it("`fetch` indisponible (document qui part) : la fermeture passe sans rien garder", () => {
    delete globals.fetch;
    const first = render(PROMPT);
    first.setNeverAgain(true);
    expect(() => act(() => first.close(), PROMPT)).not.toThrow();
  });

  it("efface l'ancienne clé locale du « Ne plus voir », qui ne tait plus rien (EF-04)", () => {
    local.setItem(LEGACY_CERTIFICATION_PROMPT_OFF_KEY, "1");
    expect(render(PROMPT).prompt).toEqual(PROMPT);
    expect(local.values.has(LEGACY_CERTIFICATION_PROMPT_OFF_KEY)).toBe(false);
  });

  it("ne s'ouvre pas déjà fermée dans l'onglet", () => {
    session.setItem(CERTIFICATION_PROMPT_CLOSED_KEY, "1");
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
    expect(neverAgainPosts()).toHaveLength(0);
    // L'annonce de lancement se ferme : l'invitation ne revient pas sur cette page…
    expect(render({ ...PROMPT }).prompt).toBeNull();
    // …même retirée puis revenue (lecture en échec à une reconnexion).
    render(null);
    expect(render({ ...PROMPT }).prompt).toBeNull();
  });

  it("cédant sa place, une case « Ne plus voir » cochée est retenue pour de bon", () => {
    const first = render(PROMPT);
    first.setNeverAgain(true);
    act(() => modals.yieldWatchers.at(-1)?.(), PROMPT);
    expect(neverAgainPosts()).toHaveLength(1);
    expect(session.values.has(CERTIFICATION_PROMPT_CLOSED_KEY)).toBe(false);
  });

  it("une invitation retirée ferme la modale sans rien retenir ; revenue, elle repasse par la décision", () => {
    render(PROMPT);
    expect(render(null).prompt).toBeNull();
    expect(session.values.size + local.values.size).toBe(0);
    expect(render(PROMPT).prompt).toEqual(PROMPT);
    render(null);
    // Une autre modale s'est ouverte entre-temps : écartée…
    modals.open = true;
    expect(render(PROMPT).prompt).toBeNull();
    // …mais une invitation retirée puis revenue repasse par la décision.
    modals.open = false;
    render(null);
    expect(render({ ...PROMPT }).prompt).toEqual(PROMPT);
  });

  it("un autre tournoi dans la même fiche : la mémoire de la page repart de zéro", () => {
    const first = render(PROMPT);
    act(() => modals.yieldWatchers.at(-1)?.(), PROMPT);
    expect(render({ ...PROMPT }).prompt).toBeNull();
    expect(render({ ...PROMPT }, false, 6).prompt).toEqual(PROMPT);
    expect(first.prompt).toEqual(PROMPT);
  });

  it("une relecture au contenu identique rend le même objet (modale mémoïsée)", () => {
    const first = render(PROMPT);
    const again = render({ ...PROMPT });
    expect(again.prompt).toBe(first.prompt);
  });

  it("une fiche figée masque la modale et n'ouvre rien", () => {
    expect(render(PROMPT, true).prompt).toBeNull();
    expect(modals.yieldWatchers).toHaveLength(0);
  });

  it("stockage inaccessible : la modale s'ouvre et se ferme sans mémoire", () => {
    delete globals.window;
    const first = render(PROMPT);
    expect(first.prompt).toEqual(PROMPT);
    expect(() => act(() => first.close(), PROMPT)).not.toThrow();
    // Retirée puis revenue : fermée, elle ne se rouvre pas sur cette page.
    render(null);
    expect(render({ ...PROMPT }).prompt).toBeNull();
  });
});
