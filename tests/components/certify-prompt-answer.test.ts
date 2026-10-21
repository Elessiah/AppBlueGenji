import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * `components/discord/certify-prompt-answer.ts` : réponse à la proposition,
 * relecture avant ouverture (fermée en cas de doute), annonce aux autres onglets.
 */

type Listener = (event: { data: unknown }) => void;

/** Double de `BroadcastChannel` : un message ne revient jamais à l'objet qui le poste. */
class FakeChannel {
  static readonly all: FakeChannel[] = [];
  readonly listeners = new Set<Listener>();
  closed = false;
  constructor(readonly name: string) {
    FakeChannel.all.push(this);
  }
  static open(): FakeChannel[] {
    return FakeChannel.all.filter((channel) => !channel.closed);
  }
  postMessage(data: unknown) {
    for (const other of FakeChannel.open()) if (other !== this && other.name === this.name) other.listeners.forEach((l) => l({ data }));
  }
  close() {
    this.closed = true;
  }
  addEventListener(_type: "message", listener: Listener) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "message", listener: Listener) {
    this.listeners.delete(listener);
  }
}

type AnswerModule = typeof import("@/components/discord/certify-prompt-answer");

function loadModule(): AnswerModule {
  let loaded: AnswerModule | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<AnswerModule>("@/components/discord/certify-prompt-answer");
  });
  if (!loaded) throw new Error("module non chargé");
  return loaded;
}

function respond(status: number, body: unknown) {
  return jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

const original = globalThis.BroadcastChannel;

beforeEach(() => {
  FakeChannel.all.length = 0;
  Object.defineProperty(globalThis, "BroadcastChannel", { value: FakeChannel, configurable: true, writable: true });
});

afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(globalThis, "BroadcastChannel", { value: original, configurable: true, writable: true });
});

describe("recheckCertifyPrompt", () => {
  it("encore due : rend le parcours, lu sans cache, abandonnable", async () => {
    const fetchSpy = respond(200, { prompt: { mode: "DIALOG", hasTag: false } });
    const signal = new AbortController().signal;
    await expect(loadModule().recheckCertifyPrompt(signal)).resolves.toEqual({ prompt: { mode: "DIALOG", hasTag: false } });
    expect(fetchSpy).toHaveBeenCalledWith("/api/profile/discord/certify-prompt", { cache: "no-store", signal });
  });

  it("réponses tranchées : plus due, ou session close (401)", async () => {
    const { recheckCertifyPrompt } = loadModule();
    respond(200, { prompt: null });
    await expect(recheckCertifyPrompt()).resolves.toEqual({ prompt: null });
    respond(401, { error: "UNAUTHORIZED" });
    await expect(recheckCertifyPrompt()).resolves.toEqual({ prompt: null });
  });

  it("panne, réponse illisible, réseau coupé ou abandon : UNKNOWN", async () => {
    const { recheckCertifyPrompt } = loadModule();
    respond(500, { error: "CERTIFY_PROMPT_FAILED" });
    await expect(recheckCertifyPrompt()).resolves.toBe("UNKNOWN");
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(recheckCertifyPrompt()).resolves.toBe("UNKNOWN");
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    await expect(recheckCertifyPrompt()).resolves.toBe("UNKNOWN");
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(recheckCertifyPrompt()).resolves.toBe("UNKNOWN");
  });
});

describe("answerCertifyPrompt — annonce aux autres onglets", () => {
  it("réponse écrite : annoncée aux autres onglets, pas à soi-même ; canal d'envoi refermé", async () => {
    const here = loadModule();
    const elsewhere = loadModule();
    const heard = jest.fn();
    const heardHere = jest.fn();
    elsewhere.onCertifyPromptAnsweredElsewhere(heard);
    here.onCertifyPromptAnsweredElsewhere(heardHere);
    respond(200, { action: "NEVER" });
    await here.answerCertifyPrompt("NEVER");
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heardHere).not.toHaveBeenCalled();
    // Restent ouverts : les deux canaux d'écoute, pas celui de l'envoi.
    expect(FakeChannel.open()).toHaveLength(2);
  });

  it("écriture refusée : rien n'est annoncé, le code remonte", async () => {
    const here = loadModule();
    const heard = jest.fn();
    loadModule().onCertifyPromptAnsweredElsewhere(heard);
    respond(409, { error: "ACCOUNT_DELETED" });
    await expect(here.answerCertifyPrompt("NEVER")).rejects.toThrow("ACCOUNT_DELETED");
    expect(heard).not.toHaveBeenCalled();
  });

  it("un canal d'écoute partagé, fermé au dernier départ", async () => {
    const tab = loadModule();
    const first = jest.fn();
    const second = jest.fn();
    const stopFirst = tab.onCertifyPromptAnsweredElsewhere(first);
    const stopSecond = tab.onCertifyPromptAnsweredElsewhere(second);
    expect(FakeChannel.open()).toHaveLength(1);
    stopFirst();
    expect(FakeChannel.open()).toHaveLength(1);
    stopSecond();
    expect(FakeChannel.open()).toHaveLength(0);

    respond(200, { action: "LATER" });
    await loadModule().answerCertifyPrompt("LATER");
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("sans BroadcastChannel, rien ne casse", async () => {
    Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true, writable: true });
    const bare = loadModule();
    expect(bare.onCertifyPromptAnsweredElsewhere(jest.fn())()).toBeUndefined();
    respond(200, { action: "LATER" });
    await expect(bare.answerCertifyPrompt("LATER")).resolves.toBeUndefined();
  });
});
