import { describe, expect, it, jest } from "@jest/globals";

jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: () => undefined,
    useRef: <T,>(initial: T) => ({ current: initial }),
    useMemo: <T,>(compute: () => T) => compute(),
  };
});
jest.mock("@/components/i18n/locale-navigation", () => ({ useLocaleRouter: () => ({ refresh: () => undefined }) }));
jest.mock("@/components/player-view-toggle", () => ({
  takePlayerViewFocus: () => false,
  usePlayerViewToggle: () => ({ pending: false, toggle: () => undefined }),
}));
jest.mock("@/components/i18n/shell-text", () => {
  const { shellText } = jest.requireActual<typeof import("@/lib/shared/shell-text")>("@/lib/shared/shell-text");
  return { useShellText: () => shellText("fr") };
});

import { renderToStaticMarkup } from "react-dom/server";
import { PlayerViewBanner } from "@/components/player-view";
import { IMPERSONABLE_ROLES } from "@/lib/shared/player-view";

describe("PlayerViewBanner — noms de rôles", () => {
  it("banner_everyImpersonableRole_isNamedNeverARawKey", () => {
    const html = renderToStaticMarkup(<PlayerViewBanner until={null} roles={[...IMPERSONABLE_ROLES]} />);

    expect(html).not.toContain("impersonate.roles");
    expect(html).toContain("Rôles incarnés : Arbitre, Caster, Prod, Community Manager, Recruteur, Développeur");
  });

  it("banner_noRole_saysPlayerView", () => {
    expect(renderToStaticMarkup(<PlayerViewBanner until={null} roles={[]} />)).toContain("Vue joueur active");
  });
});
