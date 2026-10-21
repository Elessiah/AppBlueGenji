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
  constructor(readonly name: string) {
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const other of FakeChannel.all) if (other !== this && other.name === this.name) other.listeners.forEach((l) => l({ data }));
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
  it("encore due : rend le parcours, lu sans cache", async () => {
    const fetchSpy = respond(200, { prompt: { mode: "DIALOG", hasTag: false } });
    await expect(loadModule().recheckCertifyPrompt()).resolves.toEqual({ mode: "DIALOG", hasTag: false });
    expect(fetchSpy).toHaveBeenCalledWith("/api/profile/discord/certify-prompt", { cache: "no-store" });
  });

  it("plus due, refus, réponse illisible ou réseau coupé : null (fermée en cas de doute)", async () => {
    const { recheckCertifyPrompt } = loadModule();
    respond(200, { prompt: null });
    await expect(recheckCertifyPrompt()).resolves.toBeNull();
    respond(401, { error: "UNAUTHORIZED" });
    await expect(recheckCertifyPrompt()).resolves.toBeNull();
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(recheckCertifyPrompt()).resolves.toBeNull();
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    await expect(recheckCertifyPrompt()).resolves.toBeNull();
  });
});

describe("answerCertifyPrompt — annonce aux autres onglets", () => {
  it("réponse écrite : annoncée aux autres onglets, pas à soi-même", async () => {
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
  });

  it("écriture refusée : rien n'est annoncé, le code remonte", async () => {
    const here = loadModule();
    const heard = jest.fn();
    loadModule().onCertifyPromptAnsweredElsewhere(heard);
    respond(409, { error: "ACCOUNT_DELETED" });
    await expect(here.answerCertifyPrompt("NEVER")).rejects.toThrow("ACCOUNT_DELETED");
    expect(heard).not.toHaveBeenCalled();
  });

  it("désabonnement ; sans BroadcastChannel, rien ne casse", async () => {
    const here = loadModule();
    const heard = jest.fn();
    const stop = loadModule().onCertifyPromptAnsweredElsewhere(heard);
    stop();
    respond(200, { action: "LATER" });
    await here.answerCertifyPrompt("LATER");
    expect(heard).not.toHaveBeenCalled();

    Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true, writable: true });
    const bare = loadModule();
    expect(bare.onCertifyPromptAnsweredElsewhere(heard)()).toBeUndefined();
    await expect(bare.answerCertifyPrompt("LATER")).resolves.toBeUndefined();
  });
});
