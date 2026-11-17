import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Pendant une requête, les boutons des dialogues de match et d'arbitrage
 * restaient `disabled` : le focus clavier tombait sur le `<body>` et un lecteur
 * d'écran perdait sa place. Ils restent focalisables (`aria-disabled`,
 * `aria-busy`), le gestionnaire ignore un second geste, et une garde
 * synchrone (`useRef`) écarte le double envoi qui part avant le rendu.
 *
 * Un **champ** peut garder `disabled` : les listes déroulantes de l'arbitrage
 * et de la date (le focus est sur le bouton qui envoie, une liste n'envoie
 * pas le formulaire), la liste des maps d'un score (`MapScoreList`, Entrée n'y
 * envoie pas) et les points par map (`RoundMapsDialog`) — les valeurs en
 * cours d'envoi ne doivent pas changer sous la requête.
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
const buttonsOf = (code: string) => code.match(/<button[\s\S]*?<\/button>/g) ?? [];

describe("dialogues de match et d'arbitrage — boutons pendant une requête", () => {
  it.each(SCREENS.map((file) => [file]))("%s ne désactive aucun bouton par l'état de la requête", (file) => {
    for (const button of buttonsOf(source(DIR + file))) {
      expect(button).not.toMatch(new RegExp(String.raw`\sdisabled=\{(?:${BUSY})[\s|}]`));
      expect(button).not.toMatch(new RegExp(String.raw`\sdisabled=\{[^}]*\|\|\s*(?:${BUSY})\b`));
    }
  });

  it.each(SCREENS.map((file) => [file]))("%s annonce l'attente par aria-busy", (file) => {
    expect(source(DIR + file)).toMatch(new RegExp(String.raw`aria-busy=\{(?:${BUSY}|waiting) \|\| undefined\}|"aria-busy": busy \|\| undefined`));
  });

  it.each([
    ["RefereeDialog.tsx", "busyRef"],
    ["MatchScheduleDialog.tsx", "busyRef"],
    ["CastSettingsDialog.tsx", "busyRef"],
    ["MatchReplayDialog.tsx", "busyRef"],
    ["MatchLiveDialog.tsx", "busyRef"],
    ["IssueReportDialog.tsx", "busyRef"],
    ["PlayerScoreDialog.tsx", "submittingRef"],
    ["RoundMapsDialog.tsx", "busyRef"],
    ["MatchPlanningPanel.tsx", "busyRef"],
    ["MatchCardActions.tsx", "busyRef"],
    ["EntrantContactsPanel.tsx", "loadingRef"],
  ])("%s_sendWhileSending_ignoredBySynchronousGuard", (file, ref) => {
    expect(source(DIR + file)).toMatch(new RegExp(String.raw`if \((?:!match \|\| )?${ref}\.current[^)]*\) return`));
  });

  it("useScoreForm_submitWhileSubmitting_ignoredBySynchronousGuard", () => {
    const code = source("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    expect(code).toMatch(/if \(!match \|\| submittingRef\.current\) return false;/);
    expect(code).toMatch(/submittingRef\.current = true;\s+setSubmitting\(true\);/);
    expect(code).toMatch(/finally \{\s+submittingRef\.current = false;/);
  });

  it("useOnAirToggle_toggleWhileInFlight_ignored", () => {
    const code = source("app/(secured)/tournois/[id]/_lib/use-on-air-toggle.ts");
    expect(code).toMatch(/if \(inFlight\.current\) return;\s+inFlight\.current = true;/);
    expect(code).toMatch(/finally \{\s+inFlight\.current = false;/);
  });

  it("RefereeDialog_confirmAndClose_ignoredWhileBusy", () => {
    const code = source(DIR + "RefereeDialog.tsx");
    expect(code).toMatch(/const ask = \(pending: PendingConfirm\) => \{\s+if \(!busyRef\.current\) setConfirm\(pending\);/);
    expect(code).toMatch(/const close = \(\) => \{\s+if \(!busyRef\.current\) onClose\(\);/);
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
      /if \(busyRef\.current \|\| urlInvalid \|\| triggerNeedsDate \|\| invalidCasterLink \|\| saveReason !== null\) return;/,
    );
  });

  it("MatchCardActions_waitingAction_clickIgnored", () => {
    const code = source(DIR + "MatchCardActions.tsx");
    expect(code).toMatch(/const waiting = busy && writes\(id\);/);
    expect(code).toMatch(/aria-disabled=\{waiting \|\| blocked \|\| undefined\}\s+aria-busy=\{waiting \|\| undefined\}/);
    expect(code).toMatch(/onClick=\{\(\) => \{\s+if \(waiting\) return;/);
  });

  it("MatchCardActionsCss_busyItem_sharesWaitingLook", () => {
    expect(source(DIR + "MatchCardActions.module.css")).toMatch(/\.item\[aria-busy="true"\] \{[^}]*cursor: progress;/);
  });

  it("EntrantContactsPanel_retry_keepsErrorViewWhileReloading", () => {
    const code = source(DIR + "EntrantContactsPanel.tsx");
    expect(code).toMatch(/if \(!retry\) setFailure\(null\);/);
    expect(code).toMatch(/void load\(true\)/);
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
});
