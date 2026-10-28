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
  it("envoie l'action et le compte à qui la fenêtre a été montrée, gardée au départ du document (EF-04)", async () => {
    const fetchSpy = respond(200, { action: "LATER" });
    await loadModule().answerCertifyPrompt("LATER", 7);
    expect(fetchSpy).toHaveBeenCalledWith("/api/profile/discord/certify-prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "LATER", userId: 7 }),
      keepalive: true,
    });
  });

  it("réponse écrite : annoncée aux autres onglets du même compte, pas à soi-même ; canal d'envoi refermé", async () => {
    const here = loadModule();
    const elsewhere = loadModule();
    const heard = jest.fn();
    const heardHere = jest.fn();
    elsewhere.onCertifyPromptAnsweredElsewhere(7, heard);
    here.onCertifyPromptAnsweredElsewhere(7, heardHere);
    respond(200, { action: "NEVER" });
    await here.answerCertifyPrompt("NEVER", 7);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heardHere).not.toHaveBeenCalled();
    // Restent ouverts : les deux canaux d'écoute, pas celui de l'envoi.
    expect(FakeChannel.open()).toHaveLength(2);
  });

  it("la réponse d'un autre compte (connecté entre-temps dans ce navigateur) ne ferme rien (EF-04)", async () => {
    const here = loadModule();
    const elsewhere = loadModule();
    const otherAccount = jest.fn();
    const sameAccount = jest.fn();
    elsewhere.onCertifyPromptAnsweredElsewhere(8, otherAccount);
    elsewhere.onCertifyPromptAnsweredElsewhere(7, sameAccount);
    respond(200, { action: "NEVER" });
    await here.answerCertifyPrompt("NEVER", 7);
    expect(otherAccount).not.toHaveBeenCalled();
    expect(sameAccount).toHaveBeenCalledTimes(1);
  });

  it("un message étranger sur le canal ne ferme rien (EF-04)", () => {
    const tab = loadModule();
    const heard = jest.fn();
    tab.onCertifyPromptAnsweredElsewhere(7, heard);
    const intruder = new FakeChannel("bg:certify-prompt");
    for (const data of [null, "answered", 1, {}, { type: "other", userId: 7, from: "x" }, { type: "answered", userId: "7", from: "x" }, { type: "answered", userId: 7 }]) {
      intruder.postMessage(data);
    }
    expect(heard).not.toHaveBeenCalled();
    intruder.postMessage({ type: "answered", userId: 7, from: "autre-onglet" });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("isAnsweredMessageFor : forme, compte et onglet vérifiés", () => {
    const { isAnsweredMessageFor } = loadModule();
    expect(isAnsweredMessageFor({ type: "answered", userId: 7, from: "a" }, 7, "b")).toBe(true);
    expect(isAnsweredMessageFor({ type: "answered", userId: 7, from: "b" }, 7, "b")).toBe(false);
    expect(isAnsweredMessageFor({ type: "answered", userId: 8, from: "a" }, 7, "b")).toBe(false);
    expect(isAnsweredMessageFor({ type: "answered", userId: 7, from: 3 }, 7, "b")).toBe(false);
    expect(isAnsweredMessageFor({ type: "ANSWERED", userId: 7, from: "a" }, 7, "b")).toBe(false);
    expect(isAnsweredMessageFor(undefined, 7, "b")).toBe(false);
  });

  it("écriture refusée : rien n'est annoncé, le code remonte", async () => {
    const here = loadModule();
    const heard = jest.fn();
    loadModule().onCertifyPromptAnsweredElsewhere(7, heard);
    respond(409, { error: "CERTIFY_PROMPT_OTHER_ACCOUNT" });
    await expect(here.answerCertifyPrompt("NEVER", 7)).rejects.toThrow("CERTIFY_PROMPT_OTHER_ACCOUNT");
    expect(heard).not.toHaveBeenCalled();
  });

  it("refus illisible : le statut HTTP remonte", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>", { status: 502 }));
    await expect(loadModule().answerCertifyPrompt("LATER", 7)).rejects.toThrow("HTTP 502");
  });

  it("un canal d'écoute partagé, fermé au dernier départ", async () => {
    const tab = loadModule();
    const first = jest.fn();
    const second = jest.fn();
    const stopFirst = tab.onCertifyPromptAnsweredElsewhere(7, first);
    const stopSecond = tab.onCertifyPromptAnsweredElsewhere(7, second);
    expect(FakeChannel.open()).toHaveLength(1);
    stopFirst();
    expect(FakeChannel.open()).toHaveLength(1);
    stopSecond();
    expect(FakeChannel.open()).toHaveLength(0);

    respond(200, { action: "LATER" });
    await loadModule().answerCertifyPrompt("LATER", 7);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("sans BroadcastChannel, rien ne casse", async () => {
    Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true, writable: true });
    const bare = loadModule();
    expect(bare.onCertifyPromptAnsweredElsewhere(7, jest.fn())()).toBeUndefined();
    respond(200, { action: "LATER" });
    await expect(bare.answerCertifyPrompt("LATER", 7)).resolves.toBeUndefined();
  });
});
