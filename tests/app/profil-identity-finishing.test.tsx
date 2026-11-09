/**
 * PROFILE-IDENTITY-UX 2 — finitions des identités liées : repère vers le champ
 * BattleTag, pastille annoncée une fois, lecture en panne avec « Réessayer »,
 * envoi des fenêtres gardé, vocabulaire « Lier / Lié », gestes refusés dits.
 */
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/app/(secured)/profil/OtherSessionsPanel", () => ({
  OtherSessionsPanel: () => <div data-testid="sessions" />,
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectedAppsSection, type IdentityContext } from "@/app/(secured)/profil/ConnectedAppsSection";
import { ToastProvider } from "@/components/ui/toast";
import type { AccountConnection } from "@/lib/shared/account-connections";
import { roleChangeTone } from "@/lib/shared/permissions";
import { takeSubmit } from "@/lib/shared/take-submit";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
type Bundle = { [key: string]: Bundle | string };
const messages = (lang: "fr" | "en") => JSON.parse(read(`messages/${lang}/profile.json`)) as Bundle;

const IDENTITY: IdentityContext = {
  discordKnown: true,
  discordHasTag: false,
  discordVerified: false,
  battletagKnown: true,
  battletagFromBlizzard: false,
  onCertifyDiscord: () => undefined,
  discordReadFailed: false,
  discordReading: false,
  onRetryDiscord: () => undefined,
};

function render(connections: AccountConnection[] | null, identity = IDENTITY, failed = false): string {
  return renderToStaticMarkup(
    <ToastProvider>
      <ConnectedAppsSection
        identity={identity}
        connections={connections}
        connectionsFailed={failed}
        reload={async () => undefined}
      />
    </ToastProvider>,
  );
}

const google: AccountConnection = { provider: "GOOGLE", linked: true, method: null, handle: null };
const blizzard = (linked: boolean): AccountConnection => ({ provider: "BLIZZARD", linked, method: null, handle: null });
const discord = (linked: boolean): AccountConnection => ({
  provider: "DISCORD",
  linked,
  method: "OAUTH",
  handle: linked ? "Tag#1" : null,
});

describe("repère vers le champ BattleTag", () => {
  it("connectedApps_blizzardLinkedWithoutTag_offersEnterBattletagButton", () => {
    expect(render([google, blizzard(true)])).toContain("Saisir mon BattleTag");
  });

  it("connectedApps_blizzardLinkedWithTag_offersNoPointer", () => {
    const html = render([google, blizzard(true)], { ...IDENTITY, battletagFromBlizzard: true });
    expect(html).not.toContain("Saisir mon BattleTag");
  });

  it("connectedApps_blizzardNotLinked_offersNoPointer", () => {
    expect(render([google, blizzard(false)])).not.toContain("Saisir mon BattleTag");
  });

  it("connectedApps_profileUnread_offersNoPointer", () => {
    expect(render([google, blizzard(true)], { ...IDENTITY, battletagKnown: false })).not.toContain("Saisir mon BattleTag");
  });
});

describe("pastille d'état", () => {
  it("connectedApps_statePill_isNeitherLiveRegionNorFocusTarget", () => {
    const html = render([google, discord(true)]);
    const pill = html.match(/<span class="pill[^>]*id="connection-state-discord"[^>]*>/)?.[0] ?? "";
    expect(pill).not.toBe("");
    expect(pill).not.toContain("role=");
    expect(pill).not.toContain("tabindex");
    expect(html).toContain('id="connection-state-discord"');
    // L'état reste lu une fois, par la description des boutons de la ligne.
    expect(html).toMatch(/aria-describedby="connection-state-discord connection-details-discord"/);
  });
});

describe("lecture en panne", () => {
  it("connectedApps_listUnreadNoFailure_saysLoadingWithoutRetry", () => {
    const html = render(null);
    expect(html).toContain("Chargement…");
    expect(html).not.toContain("Réessayer");
  });

  it("connectedApps_listFailed_saysItAndOffersRetry", () => {
    const html = render(null, IDENTITY, true);
    expect(html).toContain("Tes comptes liés n&#x27;ont pas pu être lus.");
    expect(html).toContain('aria-label="Réessayer de lire mes comptes liés"');
    expect(html).not.toContain("Chargement…");
  });

  it("connectedApps_discordReadFailed_rowOffersRetry", () => {
    const html = render([google, discord(true)], { ...IDENTITY, discordKnown: false, discordReadFailed: true });
    expect(html).toContain('aria-label="Réessayer la lecture de l&#x27;état Discord"');
  });

  it("connectedApps_discordReading_retryIsAriaDisabledAndLabelled", () => {
    const html = render([google, discord(true)], {
      ...IDENTITY,
      discordKnown: false,
      discordReadFailed: true,
      discordReading: true,
    });
    expect(html).toContain("Lecture…");
    expect(html).toContain('aria-disabled="true"');
  });

  it("connectedApps_discordKnown_noRetryOnRow", () => {
    expect(render([google, discord(true)], { ...IDENTITY, discordReadFailed: true })).not.toContain(
      "Réessayer la lecture",
    );
  });

  it("hooks_failedReads_toastAndKeepFlag", () => {
    expect(read("app/(secured)/profil/useAccountConnections.ts")).toContain(
      'latest.current.showError(latest.current.text.t("connections.loadFailed"))',
    );
    const page = read("app/(secured)/profil/page.tsx");
    expect(page).toContain('showError(t("discord.readFailed"))');
    expect(page).toContain("setDiscordReadFailed(false)");
  });
});

describe("envoi des fenêtres", () => {
  it("takeSubmit_event_preventsDefaultAndStopsBubbling", () => {
    const calls: string[] = [];
    takeSubmit({ preventDefault: () => calls.push("prevent"), stopPropagation: () => calls.push("stop") });
    expect(calls).toEqual(["prevent", "stop"]);
  });

  it.each(["DiscordBotHandleDialog", "DiscordVerificationDialog"])(
    "dialog_%s_everySubmitHandlerTakesTheSubmit",
    (name) => {
      const src = read(`app/(secured)/profil/${name}.tsx`);
      const handlers = src.match(/const \w+ = async \(event: FormEvent\) => \{\r?\n/g) ?? [];
      expect(handlers.length).toBeGreaterThan(0);
      expect(src.match(/takeSubmit\(event\)/g)?.length).toBe(handlers.length);
      expect(src).not.toContain("event.preventDefault()");
    },
  );

  it.each([
    "app/(secured)/profil/ConnectedAppsSection.tsx",
    "app/(secured)/profil/OtherSessionsPanel.tsx",
  ])("%s_everyButton_declaresItsType", (file) => {
    const buttons = read(file).match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const tag of buttons) expect(tag).toMatch(/\btype=/);
  });
});

describe("vocabulaire Lier / Lié", () => {
  it("frenchProfile_noAttachWordingLeft_exceptDeletionSentence", () => {
    const lines = read("messages/fr/profile.json")
      .split("\n")
      .filter((line) => /rattach/i.test(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("ACCOUNT_STILL_REFERENCED");
  });

  it("frenchSharedTexts_connectionsLines_useLinkWording", () => {
    for (const file of [
      "lib/shared/account-connections.ts",
      "lib/shared/discord-tag-lock.ts",
      "lib/shared/battletag-lock.ts",
      "lib/shared/identity-sharing.ts",
    ]) {
      const literals = read(file)
        .split("\n")
        .filter((line) => /rattach/i.test(line) && /["'`]/.test(line) && !/^\s*(\*|\/\/|\/\*)/.test(line));
      expect(literals).toEqual([]);
    }
  });

  it("newKeys_existInFrenchAndEnglish", () => {
    const keys = [
      ["connections", "battletagPointer"],
      ["connections", "loadFailed"],
      ["connections", "retry"],
      ["connections", "retryLabel"],
      ["connections", "reading"],
      ["connections", "sessions", "none"],
      ["discord", "readFailed"],
      ["invitations", "gone"],
      ["invitations", "loadFailed"],
      ["connections", "battletagPointerMissing"],
      ["platformRoles", "nothingToSave"],
    ];
    for (const lang of ["fr", "en"] as const) {
      const bundle = messages(lang);
      for (const path of keys) {
        let node: Bundle | string | undefined = bundle;
        for (const key of path) node = typeof node === "object" ? node[key] : undefined;
        expect(typeof node).toBe("string");
        expect((node as string).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("gestes refusés et reliquats du profil", () => {
  it("otherSessionsPanel_nothingToClose_activationSaysSo", () => {
    const src = read("app/(secured)/profil/OtherSessionsPanel.tsx");
    expect(src).toContain('showError(text.t("connections.sessions.none"))');
    expect(src).toContain("aria-disabled={busy || count === 0 || undefined}");
  });

  it("selfRolesField_source_closesAndRefreshesOnDefinitiveRefusal", () => {
    const src = read("app/(secured)/profil/_components/SelfRolesField.tsx").replace(/\r\n/g, "\n");
    expect(src).toMatch(/DEFINITIVE_REFUSALS[\s\S]*"FORBIDDEN"[\s\S]*"USER_NOT_FOUND"/);
    expect(src).toContain("router.refresh()");
    expect(src).toContain("fieldErrors.clear();\n    setSelected(");
    expect(src).toContain("!Array.isArray(payload.roles)");
    expect(src).toContain('t("platformRoles.adminLocked")');
    expect(src).toContain('t("platformRoles.nothingToSave")');
    expect(src).not.toContain("payload.roles ?? selected");
  });

  it("profilePage_missingInvitationsAnchor_toastsOnceInvitationsAreRead", () => {
    const src = read("app/(secured)/profil/page.tsx");
    expect(src).toContain('showError(t("invitations.gone"))');
    expect(src).toContain("invitationsLoaded");
    expect(src).toContain('showError(t("invitations.loadFailed"))');
  });

  it("roleChangeTone_grantedAdminOrRemoved_isDanger", () => {
    expect(roleChangeTone({ granted: ["ADMIN"], removed: [] })).toBe("danger");
    expect(roleChangeTone({ granted: [], removed: ["ARBITRE"] })).toBe("danger");
    expect(roleChangeTone({ granted: ["ARBITRE"], removed: [] })).toBe("primary");
  });
});
