import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Pendant une requête, les boutons des dialogues de match et d'arbitrage
 * restaient `disabled` : le focus clavier tombait sur le `<body>` et un lecteur
 * d'écran perdait sa place. Ils restent focalisables (`aria-disabled`,
 * `aria-busy`), le gestionnaire ignore un second geste, et la garde partagée
 * `useBusyGuard` (`runExclusive`, testée en comportement dans
 * `tests/lib/shared/busy-guard.test.ts`) écarte le double envoi qui part
 * avant le rendu et se lève sur tout chemin d'erreur.
 *
 * Un **champ** peut garder `disabled` : les listes déroulantes de l'arbitrage
 * et de la date (le focus est sur le bouton qui envoie, une liste n'envoie
 * pas le formulaire), la liste des maps d'un score (`MapScoreList`, Entrée n'y
 * envoie pas). Les points par map (`RoundMapsDialog`), où Entrée envoie,
 * passent en lecture seule pendant l'envoi.
 */
const DIR = "app/(secured)/tournois/[id]/_components/";
const SCREENS = [
  "RefereeDialog.tsx",
  "MatchScheduleDialog.tsx",
  "AdminScoreDialog.tsx",
  "CastSettingsDialog.tsx",
  "MatchReplayDialog.tsx",
  "MatchLiveDialog.tsx",
  "IssueReportDialog.tsx",
  "PlayerScoreDialog.tsx",
  "RoundMapsDialog.tsx",
  "MatchPlanningPanel.tsx",
  "MatchCardActions.tsx",
  "EntrantContactsPanel.tsx",
] as const;

const BUSY = String.raw`busy|submitting|form\.submitting|loading`;
const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const buttonsOf = (code: string) => code.match(/<(?:button|BusyButton)\b[\s\S]*?<\/(?:button|BusyButton)>/g) ?? [];

describe("dialogues de match et d'arbitrage — boutons pendant une requête", () => {
  it.each(SCREENS.map((file) => [file]))("%s ne désactive aucun bouton par l'état de la requête", (file) => {
    for (const button of buttonsOf(source(DIR + file))) {
      expect(button).not.toMatch(new RegExp(String.raw`\sdisabled=\{(?:${BUSY})[\s|}]`));
      expect(button).not.toMatch(new RegExp(String.raw`\sdisabled=\{[^}]*\|\|\s*(?:${BUSY})\b`));
    }
  });

  it.each(SCREENS.map((file) => [file]))("%s annonce l'attente par BusyButton (aria-busy)", (file) => {
    const code = source(DIR + file);
    expect(code).toMatch(new RegExp(String.raw`<BusyButton\s+busy=\{(?:${BUSY}|waiting)\}`));
    expect(code).toContain('import { BusyButton } from "@/components/ui/busy-button";');
  });

  it.each(SCREENS.map((file) => [file]))("%s_noHandWrittenBusyAttributes_onButtons", (file) => {
    // Une seule écriture des attributs et de la garde : `BusyButton`.
    for (const button of buttonsOf(source(DIR + file))) {
      expect(button).not.toMatch(/^<button\b[^>]*aria-(?:disabled|busy)=/);
    }
    expect(source(DIR + file)).not.toMatch(/busyProps/);
  });

  it.each(SCREENS.filter((file) => file !== "AdminScoreDialog.tsx").map((file) => [file]))(
    "%s_sends_throughSharedBusyGuard",
    (file) => {
      const code = source(DIR + file);
      expect(code).toMatch(/= useBusyGuard\(\);/);
      // Plus de garde écrite à la main (drapeau oublié dans un `finally` = bouton bloqué).
      expect(code).not.toMatch(/\b(?:busyRef|submittingRef|loadingRef|inFlight)\b/);
    },
  );

  it("useScoreForm_submit_throughSharedBusyGuard", () => {
    // AdminScoreDialog envoie par `useScoreForm`.
    const code = source("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    expect(code).toMatch(/const \{ busy: submitting, isBusy, run \} = useBusyGuard\(\);/);
    expect(code).toMatch(/if \(!match \|\| isBusy\(\)\) return false;/);
    expect(code).not.toMatch(/submittingRef/);
  });

  it("useOnAirToggle_sharesWindowGuard", () => {
    // L'antenne et l'enregistrement d'une fenêtre partagent un seul drapeau :
    // l'un lancé pendant l'autre est ignoré.
    const code = source("app/(secured)/tournois/[id]/_lib/use-on-air-toggle.ts");
    expect(code).toMatch(/\{ run, onDone \}: \{ run: BusyRun; onDone: \(\) => void \}/);
    expect(code).toMatch(/await run\(async \(\) => \{/);
    for (const file of ["CastSettingsDialog.tsx", "MatchLiveDialog.tsx"]) {
      expect(source(DIR + file)).toMatch(/useOnAirToggle\(match\.id, onAir, \{ run, onDone: onSaved \}\)/);
    }
  });

  it("CastAirAndReplay_clicks_guardedSynchronously", () => {
    const code = source(DIR + "CastSettingsDialog.tsx");
    expect(code).toMatch(/if \(!isBusy\(\)\) void toggleAir\(\);/);
    expect(code).toMatch(/if \(!isBusy\(\)\) onReplay\(\);/);
  });

  it("RoundPointsForm_mapPoints_readOnlyNotDisabledWhileBusy", () => {
    const code = source(DIR + "RoundMapsDialog.tsx");
    expect(code).toMatch(/<fieldset className=\{styles\.pointMaps\} disabled=\{locked\}>/);
    expect(code).toMatch(/readOnly=\{busy\}\s+onEdit=\{editMap\}/);
    expect(code).toMatch(/readOnly=\{readOnly \|\| undefined\}/);
  });

  it("MatchPlanningPanel_busyToggle_keepsItsLabel", () => {
    const code = source(DIR + "MatchPlanningPanel.tsx");
    expect(code).not.toMatch(/busy \? "…" : toggleLabel/);
    expect(code).toContain("<BusyLabel busy={busy} idle={toggleLabel} pending={`${toggleLabel}…`} />");
  });

  it("EntrantContactsPanel_reopenDuringLoad_rereadsAfter", () => {
    const code = source(DIR + "EntrantContactsPanel.tsx");
    expect(code).toMatch(/if \(!retry\) rereadRef\.current = true;/);
    expect(code).toMatch(/if \(rereadRef\.current\) \{\s+rereadRef\.current = false;\s+if \(isMounted\(\)\) void load\(\);/);
  });

  it("EntrantContactsPanel_sameFailureAgain_alertReplaced", () => {
    const code = source(DIR + "EntrantContactsPanel.tsx");
    expect(code).toMatch(/setFailures\(\(count\) => count \+ 1\)/);
    expect(code).toMatch(/<p key=\{failures\}/);
  });


  it("RefereeDialog_confirmAndClose_ignoredWhileBusy", () => {
    const code = source(DIR + "RefereeDialog.tsx");
    expect(code).toMatch(/const ask = \(pending: PendingConfirm\) => \{\s+if \(!isBusy\(\)\) setConfirm\(pending\);/);
    expect(code).toMatch(/const close = \(\) => \{\s+if \(!isBusy\(\)\) onClose\(\);/);
    expect(code).not.toMatch(/onClick=\{\(\) => setConfirm\(/);
  });

  it("RefereeDialog_mapInput_readOnlyNotDisabledWhileBusy", () => {
    // Entrée dans la saisie lance l'envoi : désactivée, elle perdrait le focus.
    const code = source(DIR + "RefereeDialog.tsx");
    expect(code).toMatch(/readOnly=\{busy\}\s+\{\.\.\.fieldErrors\.aria\("map"\)\}/);
  });

  it("MatchReplayDialog_urlInput_readOnlyWhileBusy", () => {
    const code = source(DIR + "MatchReplayDialog.tsx");
    expect(code).toMatch(/disabled=\{!replayable\}\s+readOnly=\{busy\}/);
  });

  it("MatchLiveDialog_submit_guardsEveryBlockingReason", () => {
    // Le bouton n'est plus `disabled` natif : Entrée dans un champ enverrait
    // sinon un formulaire que `saveReason` refusait.
    expect(source(DIR + "MatchLiveDialog.tsx")).toMatch(
      /if \(isBusy\(\) \|\| urlInvalid \|\| triggerNeedsDate \|\| invalidCasterLink \|\| saveReason !== null\) return;/,
    );
  });

  it("MatchCardActions_waitingAction_clickIgnored", () => {
    const code = source(DIR + "MatchCardActions.tsx");
    expect(code).toMatch(/const waiting = busy && writes\(id\);/);
    expect(code).toMatch(/busy=\{waiting\}\s+blocked=\{blocked\}/);
    // Garde synchrone des gestes qui écrivent ; un « Prendre le cast » désarmé dit encore pourquoi.
    expect(code).toMatch(/const activate = \(\) => \{\s+\/\/[^\n]*\n\s+if \(writes\(id\) && isBusy\(\)\) return;/);
    expect(code).toContain("onBlockedClick={blocked ? activate : undefined}");
    expect(code).toMatch(/if \(!isBusy\(\)\) setReleaseTarget\(userId\);/);
  });

  it("MatchCardActionsCss_busyItem_sharesWaitingLook", () => {
    expect(source(DIR + "MatchCardActions.module.css")).toMatch(/\.item\[aria-busy="true"\] \{[^}]*cursor: progress;/);
  });

  it("EntrantContactsPanel_retry_keepsErrorViewWhileReloading", () => {
    const code = source(DIR + "EntrantContactsPanel.tsx");
    expect(code).toMatch(/if \(!retry\) setFailure\(null\);/);
    expect(code).toMatch(/void load\(true\)/);
  });

  it("ScoreDialogCss_noNativeDisabledLeft_noDeadSelectors", () => {
    // Plus aucun bouton de ces dialogues n'est `disabled` natif.
    expect(source(DIR + "ScoreDialog.module.css")).not.toMatch(/:disabled/);
  });

  it("ScoreDialogCss_disabledForfeitAndLink_useColoursNotOpacity", () => {
    const css = source(DIR + "ScoreDialog.module.css");
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of rules.match(/[^}]*\[aria-disabled="true"\][^{]*\{[^}]*\}/g) ?? []) {
      expect(rule).not.toMatch(/opacity/);
    }
    expect(css).toMatch(/\.forfeit\[aria-disabled="true"\]\[aria-busy="true"\] \{[^}]*cursor: progress;/);
    expect(css).toMatch(/\.link\[aria-disabled="true"\]\[aria-busy="true"\] \{[^}]*cursor: progress;/);
  });

  it("globalsCss_busyButton_showsProgressCursor", () => {
    expect(source("app/globals.css")).toMatch(/\.btn:where\(\[aria-disabled="true"\]\[aria-busy="true"\]\) \{\s+cursor: progress;/);
  });

  it("globalsCss_busyButton_saysWaitWithoutCursor", () => {
    expect(source("app/globals.css")).toMatch(/\.btn:where\(\[aria-disabled="true"\]\[aria-busy="true"\]\) \{[^}]*border-style: dashed;/);
  });

  it("globalsCss_dimDisabled_usesColoursNotOpacity", () => {
    const rules = source("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of rules.match(/\.dim-disabled[^{]*\{[^}]*\}/g) ?? []) {
      expect(rule).not.toMatch(/opacity/);
    }
  });

  it("ScoreDialogCss_disabledForfeit_keepsReadableContrast", () => {
    const css = source(DIR + "ScoreDialog.module.css");
    const alpha = css.match(/\.forfeit\[aria-disabled="true"\] \{[^}]*color: rgba\(var\(--amber-rgb\), ([\d.]+)\)/);
    expect(Number(alpha?.[1])).toBeGreaterThanOrEqual(0.65);
  });

  it("textFields_whileSending_areReadOnly", () => {
    expect(source(DIR + "IssueReportDialog.tsx")).toMatch(/readOnly=\{busy\}/);
    const live = source(DIR + "MatchLiveDialog.tsx");
    expect(live).toMatch(/readOnly=\{linkLocked \|\| busy\}/);
    expect(live).toMatch(/value=\{value\}\s+readOnly=\{busy\}/);
  });

  it("MatchPlanningPanel_busyLabel_reservesEllipsisWidth", () => {
    expect(source(DIR + "MatchPlanningPanel.tsx")).not.toMatch(/style=\{\{ visibility/);
  });

  it.each([
    ["CastSettingsDialog.tsx"],
    ["MatchLiveDialog.tsx"],
    ["MatchReplayDialog.tsx"],
    ["IssueReportDialog.tsx"],
    ["MatchScheduleDialog.tsx"],
  ])("%s_swappedSubmitLabel_goesThroughBusyLabel", (file) => {
    const code = source(DIR + file);
    expect(code).toMatch(/<BusyLabel busy=\{busy\}/);
    expect(code).not.toMatch(/\{busy \? t\("(?:schedule\.saving|issue\.pending|cardActions\.castSettings\.saving)"\)/);
  });
});

describe("EF-66 performance cycle 1", () => {
  it("AdminScoreDialog_handlers_askTheSynchronousGuard", () => {
    const dialog = source(DIR + "AdminScoreDialog.tsx");
    expect(dialog).not.toMatch(/if \(!form\.submitting\) (form\.adoptStoredResult|onClose)\(\)/);
    expect(dialog).toContain("if (teamId === null || form.isBusy()) return;");
    expect(dialog).toContain("if (!form.isBusy()) form.adoptStoredResult();");
    expect(source("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts")).toMatch(/submitting,\s+\/\*\*[^*]*\*\/\s+isBusy,/);
  });

  it("EntrantContactsPanel_unmounted_doesNotRereadNorFetchAgain", () => {
    const code = source(DIR + "EntrantContactsPanel.tsx");
    // Un seul suivi du montage : celui du hook.
    expect(code).toMatch(/const \{ busy: loading, isBusy, run, isMounted \} = useBusyGuard\(\);/);
    expect(code).not.toMatch(/mountedRef/);
  });

  it("EntrantContactsPanel_collapsedDuringLoad_dropsQueuedReread", () => {
    expect(source(DIR + "EntrantContactsPanel.tsx")).toMatch(/setOpen\(next\);\s+if \(!next\) rereadRef\.current = false;/);
  });
});

describe("EF-66 security cycle 1", () => {
  it.each([
    ["PlayerScoreDialog.tsx", /if \(isBusy\(\) \|\| send === null\) return;/],
    ["PlayerScoreDialog.tsx", /if \(!isBusy\(\)\) setForfeitOpen\(!forfeitOpen\);/],
    ["PlayerScoreDialog.tsx", /if \(!isBusy\(\)\) onClose\(\);/],
    ["RoundMapsDialog.tsx", /if \(!isBusy\(\)\) onRemoveSlot\(\);/],
    ["RoundMapsDialog.tsx", /if \(isBusy\(\) \|\| saved === null\) return;/],
    ["RoundMapsDialog.tsx", /if \(!isBusy\(\) && saved\) setPending\(\{ kind: "reset" \}\);/],
    ["AdminScoreDialog.tsx", /if \(!form\.isBusy\(\) && !saveBlocked\) void run\("save"\);/],
  ])("%s_handler_asksTheSynchronousGuard (%s)", (file, pattern) => {
    expect(source(DIR + file)).toMatch(pattern);
  });

  it.each(SCREENS.map((file) => [file]))("%s_handlers_neverReadTheRenderedBusyState", (file) => {
    // Seule exception : l'effet de RefereeDialog qui rend le focus après le rendu de `busy`.
    const code = source(DIR + file).replace("if (busy || confirm !== null) return;", "");
    expect(code).not.toMatch(/if \(!?\(?(?:busy|submitting|form\.submitting|waiting)\b[^)]*\) (?:return|on|set|void)/);
  });

  it.each([
    ["MatchPlanningPanel.tsx", /const toggle = async \(next: boolean\): Promise<boolean> => \{\s+return \(await run\(/],
    ["MatchCardActions.tsx", /refresh = true\): Promise<boolean> => \{\s+return \(await guarded\(/],
    ["RoundMapsDialog.tsx", /const run: RunTask = async \(task, onRefused\) => \{\s+return \(await guarded\(/],
    ["MatchReplayDialog.tsx", /const save = async \(value: string \| null\) => \{\s+await run\(/],
    ["PlayerScoreDialog.tsx", /const submitForfeit = async \(\) => \{\s+await run\(/],
  ])("%s_noRedundantGuardBeforeRun", (file, pattern) => {
    expect(source(DIR + file)).toMatch(pattern);
  });

  it("RoundPointsForm_roundPoints_readOnlyWhileSending", () => {
    const code = source(DIR + "RoundMapsDialog.tsx");
    expect(code).toMatch(/disabled=\{locked\}\s+readOnly=\{busy \|\| undefined\}/);
    expect(code).toContain("readOnly={!allowed || busy || undefined}");
  });

  it("CastSettingsDialog_fields_frozenWhileSending", () => {
    const code = source(DIR + "CastSettingsDialog.tsx");
    expect(code.match(/sending=\{busy\}/g)).toHaveLength(3);
    expect(code.match(/if \(isBusy\(\)\) return;\s+(?:setUrl|setBattletag|pickTrigger)\(next\);/g)).toHaveLength(3);
    const fields = source(DIR + "CastSettingsFields.tsx");
    expect(fields).toContain("readOnly={locked || sending}");
    expect(fields).toContain("readOnly={sending || undefined}");
    expect(fields).toMatch(/aria-disabled=\{sending \|\| undefined\}\s+onChange=\{\(\) => \{\s+if \(!sending\) onChange\(option\);/);
  });

  it("MatchLiveDialog_checkboxesAndTrigger_frozenWhileSending", () => {
    const code = source(DIR + "MatchLiveDialog.tsx");
    expect(code).toMatch(/aria-readonly=\{busy \|\| undefined\}\s+onChange=\{\(e\) => \{\s+if \(!isBusy\(\)\) setOrganisationLink\(e\.target\.checked\);/);
    expect(code).toContain("aria-readonly={sending || undefined}");
    expect(code).toMatch(/if \(!isBusy\(\)\) setTrigger\(next\);\s+\}\}\s+sending=\{busy\}/);
  });

  it("AdminScoreDialog_adoptProposal_guardedOnceBySynchronousState", () => {
    const code = source(DIR + "AdminScoreDialog.tsx");
    expect(code).toContain("onClick={onAdopt}");
    expect(code).not.toMatch(/if \(!submitting\) onAdopt\(\)/);
  });
});
