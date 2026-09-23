import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientPowerState } from "@/lib/shared/hooks/useClientPower";
import { UNKNOWN_PROBE } from "@/lib/shared/client-power";
import { readSource } from "../helpers/read-source";

/**
 * Le témoin du régime de charge. Les effets ne tournent pas au rendu serveur :
 * on fournit l'état du magasin à la main, comme le navigateur le ferait.
 */
let state: ClientPowerState;

jest.mock("@/lib/shared/hooks/useClientPower", () => ({
  useClientPowerState: () => state,
  setIgnorePerformance: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ClientPowerBadge } = require("@/components/client-power-badge") as typeof import("@/components/client-power-badge");

const base = (overrides: Partial<ClientPowerState["input"]> = {}): ClientPowerState => ({
  input: { attention: "FOCUSED", matchFocus: false, ...overrides },
  probe: UNKNOWN_PROBE,
  limits: [],
  ignorePerformance: false,
});

describe("ClientPowerBadge", () => {
  beforeEach(() => {
    state = base();
  });

  it("ne dit rien en régime complet", () => {
    expect(renderToStaticMarkup(<ClientPowerBadge />)).toBe("");
  });

  it("ne dit rien onglet caché — personne ne le verrait", () => {
    state = base({ attention: "HIDDEN" });
    expect(renderToStaticMarkup(<ClientPowerBadge />)).toBe("");
  });

  it("annonce le mode éco d'une machine à la peine", () => {
    state = {
      ...base({ performanceLimited: true }),
      probe: { cores: 2, memoryGb: 4, frameIntervalMs: 33 },
      limits: ["LOW_CORES", "SLOW_FRAMES"],
    };
    const html = renderToStaticMarkup(<ClientPowerBadge />);
    expect(html).toContain("Mode éco");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-mode="eco"');
    // La description est au survol, le détail derrière le clic.
    expect(html).toMatch(/title="Animations décoratives/);
  });

  it("annonce le mode match", () => {
    state = base({ matchFocus: true });
    const html = renderToStaticMarkup(<ClientPowerBadge />);
    expect(html).toContain("Mode match");
    expect(html).toContain('data-mode="match"');
  });

  it("reste affiché, en régime complet, quand la détection est ignorée", () => {
    // Sans lui, la case qui défait ce choix serait introuvable.
    state = {
      ...base({ performanceLimited: false }),
      probe: { cores: 2, memoryGb: 2, frameIntervalMs: 16 },
      limits: ["LOW_CORES"],
      ignorePerformance: true,
    };
    const html = renderToStaticMarkup(<ClientPowerBadge />);
    expect(html).toContain("Mode complet");
    expect(html).toContain('data-mode="full"');
  });

  it("se tait sur un second écran sans autre raison", () => {
    state = base({ attention: "BACKGROUND" });
    expect(renderToStaticMarkup(<ClientPowerBadge />)).toBe("");
  });

  it("est un vrai bouton, nommé par son texte visible", () => {
    state = base({ reducedMotion: true });
    const html = renderToStaticMarkup(<ClientPowerBadge />);
    expect(html).toMatch(/<button type="button"[^>]*>.*Mode éco<\/button>/);
    expect(html).not.toContain("aria-label=");
  });

  it("passe devant les boutons flottants quand son panneau s'ouvre", () => {
    // Le panneau monte dans la zone du bouton « ? » (`.cta-float-help`, 100).
    const css = readSource("components/client-power-badge.module.css");
    const globals = readSource("app/globals.css");
    const rootZ = Number(/\.root \{[^}]*z-index: (\d+);/.exec(css)?.[1]);
    const fabZ = Number(/\.cta-float-help \{[^}]*z-index: (\d+);/.exec(globals)?.[1]);
    expect(fabZ).toBeGreaterThan(0);
    expect(rootZ).toBeGreaterThan(fabZ);
  });

  it("s'écarte du bouton « ? » quand celui-ci descend dans le coin, sur mobile", () => {
    // Même point de rupture des deux côtés : sans quoi une plage de largeurs
    // garderait le témoin à droite pendant que le bouton y descend.
    const css = readSource("components/client-power-badge.module.css");
    const globals = readSource("app/globals.css");
    const fabBreakpoint = /@media \(max-width: (\d+)px\) \{\s*\.cta-float-help \{/.exec(globals)?.[1];
    const badge = /@media \(max-width: (\d+)px\) \{\s*\.root \{([^}]*)\}/.exec(css);
    expect(fabBreakpoint).toBeDefined();
    expect(badge?.[1]).toBe(fabBreakpoint);
    expect(badge?.[2]).toContain("left: 50%;");
    expect(badge?.[2]).toContain("transform: translateX(-50%);");
  });

  it("referme son détail quand il disparaît, pour ne pas réapparaître ouvert", () => {
    // Sans DOM, les effets ne tournent pas : on tient l'effet lui-même, et son
    // ordre — il doit précéder le retour anticipé, faute de quoi il ne serait
    // jamais appelé une fois le témoin masqué.
    const source = readSource("components/client-power-badge.tsx");
    const reset = source.indexOf("if (!visible) setOpen(false);");
    const early = source.indexOf("if (!visible) return null;");
    expect(reset).toBeGreaterThan(0);
    expect(early).toBeGreaterThan(reset);
  });
});

