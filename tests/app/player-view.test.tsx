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
import type { PlatformRole } from "@/lib/shared/permissions";
import { readSource } from "../helpers/read-source";

/** Incarnation d'un rôle, côté écran (`docs/features/ADMIN_ROLE_IMPERSONATION.md`). */

const banner = (locale: "fr" | "en" = "fr", roles: PlatformRole[] = []) =>
  renderToStaticMarkup(
    <ShellTextProvider locale={locale} messages={locale === "en" ? messagesFor("en").shell : undefined}>
      <ToastProvider>
        <PlayerViewBanner until={null} roles={roles} />
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
    expect(html).toContain('aria-label="Incarnation"');
  });

  it("PlayerViewBanner_frenchOneRole_namesItInTheSingular", () => {
    expect(banner("fr", ["ARBITRE"])).toContain("Rôle incarné : Arbitre");
  });

  it("PlayerViewBanner_frenchSeveralRoles_namesThemInThePlural", () => {
    expect(banner("fr", ["ARBITRE", "CASTER"])).toContain("Rôles incarnés : Arbitre, Caster");
  });

  it("PlayerViewBanner_englishOneRole_namesItInTheSingular", () => {
    expect(banner("en", ["ARBITRE"])).toContain("Impersonated role: Referee");
  });

  it("PlayerViewBanner_englishSeveralRoles_namesThemInThePlural", () => {
    expect(banner("en", ["ARBITRE", "CASTER"])).toContain("Impersonated roles: Referee, Caster");
  });

  it("PlayerViewBanner_english_labelsTheSectionNeutrally", () => {
    expect(banner("en")).toContain('aria-label="Impersonation"');
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

describe("AccountMenuPanel — entrée « Incarner un rôle »", () => {
  it("AccountMenuPanel_entryOffered_showsImpersonateButton", () => {
    expect(panel({ mode: "enter", pending: false, toggle: () => undefined })).toContain("Incarner un rôle");
  });

  it("AccountMenuPanel_playerViewActive_offersReturnToAdminView", () => {
    const html = panel({ mode: "back", pending: false, toggle: () => undefined });

    expect(html).toContain("Revenir en vue admin");
    expect(html).not.toContain("Incarner un rôle");
  });

  it("AccountMenuPanel_returnPending_saysReturning", () => {
    expect(panel({ mode: "back", pending: true, toggle: () => undefined })).toContain("Retour en vue admin…");
  });

  it("AccountMenuPanel_entryPending_staysBusyWithItsLabel", () => {
    const html = panel({ mode: "enter", pending: true, toggle: () => undefined });

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Incarner un rôle");
  });

  it("AccountMenuPanel_noEntry_hidesImpersonateButton", () => {
    const html = panel(null);

    expect(html).not.toContain("Incarner un rôle");
    expect(html).not.toContain("vue admin");
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
  it("requestPlayerView_success_postsJsonAndReturnsDone", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(requestPlayerView(true, [], fetchImpl)).resolves.toBe("done");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/auth/player-view",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ active: true, roles: [] }) }),
    );
  });

  it("requestPlayerView_enterWithRoles_postsTheRoles", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));

    await requestPlayerView(true, ["ARBITRE", "DEV"], fetchImpl);

    expect(fetchImpl.mock.calls[0][1]?.body).toBe(JSON.stringify({ active: true, roles: ["ARBITRE", "DEV"] }));
  });

  it("requestPlayerView_exit_postsNoRoles", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));

    await requestPlayerView(false, [], fetchImpl);

    expect(fetchImpl.mock.calls[0][1]?.body).toBe(JSON.stringify({ active: false }));
  });

  it("requestPlayerView_refused_returnsFailed", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 403 }));

    await expect(requestPlayerView(false, [], fetchImpl)).resolves.toBe("failed");
  });

  it("requestPlayerView_entryConflict_returnsConflict", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 409 }));

    await expect(requestPlayerView(true, ["CASTER"], fetchImpl)).resolves.toBe("conflict");
  });

  it("requestPlayerView_exitConflict_returnsFailed", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 409 }));

    await expect(requestPlayerView(false, [], fetchImpl)).resolves.toBe("failed");
  });

  it("requestPlayerView_networkFailure_returnsFailedWithoutThrowing", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));

    await expect(requestPlayerView(true, [], fetchImpl)).resolves.toBe("failed");
  });
});

describe("textes FR = EN", () => {
  it("shell_playerViewSection_hasSameKeysInBothLanguages", () => {
    expect(Object.keys(enShell.playerView).sort()).toEqual(Object.keys(frShell.playerView).sort());
  });

  it("shell_accountEntries_existInBothLanguages", () => {
    const keys = ["impersonate", "impersonateFailed"] as const;
    expect(keys.filter((key) => !frShell.account[key] || !enShell.account[key])).toEqual([]);
  });
});

describe("câblage", () => {
  it("la mise en page racine pose la bannière en vue joueur seulement", () => {
    expect(readSource("app/layout.tsx")).toContain(
      "{user?.playerView && <PlayerViewBanner until={user.playerViewUntil} roles={user.roles} />}",
    );
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

  it("impersonated_roles_json_declaredInCreateTableAndInRecentChanges", () => {
    expect(readSource("lib/server/database/schema/accounts.ts")).toMatch(/impersonated_roles_json VARCHAR\(255\) NULL/);
    expect(readSource("lib/server/database/recent-schema-changes.ts")).toContain(
      "ALTER TABLE bg_user_sessions ADD COLUMN impersonated_roles_json VARCHAR(255) NULL AFTER player_view_until",
    );
  });
});
