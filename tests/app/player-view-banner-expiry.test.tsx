import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Échéance de la vue joueur côté bannière (`docs/features/ADMIN_ROLE_IMPERSONATION.md`) :
 * à `until` (plus la marge), la page est relue — les droits sont revenus et la
 * bannière s'efface. Joué sans DOM : la bannière est appelée comme une
 * fonction, ses effets recueillis puis joués à la main.
 */
type Effect = () => void | (() => void);
const effects: Effect[] = [];
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (effect: Effect) => {
      effects.push(effect);
    },
    useRef: <T,>(initial: T) => ({ current: initial }),
  };
});

const refresh = jest.fn<() => void>();
jest.mock("@/components/i18n/locale-navigation", () => ({ useLocaleRouter: () => ({ refresh }) }));
jest.mock("@/components/i18n/shell-text", () => ({ useShellText: () => ({ t: (key: string) => key }) }));
jest.mock("@/components/player-view-toggle", () => ({
  takePlayerViewFocus: () => false,
  usePlayerViewToggle: () => ({ pending: false, toggle: () => undefined }),
}));

import { PlayerViewBanner } from "@/components/player-view";
import { PLAYER_VIEW_EXPIRY_MARGIN_MS } from "@/lib/shared/player-view";

const NOW = Date.parse("2026-11-18T10:00:00.000Z");
const UNTIL = "2026-11-18T11:00:00.000Z";

/** Rend la bannière et joue ses effets ; rend leurs nettoyages. */
function mount(until: string | null): (() => void)[] {
  effects.length = 0;
  PlayerViewBanner({ until });
  return effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => typeof cleanup === "function");
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  refresh.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("PlayerViewBanner — échéance", () => {
  it("PlayerViewBanner_untilReached_callsRouterRefresh", () => {
    mount(UNTIL);

    jest.advanceTimersByTime(60 * 60_000 + PLAYER_VIEW_EXPIRY_MARGIN_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("PlayerViewBanner_unmountedBeforeUntil_noRefresh", () => {
    const cleanups = mount(UNTIL);

    cleanups.forEach((cleanup) => cleanup());
    jest.advanceTimersByTime(2 * 60 * 60_000);

    expect(refresh).not.toHaveBeenCalled();
  });

  it("PlayerViewBanner_noUntil_noRefresh", () => {
    mount(null);

    jest.advanceTimersByTime(24 * 60 * 60_000);

    expect(refresh).not.toHaveBeenCalled();
  });
});
