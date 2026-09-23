import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Titre d'onglet d'appel (`_lib/attention.ts`). Jest tourne sous Node : on
 * fournit un `document` et un `window` minimaux, écouteurs compris, pour jouer
 * la perte et le retour du focus.
 */

type Listener = () => void;

function fakeTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, fn: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
    },
    fire(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

let focused = false;
const doc = Object.assign(fakeTarget(), {
  title: "Coupe · BlueGenji",
  visibilityState: "visible",
  hasFocus: () => focused,
});
const win = fakeTarget();

const g = globalThis as unknown as { document: unknown; window: unknown };

let attention: typeof import("@/app/(secured)/tournois/[id]/_lib/attention");

beforeEach(() => {
  g.document = doc;
  g.window = win;
  focused = false;
  doc.title = "Coupe · BlueGenji";
  jestIsolate();
});

afterEach(() => {
  attention.clearAttention();
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).window;
});

function jestIsolate() {
  // Le module garde son état (titre d'origine) : un module neuf par cas.
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    attention = require("@/app/(secured)/tournois/[id]/_lib/attention");
  });
}

describe("titre d'onglet d'appel", () => {
  it("préfixe le titre quand la page n'a pas le focus", () => {
    attention.raiseAttention("MATCH_READY");
    expect(doc.title).toBe("● Ton match est prêt · Coupe · BlueGenji");
  });

  it("ne touche à rien quand le lecteur regarde la page", () => {
    focused = true;
    attention.raiseAttention("MATCH_READY");
    expect(doc.title).toBe("Coupe · BlueGenji");
  });

  it("remet le titre d'origine au retour du focus, et cesse d'écouter", () => {
    attention.raiseAttention("SCORE_TO_CONFIRM");
    focused = true;
    win.fire("focus");
    expect(doc.title).toBe("Coupe · BlueGenji");
    expect(win.count("focus")).toBe(0);
    expect(doc.count("visibilitychange")).toBe(0);
  });

  it("garde le titre d'origine d'un appel à l'autre", () => {
    attention.raiseAttention("ROUND_STARTED");
    attention.raiseAttention("MATCH_READY");
    expect(doc.title).toBe("● Ton match est prêt · Coupe · BlueGenji");
    attention.clearAttention();
    expect(doc.title).toBe("Coupe · BlueGenji");
  });

  it("n'écrase pas le titre d'une autre page au démontage", () => {
    attention.raiseAttention("MATCH_READY");
    // Navigation : la page suivante a posé son titre.
    doc.title = "Équipes · BlueGenji";
    attention.clearAttention();
    expect(doc.title).toBe("Équipes · BlueGenji");
  });

  it("prend pour base un titre réécrit entre deux appels", () => {
    attention.raiseAttention("MATCH_READY");
    doc.title = "Autre tournoi · BlueGenji";
    attention.raiseAttention("ROUND_STARTED");
    expect(doc.title).toBe("● Nouvelle manche · Autre tournoi · BlueGenji");
    attention.clearAttention();
    expect(doc.title).toBe("Autre tournoi · BlueGenji");
  });
});
