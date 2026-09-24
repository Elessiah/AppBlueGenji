import { describe, expect, it } from "@jest/globals";
import {
  hasScrollableOverflow,
  SCROLL_OVERFLOW_TOLERANCE_PX,
  scrollAreaAccessibility,
  watchScrollOverflow,
  type ObservedScrollElement,
  type ScrollMetrics,
} from "@/lib/shared/scroll-overflow";

const fits: ScrollMetrics = { scrollWidth: 300, clientWidth: 300, scrollHeight: 120, clientHeight: 120 };

describe("hasScrollableOverflow", () => {
  it("ne voit rien à faire défiler quand le contenu tient", () => {
    expect(hasScrollableOverflow(fits)).toBe(false);
  });

  it("voit un débordement horizontal", () => {
    expect(hasScrollableOverflow({ ...fits, scrollWidth: 900 })).toBe(true);
  });

  it("voit un débordement vertical, quelle que soit l'orientation déclarée", () => {
    // `overflow-y: visible` à côté d'un `overflow-x: auto` est calculé `auto`.
    expect(hasScrollableOverflow({ ...fits, scrollHeight: 400 })).toBe(true);
  });

  it("ignore l'écart d'arrondi entre les deux mesures", () => {
    expect(hasScrollableOverflow({ ...fits, scrollWidth: 300 + SCROLL_OVERFLOW_TOLERANCE_PX })).toBe(false);
    expect(hasScrollableOverflow({ ...fits, scrollHeight: 120 + SCROLL_OVERFLOW_TOLERANCE_PX })).toBe(false);
  });

  it("compte un débordement juste au-delà de la tolérance", () => {
    expect(hasScrollableOverflow({ ...fits, scrollWidth: 302 })).toBe(true);
  });
});

describe("scrollAreaAccessibility", () => {
  it("fait d'une zone qui déborde une région nommée et focalisable", () => {
    expect(scrollAreaAccessibility({ overflowing: true, focused: false, ariaLabel: "Rondes" })).toEqual({
      tabIndex: 0,
      role: "region",
      "aria-label": "Rondes",
    });
  });

  it("garde une zone qui déborde focalisable même sans nom, mais sans rôle", () => {
    expect(scrollAreaAccessibility({ overflowing: true, focused: false })).toEqual({ tabIndex: 0 });
  });

  it("ne pose rien sur une zone qui ne déborde pas — ni arrêt, ni repère, ni nom", () => {
    expect(scrollAreaAccessibility({ overflowing: false, focused: false, ariaLabel: "Rondes" })).toEqual({});
  });

  it("ne retire pas le tabindex d'une zone qui a le focus", () => {
    // Sans quoi le focus repartirait en tête de document.
    expect(scrollAreaAccessibility({ overflowing: false, focused: true, ariaLabel: "Rondes" })).toEqual({
      tabIndex: 0,
      role: "region",
      "aria-label": "Rondes",
    });
  });
});

/** Élément factice : ses dimensions se règlent à la main. */
function fakeElement(metrics: ScrollMetrics, children: object[] = [{}]) {
  const element: ObservedScrollElement & { children: object[] } = { ...metrics, children };
  return element;
}

/** Observateurs factices, déclenchables à la main. */
function fakeEnvironment() {
  const resizes: { callback: () => void; observed: object[]; disconnected: boolean }[] = [];
  const mutations: { callback: () => void; observed: object[]; disconnected: boolean }[] = [];
  class FakeResize {
    record: (typeof resizes)[number];
    constructor(callback: () => void) {
      this.record = { callback, observed: [], disconnected: false };
      resizes.push(this.record);
    }
    observe(target: object) {
      this.record.observed.push(target);
    }
    disconnect() {
      this.record.observed = [];
      this.record.disconnected = true;
    }
  }
  class FakeMutation {
    record: (typeof mutations)[number];
    constructor(callback: () => void) {
      this.record = { callback, observed: [], disconnected: false };
      mutations.push(this.record);
    }
    observe(target: object) {
      this.record.observed.push(target);
    }
    disconnect() {
      this.record.disconnected = true;
    }
  }
  return { environment: { ResizeObserver: FakeResize, MutationObserver: FakeMutation }, resizes, mutations };
}

describe("watchScrollOverflow", () => {
  it("mesure dès l'abonnement", () => {
    const { environment } = fakeEnvironment();
    const calls: boolean[] = [];
    watchScrollOverflow(fakeElement(fits), (value) => calls.push(value), environment);
    expect(calls).toEqual([false]);
  });

  it("observe la zone et chacun de ses enfants", () => {
    const { environment, resizes } = fakeEnvironment();
    const first = {};
    const second = {};
    const element = fakeElement(fits, [first, second]);
    watchScrollOverflow(element, () => {}, environment);
    expect(resizes[0].observed).toEqual([element, first, second]);
  });

  it("remesure quand la zone ou un enfant change de taille", () => {
    const { environment, resizes } = fakeEnvironment();
    const element = fakeElement(fits);
    const calls: boolean[] = [];
    watchScrollOverflow(element, (value) => calls.push(value), environment);
    element.scrollWidth = 900; // une ronde de plus arrive par le flux
    resizes[0].callback();
    element.clientWidth = 1200; // la fenêtre s'agrandit
    resizes[0].callback();
    expect(calls).toEqual([false, true, false]);
  });

  it("observe un enfant apparu après coup", () => {
    const { environment, resizes, mutations } = fakeEnvironment();
    const element = fakeElement(fits, []);
    const calls: boolean[] = [];
    watchScrollOverflow(element, (value) => calls.push(value), environment);
    const late = {};
    element.children.push(late);
    element.scrollHeight = 500;
    mutations[0].callback();
    expect(resizes[0].observed).toEqual([element, late]);
    expect(calls).toEqual([false, true]);
  });

  it("ne suit que les enfants directs", () => {
    const { environment, mutations } = fakeEnvironment();
    const element = fakeElement(fits);
    watchScrollOverflow(element, () => {}, environment);
    expect(mutations[0].observed).toEqual([element]);
  });

  it("se désabonne au nettoyage", () => {
    const { environment, resizes, mutations } = fakeEnvironment();
    const stop = watchScrollOverflow(fakeElement(fits), () => {}, environment);
    stop();
    expect(resizes[0].disconnected).toBe(true);
    expect(mutations[0].disconnected).toBe(true);
  });

  it("ne mesure rien sans ResizeObserver : la zone garde son défaut prudent", () => {
    const calls: boolean[] = [];
    const stop = watchScrollOverflow(fakeElement({ ...fits }), (value) => calls.push(value), {});
    expect(calls).toEqual([]);
    expect(() => stop()).not.toThrow();
  });

  it("se passe de MutationObserver s'il manque", () => {
    const { environment, resizes } = fakeEnvironment();
    const calls: boolean[] = [];
    const stop = watchScrollOverflow(
      fakeElement(fits),
      (value) => calls.push(value),
      { ResizeObserver: environment.ResizeObserver },
    );
    expect(calls).toEqual([false]);
    stop();
    expect(resizes[0].disconnected).toBe(true);
  });
});
