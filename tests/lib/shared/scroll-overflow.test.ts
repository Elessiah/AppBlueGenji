import { describe, expect, it } from "@jest/globals";
import {
  hasScrollableOverflow,
  isOwnFocusEvent,
  releasesFocus,
  SCROLL_OVERFLOW_TOLERANCE_PX,
  scrollAreaAccessibility,
  watchScrollOverflow,
  type MutationRecordLike,
  type ObservedScrollElement,
  type ScrollMetrics,
  type ScrollOverflowMeasure,
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

describe("isOwnFocusEvent / releasesFocus", () => {
  const zone = {};
  const button = {};

  it("ne retient que le focus posé sur la zone elle-même", () => {
    expect(isOwnFocusEvent({ target: zone, currentTarget: zone })).toBe(true);
    // Le focus d'un bouton contenu bouillonne jusqu'à la zone.
    expect(isOwnFocusEvent({ target: button, currentTarget: zone })).toBe(false);
  });

  it("libère le focus quand il part ailleurs", () => {
    expect(releasesFocus({ target: zone, currentTarget: zone, activeElement: button })).toBe(true);
  });

  it("ne le libère pas quand seule la fenêtre perd le focus", () => {
    // La zone reste alors l'élément actif et le retrouvera au retour.
    expect(releasesFocus({ target: zone, currentTarget: zone, activeElement: zone })).toBe(false);
  });

  it("ignore la perte de focus d'un enfant", () => {
    expect(releasesFocus({ target: button, currentTarget: zone, activeElement: null })).toBe(false);
  });
});

/** Nœud élément factice (`nodeType` 1), comme ceux que liste un `MutationRecord`. */
const elementNode = () => ({ nodeType: 1 });

/** Élément factice : ses dimensions se règlent à la main. */
function fakeElement(metrics: ScrollMetrics, children: object[] = [elementNode()]) {
  const element: ObservedScrollElement & { children: object[] } = { ...metrics, children };
  return element;
}

interface ObserverRecord<C> {
  callback: C;
  observed: { target: object; options?: MutationObserverInit }[];
  disconnected: boolean;
}

/** Navigateur factice : observateurs et évènements déclenchables à la main. */
function fakeEnvironment() {
  const resizes: ObserverRecord<() => void>[] = [];
  const mutations: ObserverRecord<(records: MutationRecordLike[]) => void>[] = [];
  const fontListeners = new Set<() => void>();
  class FakeResize {
    record: ObserverRecord<() => void>;
    constructor(callback: () => void) {
      this.record = { callback, observed: [], disconnected: false };
      resizes.push(this.record);
    }
    observe(target: object) {
      this.record.observed.push({ target });
    }
    unobserve(target: object) {
      this.record.observed = this.record.observed.filter((entry) => entry.target !== target);
    }
    disconnect() {
      this.record.observed = [];
      this.record.disconnected = true;
    }
  }
  class FakeMutation {
    record: ObserverRecord<(records: MutationRecordLike[]) => void>;
    constructor(callback: (records: MutationRecordLike[]) => void) {
      this.record = { callback, observed: [], disconnected: false };
      mutations.push(this.record);
    }
    observe(target: object, options: MutationObserverInit) {
      this.record.observed.push({ target, options });
    }
    disconnect() {
      this.record.disconnected = true;
    }
  }
  const root = {};
  let active: unknown = null;
  const fonts = {
    addEventListener: (_type: "loadingdone", listener: () => void) => {
      fontListeners.add(listener);
    },
    removeEventListener: (_type: "loadingdone", listener: () => void) => {
      fontListeners.delete(listener);
    },
  };
  return {
    environment: {
      ResizeObserver: FakeResize,
      MutationObserver: FakeMutation,
      root,
      fonts,
      activeElement: () => active,
    },
    resizes,
    mutations,
    root,
    fontListeners,
    setActive: (value: unknown) => {
      active = value;
    },
  };
}

const observedTargets = <C>(record: ObserverRecord<C>) => record.observed.map((entry) => entry.target);

const childList = (target: unknown, added: unknown[], removed: unknown[] = []): MutationRecordLike => ({
  type: "childList",
  target,
  addedNodes: added,
  removedNodes: removed,
});

describe("watchScrollOverflow", () => {
  it("mesure dès l'abonnement", () => {
    const { environment } = fakeEnvironment();
    const calls: ScrollOverflowMeasure[] = [];
    watchScrollOverflow(fakeElement(fits), (value) => calls.push(value), environment);
    expect(calls).toEqual([{ overflowing: false, active: false }]);
  });

  it("observe la taille de la zone et de chacun de ses enfants", () => {
    const { environment, resizes } = fakeEnvironment();
    const first = elementNode();
    const second = elementNode();
    const element = fakeElement(fits, [first, second]);
    watchScrollOverflow(element, () => {}, environment);
    expect(observedTargets(resizes[0])).toEqual([element, first, second]);
  });

  it("remesure quand la zone ou un enfant change de taille", () => {
    const { environment, resizes } = fakeEnvironment();
    const element = fakeElement(fits);
    const calls: boolean[] = [];
    watchScrollOverflow(element, ({ overflowing }) => calls.push(overflowing), environment);
    element.scrollWidth = 900; // une ronde de plus arrive par le flux
    resizes[0].callback();
    element.clientWidth = 1200; // la fenêtre s'agrandit
    resizes[0].callback();
    expect(calls).toEqual([false, true, false]);
  });

  it("suit tout le contenu, pas seulement les enfants directs", () => {
    // Les pistes d'une grille débordent de la grille sans que sa boîte bouge.
    const { environment, mutations } = fakeEnvironment();
    const element = fakeElement(fits);
    watchScrollOverflow(element, () => {}, environment);
    expect(mutations[0].observed).toEqual([
      { target: element, options: { childList: true, subtree: true, characterData: true, attributes: true } },
    ]);
  });

  it("remesure sur un changement profond du contenu", () => {
    const { environment, mutations } = fakeEnvironment();
    const element = fakeElement(fits);
    const calls: boolean[] = [];
    watchScrollOverflow(element, ({ overflowing }) => calls.push(overflowing), environment);
    element.scrollWidth = 640;
    mutations[0].callback([{ type: "characterData", target: {}, addedNodes: [], removedNodes: [] }]);
    expect(calls).toEqual([false, true]);
  });

  it("observe un enfant direct ajouté, oublie un enfant retiré", () => {
    const { environment, resizes, mutations } = fakeEnvironment();
    const early = elementNode();
    const element = fakeElement(fits, [early]);
    watchScrollOverflow(element, () => {}, environment);
    const late = elementNode();
    mutations[0].callback([childList(element, [late, { nodeType: 3 }], [early])]);
    expect(observedTargets(resizes[0])).toEqual([element, late]);
  });

  it("n'observe pas la taille des nœuds ajoutés plus profond", () => {
    const { environment, resizes, mutations } = fakeEnvironment();
    const element = fakeElement(fits, []);
    watchScrollOverflow(element, () => {}, environment);
    mutations[0].callback([childList(elementNode(), [elementNode()])]);
    expect(observedTargets(resizes[0])).toEqual([element]);
  });

  it("remesure quand un réglage d'accessibilité change sur <html>", () => {
    const { environment, mutations, root } = fakeEnvironment();
    const element = fakeElement(fits);
    const calls: boolean[] = [];
    watchScrollOverflow(element, ({ overflowing }) => calls.push(overflowing), environment);
    expect(mutations[1].observed).toEqual([
      { target: root, options: { attributes: true, attributeFilter: ["data-a11y"] } },
    ]);
    element.scrollWidth = 420; // « Espacement du texte » élargit le tableau
    mutations[1].callback([]);
    expect(calls).toEqual([false, true]);
  });

  it("remesure quand une police finit de charger", () => {
    const { environment, fontListeners } = fakeEnvironment();
    const element = fakeElement(fits);
    const calls: boolean[] = [];
    watchScrollOverflow(element, ({ overflowing }) => calls.push(overflowing), environment);
    element.scrollWidth = 360;
    for (const listener of fontListeners) listener();
    expect(calls).toEqual([false, true]);
  });

  it("dit si la zone est l'élément actif, même sans évènement de focus", () => {
    const { environment, resizes, setActive } = fakeEnvironment();
    const element = fakeElement(fits);
    const calls: ScrollOverflowMeasure[] = [];
    watchScrollOverflow(element, (value) => calls.push(value), environment);
    setActive(element); // focus() dans un onglet en arrière-plan
    resizes[0].callback();
    expect(calls.at(-1)).toEqual({ overflowing: false, active: true });
  });

  it("se désabonne de tout au nettoyage", () => {
    const { environment, resizes, mutations, fontListeners } = fakeEnvironment();
    const stop = watchScrollOverflow(fakeElement(fits), () => {}, environment);
    expect(fontListeners.size).toBe(1);
    stop();
    expect(resizes[0].disconnected).toBe(true);
    expect(mutations.every((record) => record.disconnected)).toBe(true);
    expect(fontListeners.size).toBe(0);
  });

  it("ne mesure rien sans ResizeObserver : la zone garde son défaut prudent", () => {
    const calls: ScrollOverflowMeasure[] = [];
    const stop = watchScrollOverflow(fakeElement(fits), (value) => calls.push(value), {});
    expect(calls).toEqual([]);
    expect(() => stop()).not.toThrow();
  });

  it("se passe de tout ce qui manque d'autre", () => {
    const { environment, resizes } = fakeEnvironment();
    const calls: ScrollOverflowMeasure[] = [];
    const stop = watchScrollOverflow(
      fakeElement(fits),
      (value) => calls.push(value),
      { ResizeObserver: environment.ResizeObserver },
    );
    expect(calls).toEqual([{ overflowing: false, active: false }]);
    stop();
    expect(resizes[0].disconnected).toBe(true);
  });
});

