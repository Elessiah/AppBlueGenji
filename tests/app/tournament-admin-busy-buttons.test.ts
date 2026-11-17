import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Gestion du tournoi (EF-67, `docs/features/BUSY_BUTTONS.md`) : pendant une
 * requête, les boutons des dialogues staff, de l'ordre des engagés, du
 * formulaire de tournoi et du centre de lancement restaient `disabled` — le
 * focus clavier tombait sur le `<body>`. Ils passent par `BusyButton`
 * (`aria-disabled` + `aria-busy`, activation annulée par le même état) et la
 * garde partagée `useBusyGuard` (comportement testé dans
 * `tests/lib/shared/busy-guard.test.ts`).
 *
 * Seules les listes déroulantes du formulaire de tournoi gardent `disabled`
 * (verrou durable `locked(…)`, jamais l'état de la requête).
 */
const DIR = "app/(secured)/tournois/[id]/_components/";
const FORM_DIR = "app/(secured)/tournois/_components/";
const LAUNCH = "components/match-launch/MatchLaunchCenter.tsx";

const SCREENS = [
  DIR + "GhostRegistrationDialog.tsx",
  DIR + "RegistrationsPanel.tsx",
  DIR + "RollbackRoundDialog.tsx",
  DIR + "DeleteTournamentDialog.tsx",
  DIR + "TournamentImageDialog.tsx",
  DIR + "TournamentDialogShell.tsx",
  DIR + "TournamentLiveLink.tsx",
  DIR + "EndurancePenaltyDialog.tsx",
  FORM_DIR + "TournamentForm.tsx",
  FORM_DIR + "TournamentImagePicker.tsx",
  LAUNCH,
];

/** Écrans qui envoient eux-mêmes (la coquille et le sélecteur reçoivent l'état). */
const SENDERS = [
  DIR + "GhostRegistrationDialog.tsx",
  DIR + "RegistrationsPanel.tsx",
  DIR + "RollbackRoundDialog.tsx",
  DIR + "DeleteTournamentDialog.tsx",
  DIR + "TournamentImageDialog.tsx",
  DIR + "AdvanceTournamentDialog.tsx",
  DIR + "RemoveEntrantDialog.tsx",
  DIR + "TournamentLiveLink.tsx",
  DIR + "EndurancePenaltyDialog.tsx",
  FORM_DIR + "TournamentForm.tsx",
  LAUNCH,
];

const BUSY = String.raw`busy|loading|disabled`;
const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const buttonsOf = (code: string) => code.match(/<(?:button|BusyButton)\b[\s\S]*?<\/(?:button|BusyButton)>/g) ?? [];

describe("gestion du tournoi — boutons pendant une requête", () => {
  it.each(SCREENS.map((file) => [file]))("%s_buttons_neverNativeDisabledByRequest", (file) => {
    for (const button of buttonsOf(source(file))) {
      expect(button).not.toMatch(new RegExp(String.raw`\sdisabled=\{(?:${BUSY})[\s|}]`));
      expect(button).not.toMatch(new RegExp(String.raw`\sdisabled=\{[^}]*\|\|\s*(?:${BUSY})\b`));
    }
  });

  it.each(SCREENS.map((file) => [file]))("%s_wait_announcedThroughBusyButton", (file) => {
    const code = source(file);
    expect(code).toMatch(/<BusyButton\s+busy=\{(?:busy|loading)\}/);
    expect(code).toContain('import { BusyButton } from "@/components/ui/busy-button";');
  });

  it.each(SCREENS.map((file) => [file]))("%s_buttons_noHandWrittenAriaState", (file) => {
    for (const button of buttonsOf(source(file))) {
      expect(button).not.toMatch(/^<button\b[^>]*aria-(?:disabled|busy)=/);
    }
  });

  it.each(SENDERS.map((file) => [file]))("%s_sends_throughSharedBusyGuard", (file) => {
    const code = source(file);
    expect(code).toMatch(/= useBusyGuard\(\);/);
    expect(code).not.toMatch(/\bset(?:Busy|Loading)\(/);
  });

  it.each([
    [DIR + "GhostRegistrationDialog.tsx", "ghost.pending"],
    [DIR + "RollbackRoundDialog.tsx", "rollback.pending"],
    [DIR + "DeleteTournamentDialog.tsx", "delete.pending"],
    [DIR + "TournamentImageDialog.tsx", "schedule.saving"],
    [DIR + "EndurancePenaltyDialog.tsx", "schedule.saving"],
  ])("%s_swappedLabel_goesThroughBusyLabel", (file, pendingKey) => {
    const code = source(file);
    expect(code).toContain(`pending={t("${pendingKey}")} />`);
    expect(code).not.toMatch(/\{busy \? t\(/);
  });
});

describe("équipes fantômes", () => {
  const code = source(DIR + "GhostRegistrationDialog.tsx");

  it("GhostRegistration_selectionGestures_ignoredWhileSending", () => {
    expect(code).toMatch(/const toggle = \(teamId: number\) => \{\s+\/\/[^\n]*\n\s+if \(isBusy\(\)\) return;/);
    expect(code).toMatch(/const selectVisible = \(\) => \{\s+if \(isBusy\(\)\) return;/);
    expect(code).toContain("if (!isBusy()) setSelected([]);");
    expect(code).toContain('if (!isBusy()) setMode("existing");');
    expect(code).toContain('if (!isBusy()) setMode("new");');
  });

  it("GhostRegistration_fields_keepFocusWhileSending", () => {
    expect(code).toContain("aria-readonly={busy || undefined}");
    expect(code).toMatch(/readOnly=\{busy\}\s+minLength=\{3\}/);
  });

  it("GhostRegistration_openingFocus_leftToDialogSoCloseRestoresTrigger", () => {
    // Un focus posé au montage passait avant `useDialogBehavior`, qui retenait
    // le champ comme cible de retour : à la fermeture, le focus tombait sur body.
    expect(code).not.toContain("focusOnMount");
    expect(code.match(/ref=\{focusOnModeSwitch\}\s+data-autofocus/g)).toHaveLength(2);
    expect(code).toMatch(/if \(element && openedRef\.current\) element\.focus\(\);/);
  });

  it("GhostRegistration_modeSwitchFocus_resetOnUnmount", () => {
    expect(code).toMatch(/openedRef\.current = true;\s+return \(\) => \{\s+openedRef\.current = false;/);
  });

  it("GhostRegistration_submit_guardsEveryBlockingReason", () => {
    expect(code).toMatch(/event\.preventDefault\(\);\s+\/\/[^\n]*\n\s+if \(submitBlocked\) return;/);
    expect(code).toMatch(/busy=\{busy\}\s+blocked=\{submitBlocked\}\s+type="submit"/);
  });

  it("GhostRegistrationCss_disarmedLook_coloursNotOpacity", () => {
    const css = source(DIR + "GhostRegistrationDialog.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/:disabled/);
    expect(css).not.toMatch(/opacity/);
    expect(css).toMatch(/\.linkButton\[aria-disabled="true"\] \{/);
    expect(code).toContain("className={`${styles.panel} dim-disabled`}");
  });
});

describe("dialogues sans retour", () => {
  it("DeleteTournament_success_staysWaitingUntilNavigation", () => {
    // La fiche part par `router.replace` : un second clic ne relance pas la suppression.
    const code = source(DIR + "DeleteTournamentDialog.tsx");
    expect(code).toMatch(/hold\(\);\s+onDeleted\(tournamentName\);/);
    expect(code).toContain("if (!armed || isBusy()) return;");
    expect(code).toContain("const { busy, isBusy, run, hold } = useBusyGuard();");
    expect(code).toMatch(/autoComplete="off"\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+readOnly=\{busy\}/);
  });

  it("RollbackRound_submit_guardedSynchronously", () => {
    // Le parent ferme le dialogue au succès, dans le même rendu : pas de `hold()`.
    const code = source(DIR + "RollbackRoundDialog.tsx");
    expect(code).toContain("if (!acknowledged || isBusy()) return;");
    expect(code).not.toMatch(/doneRef|hold\(\)/);
    expect(code).toContain("if (!isBusy()) setAcknowledged(e.target.checked);");
  });

  it("TournamentDialogShell_labels_throughBusyLabelAndSyncGuard", () => {
    const shell = source(DIR + "TournamentDialogShell.tsx");
    expect(shell).toContain("<BusyLabel busy={busy} idle={submitLabel} pending={pendingLabel} />");
    expect(shell).toContain("if (!isBusy()) onClose();");
  });

  it.each([["AdvanceTournamentDialog.tsx"], ["RemoveEntrantDialog.tsx"]])("%s_passesShellGuardAndPendingLabel", (file) => {
    const code = source(DIR + file);
    expect(code).toMatch(/isBusy=\{isBusy\}/);
    expect(code).toMatch(/pendingLabel=\{t\(/);
    expect(code).not.toMatch(/submitLabel=\{busy \?/);
  });
});

describe("ordre des engagés", () => {
  const code = source(DIR + "RegistrationsPanel.tsx");

  it("RegistrationsPanel_move_ignoredWhileSending", () => {
    expect(code).toMatch(/const move = async \(teamId: number, direction: "up" \| "down"\) => \{\s+if \(isBusy\(\)\) return;/);
    expect(code).toMatch(/const performMove = async[^\n]*\n\s+\/\/[^\n]*\n\s+if \(isBusy\(\)\) return false;/);
  });

  it("RegistrationsPanel_optimisticOrder_setInsideTheGuard", () => {
    // L'aperçu optimiste ne part que si l'envoi part.
    expect(code).toMatch(/\(await run\(async \(\) => \{\s+const name =[^\n]*\n\s+baseline\.current = serverKey;\s+setPending\(next\);/);
  });

  it("RegistrationsPanelCss_busyButtons_showWaitCursor", () => {
    expect(source(DIR + "RegistrationsPanel.module.css")).toMatch(
      /\.arrow\[aria-busy="true"\],\s+\.remove\[aria-busy="true"\] \{\s+cursor: progress;/,
    );
  });
});

describe("formulaire de tournoi et image", () => {
  const form = source(FORM_DIR + "TournamentForm.tsx");

  it("TournamentForm_success_staysWaitingUntilNavigation", () => {
    // La page restait montée le temps du `router.push` : un second clic créait un doublon.
    expect(form).toMatch(/await onSubmit\(values, image\);\s+hold\(\);/);
    expect(form).toContain("const { busy: loading, isBusy, run, hold } = useBusyGuard();");
    expect(form).toMatch(/event\.preventDefault\(\);\s+if \(isBusy\(\)\) return;/);
  });

  it("TournamentForm_edits_ignoredWhileSending", () => {
    expect(form).toMatch(/const setValues = \(next: SetStateAction<TournamentFormValues>\) => \{\s+if \(!isBusy\(\)\) setValuesState\(next\);/);
    expect(form).toMatch(/const setImage = \(next: ImagePickerValue\) => \{\s+if \(!isBusy\(\)\) setImageState\(next\);/);
    // États voisins : une saisie ignorée ne coupe pas le suivi des rondes ni ne
    // déplace la valeur retenue du format.
    expect(form).toMatch(/const setSwissRoundsTouched = \(next: boolean\) => \{\s+if \(!isBusy\(\)\) setSwissRoundsTouchedState\(next\);/);
    expect(form).toMatch(/const setLastMatchFormatValue = \(next: number\) => \{\s+if \(!isBusy\(\)\) setLastMatchFormatValueState\(next\);/);
  });

  it("TournamentForm_numberInputs_allReadOnlyThroughContext", () => {
    // Sous-formulaires compris (réglages de format, Duel / Arcade, phases).
    expect(form).toMatch(/<form onSubmit=\{handleSubmit\}[^>]*>\s+\{\/\*[^*]*\*\/\}\s+<NumberInputReadOnlyContext\.Provider value=\{loading\}>/);
    expect(form).toMatch(/<\/NumberInputReadOnlyContext\.Provider>\s+<\/form>/);
  });

  it("TournamentImageDialog_draftEdits_guardedSynchronously", () => {
    const code = source(DIR + "TournamentImageDialog.tsx");
    expect(code).toMatch(/const editDraft = \(next: ImagePickerValue\) => \{\s+if \(!isBusy\(\)\) setValue\(next\);/);
    expect(code).toContain("onChange={editDraft}");
  });

  it("TournamentForm_textFields_readOnlyWhileSending", () => {
    expect(form.match(/readOnly=\{loading\}/g)).toHaveLength(10);
  });

  it("TournamentForm_submit_noOpacityAndKeepsWidth", () => {
    expect(form).not.toMatch(/opacity: loading/);
    expect(form).toContain("<BusyLabel busy={loading} idle={submitLabel} pending={loadingLabel} />");
    expect(form).toContain("busy={loading} />");
  });

  it("TournamentImagePicker_busy_radiosIgnoreGesture", () => {
    const picker = source(FORM_DIR + "TournamentImagePicker.tsx");
    expect(picker).toMatch(/aria-disabled=\{busy \|\| undefined\}\s+onChange=\{\(\) => \{\s+if \(!busy\) setSettings\(\{ fit \}\);/);
    expect(picker).not.toMatch(/\bdisabled=\{disabled\}|tabIndex=\{disabled/);
  });

  it("TournamentImagePickerCss_emptyZone_noNativeDisabledSelector", () => {
    expect(source(FORM_DIR + "TournamentImagePicker.module.css")).not.toMatch(/\.empty:disabled/);
  });
});

describe("lien du direct, pénalité, centre de lancement", () => {
  it("TournamentLiveLink_field_readOnlyWhileSending", () => {
    const code = source(DIR + "TournamentLiveLink.tsx");
    expect(code).toMatch(/readOnly=\{busy\}\s+maxLength=\{MAX_STREAM_URL_LENGTH\}/);
    expect(code).not.toContain('busy ? "…"');
  });

  it("EndurancePenalty_fields_readOnlyWhileSending", () => {
    const code = source(DIR + "EndurancePenaltyDialog.tsx");
    expect(code.match(/readOnly=\{busy\}/g)).toHaveLength(2);
    expect(code).toMatch(/busy=\{busy\}\s+blocked=\{violation !== null\}/);
  });

  it("MatchLaunchCenter_busyButtons_keepTheirLabel", () => {
    const code = source(LAUNCH);
    expect(code).not.toMatch(/function busyLabel/);
    expect(code).toContain('pending={`${t("confirmReady")}…`}');
    expect(code).toContain('pending={`${t("cancelReady")}…`}');
    expect(code.match(/ref=\{readyRef\}/g)).toHaveLength(2);
  });

  it("MatchLaunchCenter_openConfirmAndBack_ignoredWhileSending", () => {
    const code = source(LAUNCH);
    expect(code).toMatch(/if \(isBusy\(\)\) return;\s+pendingFocusRef\.current = "confirm";\s+setConfirming\(true\);/);
    expect(code).toMatch(/if \(isBusy\(\)\) return;\s+pendingFocusRef\.current = "ready";\s+setConfirming\(false\);/);
  });
});

describe("cases et radios figées pendant l'envoi", () => {
  const globals = source("app/globals.css");

  it("globals_ariaFrozenCheckboxes_lookOffLikeDisabled", () => {
    // `aria-disabled` (radios du cadrage) et `aria-readonly` (cases fantômes, manche) :
    // mêmes couleurs que `:disabled`, cochées comprises.
    expect(globals).toMatch(
      /input\[type="radio"\]:disabled,\s+input\[type="checkbox"\]\[aria-disabled="true"\],\s+input\[type="radio"\]\[aria-disabled="true"\],\s+input\[type="checkbox"\]\[aria-readonly="true"\],\s+input\[type="radio"\]\[aria-readonly="true"\],\s+form\[data-frozen\] input\[type="checkbox"\],\s+form\[data-frozen\] input\[type="radio"\] \{/,
    );
    expect(globals).toMatch(/form\[data-frozen\] input\[type="radio"\]:checked \{/);
  });

  it("globals_ariaFrozenCheckboxes_noHoverHighlight", () => {
    expect(globals).toContain(
      'input[type="checkbox"]:hover:not(:disabled):not([aria-disabled="true"]):not([aria-readonly="true"]):not(form[data-frozen] *):not(:checked):not(:focus-visible)',
    );
  });

  it("ImagePickerCss_frozenFitMode_noHoverAndWaitCursor", () => {
    const css = source(FORM_DIR + "TournamentImagePicker.module.css");
    expect(css).toContain(".mode:has(input:enabled):not(.modeFrozen):hover {");
    expect(css).toMatch(/\.modeFrozen \{\s+cursor: progress;/);
    expect(source(FORM_DIR + "TournamentImagePicker.tsx")).toContain('${busy ? s.modeFrozen : ""}');
  });

  it("TournamentForm_busy_formFrozenAndSetterGuarded", () => {
    const form = source(FORM_DIR + "TournamentForm.tsx");
    expect(form).toContain("data-frozen={loading || undefined}");
    expect(form).toMatch(/const set = <K[^\n]*\n\s*\/\/[^\n]*\n\s+if \(isBusy\(\)\) return;/);
    expect(form).toContain('onEdit={() => !isBusy() && fieldErrors.clear("maxTeams")}');
    expect(form).toMatch(/onCheckedChange=\{\(checked\) => \{\s+if \(isBusy\(\)\) return;/);
  });

  it("globals_frozenForm_checkboxesSelectsAndButtonsDimmedByColour", () => {
    expect(globals).toContain('form[data-frozen] input[type="checkbox"]:checked');
    expect(globals).toMatch(/form\[data-frozen\] select,\s+form\[data-frozen\] button:not\(\[type="submit"\]\)/);
    const block = globals.slice(globals.indexOf("form[data-frozen] select,"));
    expect(block.slice(0, block.indexOf("}"))).not.toContain("opacity");
  });

  it("dialogs_blockedButtons_useDimDisabledNotCyberButton", () => {
    expect(source(DIR + "TournamentDialogShell.tsx")).toContain('className="dim-disabled"');
    expect(source(DIR + "TournamentLiveLink.tsx")).toMatch(/<form\s+className="dim-disabled"/);
    const image = source(DIR + "TournamentImageDialog.tsx");
    expect(image).toContain('className="dim-disabled"');
    expect(image).not.toContain("CyberButton");
  });

  it("GhostCss_busyLinkButton_keepsReadableColour", () => {
    const css = source(DIR + "GhostRegistrationDialog.module.css");
    expect(css).toMatch(/\[aria-busy="true"\] \{[^}]*color: var\(--blue-300/);
  });
});
