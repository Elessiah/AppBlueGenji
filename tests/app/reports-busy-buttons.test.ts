import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportDetail } from "@/app/(secured)/admin/signalements/_components/ReportDetail";
import { ArmedButton } from "@/app/(secured)/admin/signalements/_components/ArmedButton";
import type { ReportView } from "@/lib/shared/content-reports";

/**
 * Signalements du staff (EF-70, `docs/features/BUSY_BUTTONS.md`) : pendant un
 * geste, les boutons du panneau, du dossier, des cibles et des rôles d'un
 * joueur restaient `disabled` — le focus clavier tombait sur le `<body>`. Ils
 * passent par `BusyButton` (`aria-disabled` + `aria-busy`, activation annulée
 * par le même état) et la garde synchrone `useBusyGuard`.
 */
const PAGE = "app/(secured)/admin/signalements/page.tsx";
const DETAIL = "app/(secured)/admin/signalements/_components/ReportDetail.tsx";
const CARD = "app/(secured)/admin/signalements/_components/ReportTargetCard.tsx";
const ARMED = "app/(secured)/admin/signalements/_components/ArmedButton.tsx";
const ROLES = "app/(secured)/joueurs/[id]/_components/PlayerRolesPanel.tsx";
const CSS = "app/(secured)/admin/signalements/reports.module.css";

const SCREENS = [PAGE, DETAIL, CARD, ARMED, ROLES];
const BUSY = String.raw`busy|loading|pending|saving|submitting`;
// Fins de ligne ramenées à LF : un dépôt extrait sous Windows (CRLF) lit le même code.
const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

describe("signalements du staff — boutons pendant une requête", () => {
  it.each(SCREENS.map((file) => [file]))("%s_controls_neverNativeDisabledByRequest", (file) => {
    expect(source(file)).not.toMatch(new RegExp(String.raw`\sdisabled=\{[^}]*(?:${BUSY})`, "i"));
  });

  it.each(SCREENS.map((file) => [file]))("%s_wait_announcedThroughBusyButton", (file) => {
    const code = source(file);
    expect(code).toContain('import { BusyButton } from "@/components/ui/busy-button";');
    expect(code).not.toMatch(/<button\b[^>]*aria-(?:disabled|busy)=/);
  });

  it.each([[PAGE], [ROLES]])("%s_sends_throughSharedBusyGuard", (file) => {
    const code = source(file);
    expect(code).toMatch(/= useBusyGuard\(\);/);
    expect(code).not.toMatch(/\bsetBusy\(|setRolesBusy\(/);
  });

  it("page_gestureRefusedByGuard_showsInfoToast", () => {
    const code = source(PAGE);
    expect(code).toContain("const refuse = useCallback(() => showInfo(BUSY_REFUSED_MESSAGE, { once: true }), [showInfo]);");
    expect(code.match(/if \(done === undefined\) refuse\(\);/g)).toHaveLength(2);
    // « Actualiser » passe par la même garde : pas de relecture pendant un geste.
    expect(code).toContain("onClick={() => void refresh()}");
    expect(code).not.toContain("onClick={() => void load()}");
  });

  it("page_blockedRefresh_saysRefusal", () => {
    // Un bouton déjà désarmé annule le clic sans appeler `onClick` : le refus
    // passe par `onBlockedClick`, sans quoi la notification ne partait jamais.
    const code = source(PAGE);
    expect(code).toMatch(/onBlockedClick=\{refuse\}\s+onClick=\{\(\) => void refresh\(\)\}/);
    expect(code).toContain("onRefused={refuse}");
  });

  it("ReportDetail_blockedGestures_sayRefusal", () => {
    const code = source(DETAIL);
    expect(code.match(/onBlockedClick=\{onRefused\}/g)).toHaveLength(6);
    expect(code).toContain("onRefused={onRefused}");
  });

  it("ReportTargetCard_gestureProps_sayRefusal", () => {
    expect(source(CARD)).toMatch(/"data-gesture": name,\s+onBlockedClick: onRefused,/);
  });

  it("ArmedButton_blockedClick_forwardedToBusyButton", () => {
    expect(source(ARMED)).toContain("onBlockedClick={onBlockedClick}");
  });

  it("ReportDetail_pressedGesture_onlyWhenGestureStarts", () => {
    // Le clic qui arme « Supprimer… » ou un clic refusé ne vole pas le focus plus tard.
    const code = source(DETAIL);
    expect(code).toContain("clicked.current = pressedGestureOf(event.target);");
    expect(code).toContain("const started = gestureStarted(clicked.current, pending);");
    // Un geste part : le dernier clic est oublié, un clic ancien ne devient pas « pressé » plus tard.
    expect(code).toContain("if (pending !== null) clicked.current = null;");
    expect(code).not.toContain("if (gesture) pressed.current = gesture;");
  });

  it("refusalMessage_sharedOutsideLanding", () => {
    const shared = 'import { BUSY_REFUSED_MESSAGE } from "@/lib/shared/busy-refused-message";';
    expect(source(PAGE)).toContain(shared);
    expect(source(ROLES)).toContain(shared);
  });

  it("ReportDetail_noteField_readOnlyWhileSending", () => {
    expect(source(DETAIL)).toContain("readOnly={busy}");
  });

  it("ReportDetail_lostFocus_restoredAfterGestureAndResolveToggle", () => {
    const code = source(DETAIL);
    expect(code).toContain("focusAfterGesture(root, last)?.focus();");
    expect(code).toContain('focusAfterToggle.current = "note";');
    expect(code).toContain('focusAfterToggle.current = "resolve";');
    expect(code).toContain("data-focus-scope={ACTIONS_SCOPE}");
  });

  it("ReportTargetCard_card_isFocusScope", () => {
    expect(source(CARD)).toContain("data-focus-scope={`target:${target.type}-${target.id}`}");
  });

  it("PlayerRolesPanel_checkboxes_ariaReadonlyAndToggleIgnoredWhileSaving", () => {
    const code = source(ROLES);
    expect(code).toContain("aria-readonly={rolesBusy || undefined}");
    expect(code).toMatch(/const toggleRole = \(role: PlatformRole\) => \{\s+\/\/[^\n]*\n\s+if \(isBusy\(\)\) return;/);
  });

  it("PlayerRolesPanel_guardRefused_saysRefusal", () => {
    const code = source(ROLES);
    expect(code).toMatch(/const done = await run\(sendRoles\);\s+if \(done === undefined\) \{\s+showInfo\(BUSY_REFUSED_MESSAGE, \{ \.\.\.toastLang, once: true \}\);\s+return false;/);
    expect(code).toMatch(/if \(isBusy\(\)\) \{\s+showInfo\(BUSY_REFUSED_MESSAGE, \{ \.\.\.toastLang, once: true \}\);\s+return;/);
  });

  it("PlayerRolesPanel_failedReload_saysProfileReloadFailed", () => {
    const code = source(ROLES);
    expect(code).toMatch(/await reloadSucceeded\(onSaved\)/);
    expect(code).toContain("if (!reloaded) showError(rolesErrorMessage(failureCode), toastLang);");
    // Enregistré mais fiche non relue : une seule phrase, qui dit les deux.
    expect(code).toContain('await reloadProfile("ROLES_SAVED_RELOAD_FAILED");');
    expect(code).toContain('await reloadProfile("PROFILE_RELOAD_FAILED");');
  });

  it("playerPage_moderationBar_revalidatedInBackground", () => {
    const page = source("app/(secured)/joueurs/[id]/page.tsx");
    expect(page).toContain("<PlayerModerationBar profile={data} deleted={deleted} onChanged={revalidate} />");
    expect(page).not.toContain("onChanged={refresh}");
  });

  it("PlayerModerationBar_failedReload_saysSo", () => {
    const bar = source("app/(secured)/joueurs/[id]/_components/PlayerModerationBar.tsx");
    expect(bar).toMatch(/reloadSucceeded\(onChanged\)/);
    expect(bar).toContain("showError(PROFILE_RELOAD_FAILED_MESSAGE,");
  });

  it("useResourceLoader_failedRead_returnsFalse", () => {
    const hook = source("lib/shared/hooks/useResourceLoader.ts");
    expect(hook).toContain("async (silent: boolean): Promise<boolean> => {");
    expect(hook.match(/return false;/g)).toHaveLength(3);
  });

  it("playerPage_rolesSaved_revalidatedInBackgroundNotRemounted", () => {
    // `refresh` repassait la page en « Chargement… » : panneau et confirmation
    // démontés, focus perdu sur la page.
    const page = source("app/(secured)/joueurs/[id]/page.tsx");
    expect(page).toContain("roles={data.roles} onSaved={revalidate} />");
    expect(page).not.toContain("onSaved={refresh}");
  });

  it("reportsCss_disarmedLook_byColoursNotNativeDisabled", () => {
    const css = source(CSS);
    expect(css).not.toMatch(/\.actionButton:disabled\s*\{/);
    expect(css.match(/composes: busyLook from "\.\.\/\.\.\/\.\.\/busy-look\.module\.css";/g)).toHaveLength(2);
  });
});

const report: ReportView = {
  id: 12,
  category: "OTHER",
  status: "OPEN",
  description: "Test_Description",
  pagePath: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  resolvedAt: null,
  purgeAt: null,
  heldForNotifier: false,
  reporter: null,
  contactName: null,
  contactEmail: null,
  rightsRelation: null,
  assignee: null,
  resolutionNote: null,
  targets: [],
  contests: [],
  quarantines: [],
};
const noop = () => undefined;
const detail = (pending: string | null) =>
  renderToStaticMarkup(
    createElement(ReportDetail, {
      report,
      pending,
      onRefused: noop,
      onAction: noop,
      onHideLogo: noop,
      onDeleteLogo: noop,
      onRestore: noop,
      onPurge: noop,
      onContestOutcome: noop,
    }),
  );
const buttonOf = (html: string, label: string) => new RegExp(String.raw`<button[^>]*>${label}</button>`).exec(html)?.[0] ?? "";

describe("signalements du staff — rendu des gestes", () => {
  // Rendu serveur d'un composant client : React prévient que `useLayoutEffect`
  // n'y tourne pas (le focus se rend au navigateur seulement).
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("ReportDetail_noPending_buttonsArmed", () => {
    const take = buttonOf(detail(null), "Prendre en charge");

    expect(take).not.toContain("aria-disabled");
    expect(take).not.toContain("aria-busy");
    expect(take).not.toMatch(/\sdisabled=/);
  });

  it("ReportDetail_takePending_onlyTakeAnnouncedBusy", () => {
    const html = detail("action:TAKE");
    const take = buttonOf(html, "Prendre en charge");
    const resolve = buttonOf(html, "Résoudre et archiver…");

    expect(take).toContain('aria-disabled="true"');
    expect(take).toContain('aria-busy="true"');
    expect(resolve).toContain('aria-disabled="true"');
    expect(resolve).not.toContain("aria-busy");
    expect(html).not.toMatch(/<button[^>]*\sdisabled=/);
  });

  it("ArmedButton_otherGesturePending_refusedWithoutBusyAnnounce", () => {
    const html = renderToStaticMarkup(
      createElement(ArmedButton, { label: "Supprimer", confirmLabel: "Sûr ?", onConfirm: noop, busy: false, blocked: true }),
    );

    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain("aria-busy");
    expect(html).not.toMatch(/\sdisabled=/);
  });

  it("ArmedButton_ownGesturePending_announcedBusy", () => {
    const html = renderToStaticMarkup(
      createElement(ArmedButton, { label: "Supprimer", confirmLabel: "Sûr ?", onConfirm: noop, busy: true, "data-gesture": "purge:4" }),
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-gesture="purge:4"');
  });

  it("PlayerModerationBar_profileRead_focusBackOnBarWhenOpenerGone", () => {
    const bar = source("app/(secured)/joueurs/[id]/_components/PlayerModerationBar.tsx");
    // Secours commun (`useFocusRescue`) : focus perdu seulement, dans les 4 s, sauf reprise en main.
    expect(bar).toContain("const rescueFocus = useFocusRescue(barRef);");
    expect(bar).toMatch(/setDialog\(null\);\s+rescueFocus\(\["button"\]\);/);
  });

  it("ReportDetail_focusRestore_usesIsFocusLost", () => {
    const code = source(DETAIL);
    expect(code).toContain("if (root && isFocusLost(document)) focusAfterGesture(root, last)?.focus();");
  });

  it("ArmedButton_otherGestureStarts_disarmedSoLongLabelGoes", () => {
    const code = source(ARMED);
    // Remis à zéro pendant le rendu : aucune image ne montre la question sur un bouton refusé.
    expect(code).toMatch(/const off = busy \|\| blocked;\s+if \(off && armed\) setArmed\(false\);/);
    expect(code).toContain("{armed && !off ? confirmLabel : label}");
  });

  it("page_reportList_memoisedSoPendingRendersSkipIt", () => {
    const code = source(PAGE);
    expect(code).toContain("const reportList = useMemo(");
    expect(code).toContain("[visible, selectedId, filters.status, select],");
    expect(code).toMatch(/const select = useCallback\(/);
  });

  it("reloadOutcome_sharedByRolesPanelAndModerationBar", () => {
    const shared = 'import { reloadSucceeded } from "@/lib/shared/reload-outcome";';
    expect(source(ROLES)).toContain(shared);
    expect(source("app/(secured)/joueurs/[id]/_components/PlayerModerationBar.tsx")).toContain(shared);
  });

  it("page_pending_releasedAfterTheGuard_neverBefore", () => {
    const code = source(PAGE);
    // Aucun rendu où la garde refuse (`busy`) sans qu'un bouton s'annonce occupé.
    expect(code).not.toMatch(/finally \{[^}]*setPending\(null\)/);
    expect(code.match(/else setPending\(null\);/g)).toHaveLength(2);
  });
});
