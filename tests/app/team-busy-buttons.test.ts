import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Pendant une requête, les boutons des écrans d'équipe restaient `disabled` :
 * le focus clavier tombait sur le `<body>` et un lecteur d'écran perdait sa
 * place. Ce sont des `BusyButton` (`aria-disabled`, `aria-busy`, focalisables),
 * et une garde synchrone (`useBusyGuard`) ignore un second clic (EF-71).
 */
const SCREENS = [
  "app/(secured)/equipes/creer/CreateTeamForm.tsx",
  "app/(secured)/equipes/GhostTeamDialog.tsx",
  "app/(secured)/equipes/[id]/_components/RolesDialog.tsx",
  "app/(secured)/equipes/[id]/_components/TransferOwnershipDialog.tsx",
  "app/(secured)/equipes/[id]/_components/ClaimGhostTeamDialog.tsx",
  "app/(secured)/equipes/[id]/_components/MembershipActions.tsx",
  "app/(secured)/equipes/[id]/_components/TeamSettings.tsx",
  "app/(secured)/equipes/[id]/_components/MembersSection.tsx",
] as const;

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("écrans d'équipe — boutons pendant une requête", () => {
  it.each(SCREENS.map((path) => [path]))("%s ne désactive aucun bouton par l'état de la requête", (path) => {
    // Plus aucun `disabled` natif, ni bouton ni champ (les cases sont `aria-readonly`).
    const code = source(path);
    expect(code).not.toMatch(/(?:^|[^-])disabled=\{/m);
    // Un bouton nu ne fait qu'ouvrir une modale : l'attente et le refus passent par `BusyButton`.
    for (const button of code.match(/<button[\s\S]*?<\/button>/g) ?? []) {
      expect(button).not.toMatch(/aria-(?:disabled|busy)=/);
    }
  });

  it.each(SCREENS.map((path) => [path]))("%s annonce l'envoi par BusyButton et une garde synchrone", (path) => {
    const code = source(path);
    expect(code).toContain('import { BusyButton } from "@/components/ui/busy-button";');
    expect(code).toMatch(/<BusyButton[\s\S]*?busy=\{/);
    expect(code).toMatch(/= useBusyGuard\(\);/);
    expect(code).not.toMatch(/aria-busy=\{/);
  });

  // Enregistrer les réglages et inviter : jamais `disabled`, ni pendant
  // l'envoi ni après (formulaire redevenu propre) — le focus reste sur le bouton.
  it("TeamSettings_saveWhileSaving_staysFocusable", () => {
    const code = source("app/(secured)/equipes/[id]/_components/TeamSettings.tsx");
    expect(code).toMatch(/<BusyButton\s+type="submit"\s+className=\{`btn \$\{styles\.primaryButton\}`\}\s+busy=\{saving\}\s+blocked=\{!canSave\}\s+onBlockedClick=\{explainRefusedSave\}\s+>/);
    expect(code).toContain('<BusyLabel busy={saving} idle={t("settings.save")} pending={t("settings.saving")} />');
  });

  it("MembersSection_inviteWhileInviting_staysFocusable", () => {
    const code = source("app/(secured)/equipes/[id]/_components/MembersSection.tsx");
    // L'envoi vit dans la modale des rôles (`InviteRolesDialog`) : le bouton
    // de la page ne fait que l'ouvrir, sans attente à montrer.
    expect(code).toMatch(/<BusyButton type="submit" className=\{`btn \$\{styles\.primaryButton\}`\} busy=\{false\} blocked=\{!canInvite\}>/);
    const dialog = source("app/(secured)/equipes/[id]/_components/InviteRolesDialog.tsx");
    expect(dialog).toContain("const { busy: pending, isBusy, run, hold } = useBusyGuard();");
    expect(dialog).toMatch(/<BusyButton type="submit" className=\{`btn \$\{styles\.primaryButton\}`\} busy=\{pending\}>/);
    expect(dialog).not.toMatch(/(?:^|[^-])disabled=\{/m);
  });

  it("RolesDialog_submitWhilePending_ignoredByHandler", () => {
    const code = source("app/(secured)/equipes/[id]/_components/RolesDialog.tsx");
    // `run` refuse un second envoi tant que le premier court ; `hold` garde l'attente jusqu'à la fermeture.
    expect(code).toMatch(/if \(toSave === null\) return;\s+void run\(async \(\) => \{\s+const ok = await onSave\(toSave\);[\s\S]*?if \(ok\) hold\(\);/);
  });

  it("teamModuleCss_ariaDisabledButton_isDimmedByColoursNotOpacity", () => {
    const css = source("app/(secured)/equipes/[id]/team.module.css");
    // Les couleurs viennent de `.dim-disabled` (globals.css), posée avec `.page`.
    expect(css).toMatch(/\.page :global\(\.btn\):where\(:disabled, \[aria-disabled="true"\]\) \{[^}]*cursor: not-allowed;/);
    expect(css).not.toMatch(/opacity:/);
  });

  it("teamModuleCss_busyButton_keepsLabelReadable", () => {
    const css = source("app/(secured)/equipes/[id]/team.module.css");
    expect(css).toMatch(/\[aria-disabled="true"\]\[aria-busy="true"\] \{[^}]*cursor: progress;/);
    expect(css).not.toMatch(/\[aria-busy="true"\] \{[^}]*color:/);
  });

  it("globalsCss_dimDisabledScope_definesDimmedAndBusyRules", () => {
    const css = source("app/globals.css");
    expect(css).toMatch(/\.dim-disabled \.btn\[aria-disabled="true"\]:not\(\[aria-busy="true"\]\) \{[^}]*color: var\(--ink-dim\);/);
    expect(css).toMatch(/\.dim-disabled \.btn\[aria-disabled="true"\]\[aria-busy="true"\] \{[^}]*cursor: progress;/);
  });

  it.each([
    ["app/(secured)/equipes/creer/CreateTeamForm.tsx"],
    ["app/(secured)/equipes/GhostTeamDialog.tsx"],
  ])("%s_form_carriesDimDisabled", (path) => {
    expect(source(path)).toMatch(/<form className="dim-disabled"/);
  });

  it("MembersSection_labels_useInvisibleNameFallback", () => {
    const code = source("app/(secured)/equipes/[id]/_components/MembersSection.tsx");
    expect(code).toContain('shownEntityName(pseudo, "player", userId, locale)');
    expect(code).not.toMatch(/pseudo: (?:member|invitation|kickTarget)\.pseudo/);
  });

  it("MembershipActions_act_usesSynchronousGuardAndRescuesFocus", () => {
    const code = source("app/(secured)/equipes/[id]/_components/MembershipActions.tsx");
    expect(code).toContain("const outcome = await run(async () => {");
    expect(code).toContain("rescueFocus(rescue);");
    expect(code).not.toContain("busyRef");
  });
});
