import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientPowerState } from "@/lib/shared/hooks/useClientPower";
import { UNKNOWN_PROBE } from "@/lib/shared/client-power";

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
});
