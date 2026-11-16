import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  closedWatchers: [] as (() => void)[],
  closedStopped: 0,
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
  // Comme le vrai guet : tout de suite si aucune modale n'est ouverte.
  watchModalsClosed: (onClosed: () => void) => {
    if (!modals.open) onClosed();
    else modals.closedWatchers.push(onClosed);
    return () => {
      modals.closedStopped += 1;
    };
  },
}));

import {
  noticeOnceModalsClosed,
  PROFILE_CERTIFICATION_NOTICE_MAX_WAIT_MS,
  REFUSAL_NOTICE_MAX_WAIT_MS,
  REFUSAL_NOTICE_RECHECK_MS,
  saveNeverAgain,
  useCertificationPrompt,
} from "@/app/(secured)/tournois/[id]/_hooks/useCertificationPrompt";
import { CERTIFY_PROMPT_OTHER_ACCOUNT } from "@/lib/shared/discord-certify-prompt";
import { signalSessionChanged } from "@/lib/shared/session-change-signal";
import {
  markProfileCertificationDialogOpen,
  profileCertificationDialogOpenedSince,
  profileCertificationDialogRecent,
  resetProfileCertificationDialogSignal,
} from "@/lib/shared/profile-certification-dialog";

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
    result = runHook(tournamentId, prompt, frozen, viewerUserId, onOtherAccount);
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
/** Le toast « un autre compte est connecté » de la fiche (EF-23). */
let onOtherAccount = jest.fn<() => void>();

const PROMPT: CertificationPrompt = {
  reason: "MANAGER",
  discordVerified: false,
  battletagVerified: true,
  battletagRelevant: true,
  teamHasContact: true,
};

beforeEach(() => {
  bench.states = [];
  bench.refs = [];
  bench.callbacks = [];
  bench.effects = [];
  modals.open = false;
  modals.yieldWatchers = [];
  modals.closedWatchers = [];
  modals.closedStopped = 0;
  modals.stopped = 0;
  resetProfileCertificationDialogSignal();
  local = memoryStorage();
  session = memoryStorage();
  globals.window = { localStorage: local, sessionStorage: session };
  globals.document = {};
  fetchMock = jest.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => new Response("{}"));
  onOtherAccount = jest.fn<() => void>();
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
    const checked = act(() => first.setNeverAgain(true), PROMPT);
    act(() => checked.close(), PROMPT);
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
    render(PROMPT, false, 5, VIEWER_ID).close();
    render(PROMPT, false, 5, 8);
    expect(neverAgainPosts()).toHaveLength(1);
    expect(neverAgainPosts()[0][1]?.body).toBe(JSON.stringify({ userId: VIEWER_ID }));
  });

  it("lecteur inconnu : « Ne plus voir » n'envoie rien plutôt qu'un compte deviné", () => {
    const first = render(PROMPT, false, 5, null);
    first.setNeverAgain(true);
    const checked = render(PROMPT, false, 5, null);
    act(() => checked.close(), PROMPT);
    expect(neverAgainPosts()).toHaveLength(0);
  });

  it("une sauvegarde du « Ne plus voir » en échec reste muette : la modale se ferme quand même", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    const first = render(PROMPT);
    const checked = act(() => first.setNeverAgain(true), PROMPT);
    const after = act(() => checked.close(), PROMPT);
    await Promise.resolve();
    expect(after.prompt).toBeNull();
    expect(neverAgainPosts()).toHaveLength(1);
  });

  it("`fetch` indisponible (document qui part) : la fermeture passe sans rien garder", () => {
    delete globals.fetch;
    const first = render(PROMPT);
    const checked = act(() => first.setNeverAgain(true), PROMPT);
    expect(() => act(() => checked.close(), PROMPT)).not.toThrow();
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
    act(() => first.setNeverAgain(true), PROMPT);
    // Le guet est réarmé avec le rappel qui voit la case cochée.
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

  it("useCertificationPrompt_setNeverAgain_exposesCheckedState : la case n'a qu'un état, tenu ici", () => {
    const first = render(PROMPT);
    expect(first.neverAgain).toBe(false);
    const checked = act(() => first.setNeverAgain(true), PROMPT);
    expect(checked.neverAgain).toBe(true);
    const unchecked = act(() => checked.setNeverAgain(false), PROMPT);
    expect(unchecked.neverAgain).toBe(false);
  });

  it("useCertificationPrompt_uncheckedAgain_closeSavesNothing : décochée avant de fermer, rien ne part", () => {
    const first = render(PROMPT);
    act(() => first.setNeverAgain(true), PROMPT);
    const unchecked = act(() => first.setNeverAgain(false), PROMPT);
    act(() => unchecked.close(), PROMPT);
    expect(neverAgainPosts()).toHaveLength(0);
  });

  it("useCertificationPrompt_otherTournament_resetsNeverAgain : la case repart décochée", () => {
    const first = render(PROMPT);
    act(() => first.setNeverAgain(true), PROMPT);
    expect(render({ ...PROMPT }, false, 6).neverAgain).toBe(false);
  });

  it("useCertificationPrompt_teamWithoutContact_keepsTeamHasContactInPrompt : le meneur d'une équipe injoignable le reste", () => {
    const unreachable: CertificationPrompt = { ...PROMPT, teamHasContact: false };
    expect(render(unreachable).prompt).toEqual(unreachable);
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

  it("useCertificationPrompt_neverAgainRefusedForOtherAccount_reportsIt (EF-23)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: CERTIFY_PROMPT_OTHER_ACCOUNT }), { status: 409 }));
    const first = render(PROMPT);
    const checked = act(() => first.setNeverAgain(true), PROMPT);
    act(() => checked.close(), PROMPT);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onOtherAccount).toHaveBeenCalledTimes(1);
  });

  // Revue #521 : le refus ne part pas derrière une modale urgente (ou le dialogue
  // de certification de /profil) : il attend qu'elle se ferme.
  it("useCertificationPrompt_refusedWhileUrgentModalOpen_reportsOnceItCloses", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: CERTIFY_PROMPT_OTHER_ACCOUNT }), { status: 409 }));
    const first = render(PROMPT);
    act(() => first.setNeverAgain(true), PROMPT);
    modals.open = true;
    act(() => modals.yieldWatchers.at(-1)?.(), PROMPT);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onOtherAccount).not.toHaveBeenCalled();

    modals.open = false;
    modals.closedWatchers.forEach((watcher) => watcher());

    expect(onOtherAccount).toHaveBeenCalledTimes(1);
  });

  it("noticeOnceModalsClosed_noModalOpen_noticesAtOnceAndLeavesNoWatch", () => {
    const notice = jest.fn();

    noticeOnceModalsClosed(notice);

    expect(notice).toHaveBeenCalledTimes(1);
    expect(modals.closedStopped).toBe(1);
  });

  it("noticeOnceModalsClosed_modalStaysOpenPastTheCap_closesSilently", () => {
    jest.useFakeTimers();
    try {
      modals.open = true;
      const notice = jest.fn();

      // Aucun dialogue de certification de `/profil` ouvert depuis le refus.
      noticeOnceModalsClosed(notice);
      jest.advanceTimersByTime(REFUSAL_NOTICE_MAX_WAIT_MS);
      // La modale se ferme plus tard, sur une autre page : silence.
      modals.open = false;
      modals.closedWatchers.forEach((watcher) => watcher());

      expect(notice).not.toHaveBeenCalled();
      expect(modals.closedStopped).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // Performance cycle 1 : sans dialogue de `/profil`, l'observateur du document
  // cesse dès les deux minutes ; il ne tourne pas dix minutes pour rien.
  it("noticeOnceModalsClosed_noProfileDialogAfterTwoMinutes_stopsObservingDocument", () => {
    jest.useFakeTimers();
    try {
      modals.open = true;
      noticeOnceModalsClosed(jest.fn());

      jest.advanceTimersByTime(REFUSAL_NOTICE_MAX_WAIT_MS - 1);
      expect(modals.closedStopped).toBe(0);
      jest.advanceTimersByTime(1);
      expect(modals.closedStopped).toBe(1);
      jest.advanceTimersByTime(PROFILE_CERTIFICATION_NOTICE_MAX_WAIT_MS);
      expect(modals.closedStopped).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("noticeOnceModalsClosed_profileDialogOpenedBeforeTwoMinutes_watchesUntilTenMinutes", () => {
    jest.useFakeTimers();
    try {
      modals.open = true;
      noticeOnceModalsClosed(jest.fn());
      const closeDialog = markProfileCertificationDialogOpen();

      jest.advanceTimersByTime(PROFILE_CERTIFICATION_NOTICE_MAX_WAIT_MS - 1);
      expect(modals.closedStopped).toBe(0);
      jest.advanceTimersByTime(1);
      expect(modals.closedStopped).toBe(1);
      closeDialog();
    } finally {
      jest.useRealTimers();
    }
  });

  it("noticeOnceModalsClosed_profileDialogOpensAfterObservationStopped_watchesAgain", () => {
    jest.useFakeTimers();
    try {
      modals.open = true;
      noticeOnceModalsClosed(jest.fn());
      jest.advanceTimersByTime(REFUSAL_NOTICE_MAX_WAIT_MS + 1_000);
      const watchersBefore = modals.closedWatchers.length;

      const closeDialog = markProfileCertificationDialogOpen();
      expect(modals.closedWatchers).toHaveLength(watchersBefore + 1);
      // Une seconde ouverture ne rouvre pas un second observateur.
      closeDialog();
      markProfileCertificationDialogOpen()();
      expect(modals.closedWatchers).toHaveLength(watchersBefore + 1);
    } finally {
      jest.useRealTimers();
    }
  });

  // Revue std 4 : « Certifier » cliqué juste avant les deux minutes, dialogue de
  // `/profil` monté juste après — l'extension vaut encore.
  it("noticeOnceModalsClosed_profileDialogOpensJustAfterTwoMinutes_noticesWhenItCloses", () => {
    jest.useFakeTimers();
    try {
      modals.open = true;
      const notice = jest.fn();

      noticeOnceModalsClosed(notice);
      jest.advanceTimersByTime(REFUSAL_NOTICE_MAX_WAIT_MS + 1_000);
      const closeDialog = markProfileCertificationDialogOpen();
      jest.advanceTimersByTime(60_000);
      closeDialog();
      modals.open = false;
      modals.closedWatchers.forEach((watcher) => watcher());

      expect(notice).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("noticeOnceModalsClosed_profileDialogClosedBeforeTheRefusal_doesNotExtend", () => {
    jest.useFakeTimers();
    try {
      markProfileCertificationDialogOpen()();
      jest.advanceTimersByTime(1_000);
      modals.open = true;
      const notice = jest.fn();

      noticeOnceModalsClosed(notice);
      jest.advanceTimersByTime(3 * 60_000);
      modals.open = false;
      modals.closedWatchers.forEach((watcher) => watcher());

      expect(notice).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("noticeOnceModalsClosed_profileCertificationOpenAtDeadline_noticesWhenClosedMinutesLater", () => {
    jest.useFakeTimers();
    try {
      modals.open = true;
      const notice = jest.fn();

      noticeOnceModalsClosed(notice, REFUSAL_NOTICE_MAX_WAIT_MS, { extendWhile: () => true, dialogRecent: () => true });
      // Neuf minutes dans le dialogue de certification de `/profil`.
      jest.advanceTimersByTime(9 * 60_000);
      modals.open = false;
      modals.closedWatchers.forEach((watcher) => watcher());

      expect(notice).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // Revue sécurité cycle 1 : « Certifier » monte le dialogue de `/profil` avant
  // que la réponse du refus n'arrive — ouvert avant le refus, il étend le guet
  // tant qu'il reste ouvert (règle de la revue std 3), jamais au-delà de dix minutes.
  it("noticeOnceModalsClosed_profileDialogMountedBeforeRefusal_noticesWhenClosedLater", () => {
    jest.useFakeTimers();
    try {
      const closeDialog = markProfileCertificationDialogOpen();
      jest.advanceTimersByTime(1_000);
      modals.open = true;
      const notice = jest.fn();
      noticeOnceModalsClosed(notice);

      jest.advanceTimersByTime(5 * 60_000);
      closeDialog();
      modals.open = false;
      modals.closedWatchers.forEach((watcher) => watcher());

      expect(notice).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // Revue sécurité cycle 2 : le dialogue ouvert au refus puis fermé aussitôt,
  // une autre modale gardée ouverte huit minutes — le refus n'a plus de contexte.
  it("noticeOnceModalsClosed_profileDialogClosedThenOtherModalMinutesLater_staysSilent", () => {
    jest.useFakeTimers();
    try {
      const closeDialog = markProfileCertificationDialogOpen();
      modals.open = true;
      const notice = jest.fn();
      noticeOnceModalsClosed(notice);

      jest.advanceTimersByTime(1_000);
      closeDialog();
      jest.advanceTimersByTime(8 * 60_000);
      modals.open = false;
      modals.closedWatchers.forEach((watcher) => watcher());

      expect(notice).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("noticeOnceModalsClosed_profileDialogClosedThenOtherModalSoonAfter_notices", () => {
    jest.useFakeTimers();
    try {
      const closeDialog = markProfileCertificationDialogOpen();
      modals.open = true;
      const notice = jest.fn();
      noticeOnceModalsClosed(notice);

      jest.advanceTimersByTime(4 * 60_000);
      closeDialog();
      jest.advanceTimersByTime(60_000);
      modals.open = false;
      modals.closedWatchers.forEach((watcher) => watcher());

      expect(notice).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // Revue sécurité cycle 3 : prolongé par le dialogue puis celui-ci fermé, une
  // autre modale gardée ouverte — l'observateur cesse peu après la fin de
  // l'extension, pas aux dix minutes.
  it("noticeOnceModalsClosed_profileDialogClosedThenOtherModalStays_stopsObservingAfterExtensionExpires", () => {
    jest.useFakeTimers();
    try {
      const closeDialog = markProfileCertificationDialogOpen();
      modals.open = true;
      noticeOnceModalsClosed(jest.fn());

      jest.advanceTimersByTime(60_000);
      closeDialog();
      jest.advanceTimersByTime(REFUSAL_NOTICE_MAX_WAIT_MS - 1);
      expect(modals.closedStopped).toBe(0);
      jest.advanceTimersByTime(REFUSAL_NOTICE_RECHECK_MS);
      expect(modals.closedStopped).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // Revue sécurité cycle 3 : déconnexion ou connexion sans rechargement — le
  // refus retenu ne s'adresse jamais au compte suivant.
  it("noticeOnceModalsClosed_sessionChanged_dropsTheNoticeSilently", () => {
    jest.useFakeTimers();
    try {
      modals.open = true;
      const notice = jest.fn();
      noticeOnceModalsClosed(notice);

      signalSessionChanged();
      modals.open = false;
      modals.closedWatchers.forEach((watcher) => watcher());

      expect(notice).not.toHaveBeenCalled();
      expect(modals.closedStopped).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("profileCertificationDialogRecent_openThenClosed_recentOnlyWithinDelay", () => {
    jest.useFakeTimers();
    try {
      expect(profileCertificationDialogRecent(1_000)).toBe(false);
      const close = markProfileCertificationDialogOpen();
      expect(profileCertificationDialogRecent(1_000)).toBe(true);
      close();
      jest.advanceTimersByTime(999);
      expect(profileCertificationDialogRecent(1_000)).toBe(true);
      jest.advanceTimersByTime(1);
      expect(profileCertificationDialogRecent(1_000)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("noticeOnceModalsClosed_profileDialogMountedBeforeRefusal_silentPastTenMinutes", () => {
    jest.useFakeTimers();
    try {
      const closeDialog = markProfileCertificationDialogOpen();
      modals.open = true;
      const notice = jest.fn();
      noticeOnceModalsClosed(notice);

      jest.advanceTimersByTime(PROFILE_CERTIFICATION_NOTICE_MAX_WAIT_MS);
      closeDialog();
      modals.open = false;
      modals.closedWatchers.forEach((watcher) => watcher());

      expect(notice).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("profileCertificationDialogOpenedSince_openThenClosed_tracksOpeningTime", () => {
    expect(profileCertificationDialogOpenedSince(0)).toBe(false);
    const close = markProfileCertificationDialogOpen(1_000);
    expect(profileCertificationDialogOpenedSince(5_000)).toBe(true);
    close();
    close();
    expect(profileCertificationDialogOpenedSince(1_000)).toBe(true);
    expect(profileCertificationDialogOpenedSince(1_001)).toBe(false);
  });

  it("profileCertificationDialogOpenedSince_twoDialogs_staysOpenUntilBothClose", () => {
    const first = markProfileCertificationDialogOpen(10);
    const second = markProfileCertificationDialogOpen(20);
    first();
    expect(profileCertificationDialogOpenedSince(100)).toBe(true);
    second();
    expect(profileCertificationDialogOpenedSince(100)).toBe(false);
  });

  it("DiscordVerificationDialog_signalsItsOwnOpening", () => {
    // Le dialogue de `/profil` se signale lui-même, sans sélecteur du DOM.
    const dialog = readFileSync(join(process.cwd(), "app", "(secured)", "profil", "DiscordVerificationDialog.tsx"), "utf8");
    expect(dialog).toContain("useEffect(() => markProfileCertificationDialogOpen(), []);");
    const hook = readFileSync(
      join(process.cwd(), "app", "(secured)", "tournois", "[id]", "_hooks", "useCertificationPrompt.ts"),
      "utf8",
    );
    expect(hook).not.toContain("discord-verify-title");
  });

  it("noticeOnceModalsClosed_otherModalPastTwoMinutes_staysSilent", () => {
    jest.useFakeTimers();
    try {
      modals.open = true;
      const notice = jest.fn();

      noticeOnceModalsClosed(notice, REFUSAL_NOTICE_MAX_WAIT_MS, { extendWhile: () => false });
      jest.advanceTimersByTime(3 * 60_000);
      modals.open = false;
      modals.closedWatchers.forEach((watcher) => watcher());

      expect(REFUSAL_NOTICE_MAX_WAIT_MS).toBe(2 * 60_000);
      expect(notice).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("noticeOnceModalsClosed_profileCertificationPastTenMinutes_staysSilent", () => {
    jest.useFakeTimers();
    try {
      modals.open = true;
      modals.closedStopped = 0;
      const notice = jest.fn();

      noticeOnceModalsClosed(notice, REFUSAL_NOTICE_MAX_WAIT_MS, { extendWhile: () => true, dialogRecent: () => true });
      jest.advanceTimersByTime(PROFILE_CERTIFICATION_NOTICE_MAX_WAIT_MS);
      modals.open = false;
      modals.closedWatchers.forEach((watcher) => watcher());

      expect(PROFILE_CERTIFICATION_NOTICE_MAX_WAIT_MS).toBe(10 * 60_000);
      expect(modals.closedStopped).toBe(1);
      expect(notice).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("noticeOnceModalsClosed_justUnderTheCap_stillNotices", () => {
    jest.useFakeTimers();
    try {
      modals.open = true;
      const notice = jest.fn();

      noticeOnceModalsClosed(notice);
      jest.advanceTimersByTime(REFUSAL_NOTICE_MAX_WAIT_MS - 1);
      modals.open = false;
      modals.closedWatchers.forEach((watcher) => watcher());

      expect(notice).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("noticeOnceModalsClosed_secondRefusal_replacesTheFirstWatch", () => {
    jest.useFakeTimers();
    try {
      modals.open = true;
      const first = jest.fn();
      const second = jest.fn();

      noticeOnceModalsClosed(first);
      noticeOnceModalsClosed(second);
      modals.open = false;
      modals.closedWatchers.forEach((watcher) => watcher());

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
      expect(modals.closedStopped).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("noticeOnceModalsClosed_stoppedByCaller_neverNotices", () => {
    modals.open = true;
    const notice = jest.fn();

    const stop = noticeOnceModalsClosed(notice);
    stop();
    modals.open = false;
    modals.closedWatchers.forEach((watcher) => watcher());

    expect(notice).not.toHaveBeenCalled();
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

describe("saveNeverAgain (EF-23)", () => {
  it("saveNeverAgain_otherAccountRefusal_callsOnOtherAccount", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: CERTIFY_PROMPT_OTHER_ACCOUNT }), { status: 409 }));

    await saveNeverAgain(VIEWER_ID, onOtherAccount);

    expect(onOtherAccount).toHaveBeenCalledTimes(1);
  });

  it("saveNeverAgain_otherFailure_staysSilent", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "RATE_LIMITED" }), { status: 429 }));

    await saveNeverAgain(VIEWER_ID, onOtherAccount);

    expect(onOtherAccount).not.toHaveBeenCalled();
  });

  it("saveNeverAgain_bodyNotJson_staysSilent", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 502 }));

    await expect(saveNeverAgain(VIEWER_ID, onOtherAccount)).resolves.toBeUndefined();

    expect(onOtherAccount).not.toHaveBeenCalled();
  });

  it("saveNeverAgain_saved_staysSilent", async () => {
    await saveNeverAgain(VIEWER_ID, onOtherAccount);

    expect(neverAgainPosts()).toHaveLength(1);
    expect(onOtherAccount).not.toHaveBeenCalled();
  });

  it("saveNeverAgain_unknownViewer_sendsNothing", async () => {
    await saveNeverAgain(null, onOtherAccount);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
