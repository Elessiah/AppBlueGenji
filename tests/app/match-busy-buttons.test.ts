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
    expect(code).toMatch(/\{toggleLabel\}\s+\{busy && "…"\}/);
  });

  it("EntrantContactsPanel_reopenDuringLoad_rereadsAfter", () => {
    const code = source(DIR + "EntrantContactsPanel.tsx");
    expect(code).toMatch(/if \(!retry\) rereadRef\.current = true;/);
    expect(code).toMatch(/if \(rereadRef\.current\) \{\s+rereadRef\.current = false;\s+void load\(\);/);
  });

  it("EntrantContactsPanel_sameFailureAgain_alertReplaced", () => {
    const code = source(DIR + "EntrantContactsPanel.tsx");
    expect(code).toMatch(/setFailures\(\(count\) => count \+ 1\)/);
    expect(code).toMatch(/<p key=\{failures\}/);
  });

  it.each(SCREENS.map((file) => [file]))("%s_focusableBusyButton_alsoAnnouncesBusy", (file) => {
    for (const button of buttonsOf(source(DIR + file))) {
      if (!new RegExp(String.raw`aria-disabled=\{[^}]*\b(?:${BUSY}|waiting)\b`).test(button)) continue;
      expect(button).toMatch(/aria-busy=|busyProps/);
    }
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
});
