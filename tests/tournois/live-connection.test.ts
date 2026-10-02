import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  openLiveConnection,
  type LiveConnection,
  type LiveConnectionOptions,
} from "@/app/(secured)/tournois/[id]/_lib/live-connection";
import {
  FIRST_SNAPSHOT_TIMEOUT_MS,
  type LiveFailure,
  type LiveMessage,
} from "@/app/(secured)/tournois/[id]/_lib/live-state";
import { FOCUS_REFRESH_MIN_INTERVAL_MS } from "@/lib/shared/refresh-tiers";

/**
 * Connexion au flux d'un tournoi (`_lib/live-connection.ts`), jouée sans DOM :
 * un faux `EventSource`, un faux `document` et des minuteurs simulés.
 * Tient les filets de `docs/features/REALTIME_REFRESH.md` — reconnexion sans
 * abandon, échec définitif, retour sur l'onglet, sondage de secours, guet du
 * premier instantané — et le palier spectateur (`?quiet=1`).
 */

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

const latest = () => FakeEventSource.instances.at(-1)!;

type FakeDocument = EventTarget & { visibilityState: "visible" | "hidden" };

let doc: FakeDocument;
let win: EventTarget;
let connection: LiveConnection | null = null;

const SNAPSHOT = JSON.stringify({
  type: "snapshot",
  tournamentId: 7,
  version: "v2",
  snapshot: { id: 7, version: "v2" },
});

type Harness = {
  options: LiveConnectionOptions;
  load: jest.Mock<(silent: boolean) => Promise<LiveFailure | null>>;
  onMessage: jest.Mock<(message: LiveMessage) => void>;
  onLiveChange: jest.Mock<(live: boolean) => void>;
  onFatal: jest.Mock<(failure: LiveFailure) => void>;
  state: { detail: boolean; quiet: boolean; lastUpdateAt: number; lastFetchAt: number };
};

function open(loadResult: LiveFailure | null = null): Harness {
  const state = { detail: false, quiet: false, lastUpdateAt: 0, lastFetchAt: 0 };
  const load = jest.fn<(silent: boolean) => Promise<LiveFailure | null>>(async () => loadResult);
  const onMessage = jest.fn<(message: LiveMessage) => void>();
  const onLiveChange = jest.fn<(live: boolean) => void>();
  const onFatal = jest.fn<(failure: LiveFailure) => void>();
  const options: LiveConnectionOptions = {
    tournamentId: 7,
    quiet: () => state.quiet,
    hasDetail: () => state.detail,
    fallbackPeriodMs: () => 30_000,
    lastUpdateAt: () => state.lastUpdateAt,
    lastFetchAt: () => state.lastFetchAt,
    load,
    onMessage,
    onLiveChange,
    onFatal,
  };
  connection = openLiveConnection(options);
  return { options, load, onMessage, onLiveChange, onFatal, state };
}

/** Laisse les promesses de `load` se résoudre. */
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Math, "random").mockReturnValue(1);
  FakeEventSource.instances = [];
  doc = Object.assign(new EventTarget(), { visibilityState: "visible" as const });
  win = new EventTarget();
  Object.assign(globalThis, { EventSource: FakeEventSource, document: doc, window: win });
});

afterEach(() => {
  connection?.close();
  connection = null;
  jest.useRealTimers();
  jest.restoreAllMocks();
  for (const key of ["EventSource", "document", "window"]) {
    Reflect.deleteProperty(globalThis, key);
  }
});

describe("ouverture du flux", () => {
  it("ouvre le flux du tournoi au palier normal", () => {
    open();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(latest().url).toBe("/api/tournaments/7/stream");
  });

  it("ouvre au palier spectateur quand le flux est déclassé", () => {
    const { state } = open();
    state.quiet = true;
    connection!.reconnect();
    expect(latest().url).toBe("/api/tournaments/7/stream?quiet=1");
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("transmet les messages exploitables et ignore les autres", () => {
    const { onMessage, onLiveChange } = open();
    latest().onmessage!({ data: "pas du json" });
    expect(onMessage).not.toHaveBeenCalled();
    latest().onmessage!({ data: SNAPSHOT });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0]).toMatchObject({ type: "snapshot", version: "v2" });
    expect(onLiveChange).toHaveBeenLastCalledWith(true);
  });
});

describe("reconnexion sans abandon", () => {
  it("retente indéfiniment, avec une attente qui croît puis repart à zéro à l'ouverture", async () => {
    const { onLiveChange, load } = open();
    latest().onerror!();
    expect(onLiveChange).toHaveBeenLastCalledWith(false);
    // Page vide : lecture REST tout de suite, bruyante au premier échec.
    expect(load).toHaveBeenCalledWith(false);

    jest.advanceTimersByTime(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    latest().onerror!();
    // Deuxième essai : lecture silencieuse, attente doublée.
    expect(load).toHaveBeenLastCalledWith(true);
    jest.advanceTimersByTime(1_999);
    expect(FakeEventSource.instances).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(3);

    for (let i = 0; i < 20; i += 1) {
      latest().onerror!();
      jest.advanceTimersByTime(60_000);
    }
    expect(FakeEventSource.instances).toHaveLength(23);

    latest().onopen!();
    latest().onerror!();
    jest.advanceTimersByTime(1_000);
    expect(FakeEventSource.instances).toHaveLength(24);
    await settle();
  });

  it("ne relit pas par REST une page déjà remplie", () => {
    const { state, load } = open();
    state.detail = true;
    latest().onerror!();
    expect(load).not.toHaveBeenCalled();
  });

  it("s'arrête sur un échec définitif et le dit", async () => {
    const { onFatal, onLiveChange } = open("UNAUTHORIZED");
    latest().onerror!();
    await settle();
    expect(onFatal).toHaveBeenCalledWith("UNAUTHORIZED");
    expect(onLiveChange).toHaveBeenLastCalledWith(false);
    jest.advanceTimersByTime(600_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    connection!.reconnect();
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});

describe("sondage de secours", () => {
  it("sonde tant que le flux est coupé, jamais onglet caché, et cesse au retour du flux", async () => {
    const { state, load } = open();
    state.detail = true;
    latest().onerror!();

    jest.advanceTimersByTime(500);
    // La reconnexion (1 s) n'est pas encore partie ; le sondage (30 s) non plus.
    expect(load).not.toHaveBeenCalled();
    latest().onerror!();
    jest.advanceTimersByTime(30_000);
    expect(load).toHaveBeenCalledWith(true);
    const polls = load.mock.calls.length;

    doc.visibilityState = "hidden";
    jest.advanceTimersByTime(30_000);
    expect(load.mock.calls).toHaveLength(polls);

    doc.visibilityState = "visible";
    latest().onopen!();
    jest.advanceTimersByTime(120_000);
    expect(load.mock.calls).toHaveLength(polls);
    await settle();
  });
});

describe("premier instantané", () => {
  it("passé le délai, lit par REST et sonde en secours sans fermer le flux", async () => {
    const { load, onLiveChange } = open();
    latest().onopen!();
    expect(onLiveChange).toHaveBeenLastCalledWith(true);

    jest.advanceTimersByTime(FIRST_SNAPSHOT_TIMEOUT_MS - 1);
    expect(load).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onLiveChange).toHaveBeenLastCalledWith(false);
    expect(load).toHaveBeenCalledWith(true);
    expect(latest().closed).toBe(false);

    jest.advanceTimersByTime(30_000);
    expect(load).toHaveBeenCalledTimes(2);

    // Un premier message tardif coupe le sondage.
    latest().onmessage!({ data: SNAPSHOT });
    jest.advanceTimersByTime(120_000);
    expect(load).toHaveBeenCalledTimes(2);
    await settle();
  });

  it("n'arme aucun guet quand la page a déjà sa donnée", () => {
    const { state, load } = open();
    state.detail = true;
    latest().onopen!();
    jest.advanceTimersByTime(FIRST_SNAPSHOT_TIMEOUT_MS * 2);
    expect(load).not.toHaveBeenCalled();
  });

  it("aucun guet ne survit à un message, une erreur, une reconnexion ou à la fermeture", () => {
    for (const end of ["message", "error", "reconnect", "close"] as const) {
      FakeEventSource.instances = [];
      const { state, load } = open();
      state.detail = end === "error"; // l'erreur ne relit pas une page remplie
      latest().onopen!();
      if (end === "message") latest().onmessage!({ data: SNAPSHOT });
      if (end === "error") latest().onerror!();
      if (end === "reconnect") connection!.reconnect();
      if (end === "close") {
        connection!.close();
        connection = null;
      }
      state.detail = false;
      jest.advanceTimersByTime(FIRST_SNAPSHOT_TIMEOUT_MS);
      expect(load).not.toHaveBeenCalled();
      connection?.close();
      connection = null;
    }
  });
});

describe("retour sur l'onglet", () => {
  it("relit une donnée vieillie et retente tout de suite, flux coupé", () => {
    const { state, load } = open();
    state.detail = true;
    latest().onerror!();
    jest.setSystemTime(Date.now() + FOCUS_REFRESH_MIN_INTERVAL_MS + 1);

    doc.dispatchEvent(new Event("visibilitychange"));
    expect(load).toHaveBeenCalledWith(true);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("ne relit rien par-dessus un flux vivant", () => {
    const { load } = open();
    latest().onopen!();
    jest.setSystemTime(Date.now() + FOCUS_REFRESH_MIN_INTERVAL_MS + 1);
    win.dispatchEvent(new Event("online"));
    expect(load).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("ne relit pas une donnée fraîche ou tout juste lue", () => {
    const { state, load } = open();
    state.detail = true;
    latest().onerror!();
    state.lastUpdateAt = Date.now();
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(load).not.toHaveBeenCalled();

    state.lastUpdateAt = 0;
    state.lastFetchAt = Date.now();
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(load).not.toHaveBeenCalled();
  });

  it("ignore un onglet qui reste caché", () => {
    const { state, load } = open();
    state.detail = true;
    latest().onerror!();
    jest.setSystemTime(Date.now() + FOCUS_REFRESH_MIN_INTERVAL_MS + 1);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(load).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});

describe("fermeture", () => {
  it("libère le flux, les minuteurs et les écouteurs", () => {
    const { state, load, onLiveChange } = open();
    state.detail = true;
    latest().onerror!();
    connection!.close();
    connection = null;
    expect(onLiveChange).toHaveBeenLastCalledWith(false);

    jest.advanceTimersByTime(600_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(load).not.toHaveBeenCalled();

    jest.setSystemTime(Date.now() + FOCUS_REFRESH_MIN_INTERVAL_MS + 1);
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("online"));
    expect(load).not.toHaveBeenCalled();
  });

  it("ferme le flux ouvert", () => {
    open();
    const source = latest();
    connection!.close();
    connection = null;
    expect(source.closed).toBe(true);
  });
});
