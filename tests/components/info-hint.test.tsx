/**
 * Le bouton « i » (`components/ui/info-hint.tsx`, `docs/features/INFO_HINTS.md`) :
 * son balisage (rendu serveur), son nom accessible en français et en anglais,
 * et ses gestes — ouvrir, refermer au second clic, à Échap (focus rendu au
 * bouton), au clic ailleurs. Sans DOM dans les tests, le composant est joué
 * comme une fonction : `useState`, `useRef` et `useEffect` sont remplacés par
 * des cases relues à chaque « rendu ».
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const cells: unknown[] = [];
let cursor = 0;
const hooks = { live: false };
const cleanups: Array<() => void> = [];

jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: <T,>(initial: T) => {
      if (!hooks.live) return actual.useState(initial);
      const index = cursor++;
      if (!(index in cells)) cells[index] = initial;
      const set = (next: T | ((value: T) => T)) => {
        cells[index] = typeof next === "function" ? (next as (value: T) => T)(cells[index] as T) : next;
      };
      return [cells[index] as T, set];
    },
    useRef: <T,>(initial: T) => {
      if (!hooks.live) return actual.useRef(initial);
      const index = cursor++;
      if (!(index in cells)) cells[index] = { current: initial };
      return cells[index] as { current: T };
    },
    useEffect: (effect: () => void | (() => void)) => {
      if (!hooks.live) return actual.useEffect(effect);
      const cleanup = effect();
      if (cleanup) cleanups.push(cleanup);
    },
  };
});
const locale: { current: "fr" | "en" } = { current: "fr" };
jest.mock("@/components/i18n/locale-context", () => {
  const actual = jest.requireActual<typeof import("@/components/i18n/locale-context")>("@/components/i18n/locale-context");
  return { ...actual, useAppLocale: () => (hooks.live ? locale.current : actual.useAppLocale()) };
});

import { AudienceList, InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { infoHintLabel, infoHintReaction } from "@/lib/shared/info-hint";
import frCommon from "@/messages/fr/common.json";
import enCommon from "@/messages/en/common.json";
import { readSource } from "../helpers/read-source";

type Props = Record<string, unknown> & { children?: ReactNode };

/** Le premier élément de l'arbre qui satisfait `test` (profondeur d'abord). */
function find(node: ReactNode, test: (element: ReactElement<Props>) => boolean): ReactElement<Props> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, test);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement<Props>(node)) return null;
  if (test(node)) return node;
  return find(node.props.children, test);
}

/** Un « rendu » du composant, joué comme une fonction. */
function render(): { root: ReactElement<Props>; button: ReactElement<Props>; panel: ReactElement<Props> } {
  cursor = 0;
  while (cleanups.length > 0) cleanups.pop()?.();
  const root = InfoHint({ id: "hint-id", subject: "BattleTag", children: <p>Détail</p> }) as ReactElement<Props>;
  const button = find(root, (element) => element.type === "button");
  const panel = find(root, (element) => element.props.id === "hint-id");
  if (!button || !panel) throw new Error("balisage incomplet");
  return { root, button, panel };
}

const documentListeners: Record<string, Array<(event: unknown) => void>> = {};
const globals = globalThis as unknown as { document?: unknown; Node?: unknown };

beforeEach(() => {
  hooks.live = true;
  cells.length = 0;
  locale.current = "fr";
  for (const key of Object.keys(documentListeners)) delete documentListeners[key];
  globals.document = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      documentListeners[type] = [...(documentListeners[type] ?? []), listener];
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      documentListeners[type] = (documentListeners[type] ?? []).filter((entry) => entry !== listener);
    },
  };
  globals.Node = class {};
});

afterEach(() => {
  hooks.live = false;
  while (cleanups.length > 0) cleanups.pop()?.();
  delete globals.document;
  delete globals.Node;
});

describe("infoHintLabel", () => {
  it("nomme le bouton par ce qu'il explique, en français et en anglais", () => {
    expect(infoHintLabel("fr", "BattleTag Overwatch")).toBe("Plus d'infos : BattleTag Overwatch");
    expect(infoHintLabel("en", "Overwatch BattleTag")).toBe("More info: Overwatch BattleTag");
  });

  it("lit son gabarit dans l'espace `common`, présent dans les deux langues", () => {
    expect(frCommon.infoHint.label).toContain("{subject}");
    expect(enCommon.infoHint.label).toContain("{subject}");
  });
});

describe("infoHintReaction", () => {
  it("Échap referme et rend le focus ; les autres touches ne font rien", () => {
    expect(infoHintReaction({ kind: "key", key: "Escape" })).toBe("closeAndFocus");
    expect(infoHintReaction({ kind: "key", key: "Enter" })).toBe("keep");
    expect(infoHintReaction({ kind: "key", key: "Tab" })).toBe("keep");
  });

  it("un clic ailleurs referme, un clic dedans non", () => {
    expect(infoHintReaction({ kind: "outsideClick" })).toBe("close");
    expect(infoHintReaction({ kind: "insideClick" })).toBe("keep");
  });
});

describe("InfoHint — balisage", () => {
  beforeEach(() => {
    hooks.live = false;
  });

  it("rend un bouton de divulgation fermé, relié à son explication gardée dans le DOM", () => {
    const html = renderToStaticMarkup(
      <InfoHint id="profile-battletag-more" subject="BattleTag Overwatch">
        <p>Blizzard remplit ce champ.</p>
      </InfoHint>,
    );
    expect(html).toContain('<button type="button"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="profile-battletag-more"');
    expect(html).toContain('aria-label="Plus d&#x27;infos : BattleTag Overwatch"');
    // L'explication reste lisible des technologies d'assistance par son `id`.
    expect(html).toMatch(/<div id="profile-battletag-more" class="panel" hidden="">\s*<p>Blizzard remplit ce champ\.<\/p><\/div>/);
    // L'icône est décorative : le nom vient de `aria-label`.
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("se nomme en anglais sous une page anglaise", () => {
    const html = renderToStaticMarkup(
      <AppLocaleProvider locale="en">
        <InfoHint id="x" subject="Discord username">
          <p>Detail</p>
        </InfoHint>
      </AppLocaleProvider>,
    );
    expect(html).toContain('aria-label="More info: Discord username"');
  });

  it("pose la rangée et la liste « qui le voit »", () => {
    const html = renderToStaticMarkup(
      <InfoHintRow>
        <AudienceList lines={{ title: "Visible par :", items: ["les arbitres ;", "les administrateurs."], footer: "Personne d'autre." }} />
      </InfoHintRow>,
    );
    expect(html).toBe(
      '<div class="row"><p>Visible par :</p><ul><li>les arbitres ;</li><li>les administrateurs.</li></ul><p>Personne d&#x27;autre.</p></div>',
    );
  });
});

describe("InfoHint — gestes", () => {
  it("s'ouvre au clic et se referme au second clic", () => {
    let view = render();
    expect(view.button.props["aria-expanded"]).toBe(false);
    expect(view.panel.props.hidden).toBe(true);
    (view.button.props.onClick as () => void)();
    view = render();
    expect(view.button.props["aria-expanded"]).toBe(true);
    expect(view.panel.props.hidden).toBe(false);
    (view.button.props.onClick as () => void)();
    view = render();
    expect(view.button.props["aria-expanded"]).toBe(false);
    expect(view.panel.props.hidden).toBe(true);
  });

  it("se referme à Échap et rend le focus au bouton", () => {
    let view = render();
    (view.button.props.onClick as () => void)();
    view = render();
    const focus = jest.fn();
    const buttonRef = (view.button as unknown as { ref?: { current: unknown } }).ref;
    // Le bouton porte une référence : on y place un faux élément focalisable.
    expect(buttonRef).toBeDefined();
    if (buttonRef) buttonRef.current = { focus };
    const stopPropagation = jest.fn();
    (view.root.props.onKeyDown as (event: { key: string; stopPropagation: () => void }) => void)({ key: "Escape", stopPropagation });
    view = render();
    expect(view.button.props["aria-expanded"]).toBe(false);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("ignore Échap quand il est fermé : une modale ouverte garde le sien", () => {
    const view = render();
    const stopPropagation = jest.fn();
    (view.root.props.onKeyDown as (event: { key: string; stopPropagation: () => void }) => void)({ key: "Escape", stopPropagation });
    expect(stopPropagation).not.toHaveBeenCalled();
  });

  it("se referme au clic ailleurs, pas au clic dedans, et n'écoute que pendant qu'il est ouvert", () => {
    let view = render();
    expect(documentListeners.click ?? []).toHaveLength(0);
    (view.button.props.onClick as () => void)();
    view = render();
    expect(documentListeners.click).toHaveLength(1);
    const NodeClass = globals.Node as new () => object;
    const inside = new NodeClass();
    const outside = new NodeClass();
    const rootRef = (view.root as unknown as { ref: { current: unknown } }).ref;
    rootRef.current = { contains: (target: unknown) => target === inside };
    documentListeners.click[0]({ target: inside });
    view = render();
    expect(view.button.props["aria-expanded"]).toBe(true);
    documentListeners.click[0]({ target: outside });
    view = render();
    expect(view.button.props["aria-expanded"]).toBe(false);
    expect(documentListeners.click ?? []).toHaveLength(0);
  });
});

describe("InfoHint — feuille de style", () => {
  const css = readSource("components/ui/info-hint.module.css");

  it("offre une cible de 24 px au moins et un anneau de focus visible", () => {
    expect(css).toMatch(/\.trigger \{[^}]*inline-size: 24px;[^}]*block-size: 24px;/);
    expect(css).toMatch(/\.trigger:focus-visible \{[^}]*outline: 2px solid var\(--blue-500\);/);
  });

  it("n'emploie ni ambre ni animation, et garde un texte d'au moins 12 px", () => {
    expect(css).not.toMatch(/amber/);
    expect(css).not.toMatch(/animation|transition/);
    expect(css).toMatch(/\.panel \{[^}]*font-size: 12px;/);
  });

  it("ouvre l'explication dans le flux, jamais plus large que son conteneur", () => {
    expect(css).not.toMatch(/position: (absolute|fixed)/);
    expect(css).toMatch(/\.panel \{[^}]*flex: 0 0 100%;[^}]*box-sizing: border-box;/);
  });

  it("passe toujours sous le libellé : aucune largeur maximale sur le panneau lui-même", () => {
    // Une base de 100 % bornée par `max-inline-size` redevenait assez étroite
    // pour se loger à côté d'un libellé court dans une rangée large (bureau).
    const panelRule = /\n\.panel \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(panelRule).not.toMatch(/max-inline-size|max-width/);
    expect(css).toMatch(/\.panel > \* \{[^}]*max-inline-size: 68ch;/);
  });
});
