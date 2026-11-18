import { describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { AccountMenuPanel } from "@/components/account-menu";
import { PlayerViewBanner } from "@/components/player-view";
import { requestPlayerView, takePlayerViewFocus } from "@/components/player-view-toggle";
import { ShellTextProvider } from "@/components/i18n/shell-text";
import { ToastProvider } from "@/components/ui/toast";
import { messagesFor } from "@/lib/server/i18n-messages";
import frShell from "@/messages/fr/shell.json";
import enShell from "@/messages/en/shell.json";
import { PLAYER_VIEW_MAX_HOURS, playerViewMenuMode, type PlayerViewMenuMode } from "@/lib/shared/player-view";
import { readSource } from "../helpers/read-source";

/** Vue joueur du staff, côté écran (`docs/features/ADMIN_PLAYER_VIEW.md`). */

const banner = (locale: "fr" | "en" = "fr") =>
  renderToStaticMarkup(
    <ShellTextProvider locale={locale} messages={locale === "en" ? messagesFor("en").shell : undefined}>
      <ToastProvider>
        <PlayerViewBanner />
      </ToastProvider>
    </ShellTextProvider>,
  );

const panel = (playerView: { mode: PlayerViewMenuMode; pending: boolean; toggle: () => void } | null) =>
  renderToStaticMarkup(
    <AccountMenuPanel
      id="compte"
      activeTeam={null}
      leaving={false}
      onNavigate={() => undefined}
      onLogout={() => undefined}
      playerView={playerView}
    />,
  );

describe("PlayerViewBanner", () => {
  it("PlayerViewBanner_french_saysStateAndOffersReturn", () => {
    const html = banner();

    expect(html).toContain("Vue joueur active");
    expect(html).toContain("Revenir en vue admin");
    expect(html).toContain('aria-label="Vue joueur"');
  });

  it("PlayerViewBanner_english_isTranslated", () => {
    const html = banner("en");

    expect(html).toContain("Player view on");
    expect(html).toContain("Back to admin view");
  });

  it("PlayerViewBanner_hint_interpolatesTheMaxHours", () => {
    expect(banner()).toContain(`au plus ${PLAYER_VIEW_MAX_HOURS} heures`);
    expect(banner("en")).toContain(`for ${PLAYER_VIEW_MAX_HOURS} hours at most`);
  });

  it("PlayerViewBanner_explanation_staysBehindInfoHint", () => {
    expect(banner()).toContain('aria-controls="player-view-hint"');
  });
});

describe("AccountMenuPanel — entrée vue joueur", () => {
  it("AccountMenuPanel_entryOffered_showsSwitchButton", () => {
    expect(panel({ mode: "enter", pending: false, toggle: () => undefined })).toContain("Passer en vue joueur");
  });

  it("AccountMenuPanel_playerViewActive_offersReturnToAdminView", () => {
    const html = panel({ mode: "back", pending: false, toggle: () => undefined });

    expect(html).toContain("Revenir en vue admin");
    expect(html).not.toContain("Passer en vue joueur");
  });

  it("AccountMenuPanel_returnPending_saysReturning", () => {
    expect(panel({ mode: "back", pending: true, toggle: () => undefined })).toContain("Retour en vue admin…");
  });

  it("AccountMenuPanel_entryPending_saysSwitching", () => {
    const html = panel({ mode: "enter", pending: true, toggle: () => undefined });

    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Passer en vue joueur<");
  });

  it("AccountMenuPanel_noEntry_hidesSwitchButton", () => {
    expect(panel(null)).not.toContain("vue joueur");
  });
});

describe("playerViewMenuMode", () => {
  it("playerViewMenuMode_playerViewOn_isBack", () => {
    expect(playerViewMenuMode({ playerView: true, playerViewAvailable: true })).toBe("back");
  });

  it("playerViewMenuMode_staffInAdminView_isEnter", () => {
    expect(playerViewMenuMode({ playerView: false, playerViewAvailable: true })).toBe("enter");
  });

  it("playerViewMenuMode_plainPlayer_isNull", () => {
    expect(playerViewMenuMode({ playerView: false, playerViewAvailable: false })).toBeNull();
  });
});

describe("takePlayerViewFocus", () => {
  it("takePlayerViewFocus_nothingPending_isFalse", () => {
    expect(takePlayerViewFocus("banner")).toBe(false);
    expect(takePlayerViewFocus("account")).toBe(false);
  });
});

describe("requestPlayerView", () => {
  it("requestPlayerView_success_postsJsonAndReturnsTrue", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(requestPlayerView(true, fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/auth/player-view",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ active: true }) }),
    );
  });

  it("requestPlayerView_refused_returnsFalse", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 403 }));

    await expect(requestPlayerView(false, fetchImpl)).resolves.toBe(false);
  });

  it("requestPlayerView_networkFailure_returnsFalseWithoutThrowing", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));

    await expect(requestPlayerView(true, fetchImpl)).resolves.toBe(false);
  });
});

describe("textes FR = EN", () => {
  it("shell_playerViewSection_hasSameKeysInBothLanguages", () => {
    expect(Object.keys(enShell.playerView).sort()).toEqual(Object.keys(frShell.playerView).sort());
  });

  it("shell_accountEntries_existInBothLanguages", () => {
    const keys = ["playerView", "playerViewPending", "playerViewFailed"] as const;
    expect(keys.filter((key) => !frShell.account[key] || !enShell.account[key])).toEqual([]);
  });
});

describe("câblage", () => {
  it("la mise en page racine pose la bannière en vue joueur seulement", () => {
    expect(readSource("app/layout.tsx")).toContain("{user?.playerView && <PlayerViewBanner />}");
  });

  it("bannerBundle_layoutLoadsItDynamically_accountMenuImportsOnlyTheToggle", () => {
    expect(readSource("app/layout.tsx")).toContain('dynamic(() => import("@/components/player-view")');
    expect(readSource("app/layout.tsx")).not.toMatch(/^import .* from "@\/components\/player-view";/m);
    expect(readSource("components/account-menu.tsx")).toContain('from "./player-view-toggle"');
    expect(readSource("components/account-menu.tsx")).not.toMatch(/from "\.\/player-view"/);
  });

});

describe("schéma", () => {
  it("player_view_until_declaredInCreateTableAndInRecentChanges", () => {
    expect(readSource("lib/server/database/schema/accounts.ts")).toMatch(/player_view_until DATETIME NULL/);
    expect(readSource("lib/server/database/recent-schema-changes.ts")).toContain(
      "ALTER TABLE bg_user_sessions ADD COLUMN player_view_until DATETIME NULL",
    );
  });
});
