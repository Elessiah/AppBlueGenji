import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Pendant une requête, les boutons des écrans d'équipe restaient `disabled` :
 * le focus clavier tombait sur le `<body>` et un lecteur d'écran perdait sa
 * place. Ils restent focalisables (`aria-disabled`, `aria-busy`), et le
 * gestionnaire ignore un second clic.
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
    // Seule une case à cocher garde `disabled={loading}` (CreateTeamForm) : un champ, pas un bouton.
    const buttons = source(path).match(/<button[\s\S]*?<\/button>/g) ?? [];

    for (const button of buttons) {
      expect(button).not.toMatch(/\sdisabled=\{(?:pending|loading|busy|logoBusy|saving|inviting)\}/);
      expect(button).not.toMatch(/\sdisabled=\{[^}]*\|\|\s*(?:pending|loading|busy|logoBusy|saving|inviting)\}/);
    }
  });

  it.each(SCREENS.map((path) => [path]))("%s annonce l'envoi par aria-busy", (path) => {
    expect(source(path)).toMatch(/aria-busy=\{(?:pending|loading|busy|logoBusy|saving|inviting|cancellingId === invitation\.id) \|\| undefined\}/);
  });

  // Enregistrer les réglages et inviter : jamais `disabled`, ni pendant
  // l'envoi ni après (formulaire redevenu propre) — le focus reste sur le bouton.
  it("TeamSettings_saveWhileSaving_staysFocusable", () => {
    const code = source("app/(secured)/equipes/[id]/_components/TeamSettings.tsx");
    expect(code).toMatch(/aria-disabled=\{!canSave \|\| undefined\}\s+aria-busy=\{saving \|\| undefined\}/);
    expect(code).not.toMatch(/\sdisabled=\{!canSave\}/);
  });

  it("MembersSection_inviteWhileInviting_staysFocusable", () => {
    const code = source("app/(secured)/equipes/[id]/_components/MembersSection.tsx");
    // L'envoi vit dans la modale des rôles (`InviteRolesDialog`) : le bouton
    // de la page ne fait que l'ouvrir, sans attente à montrer.
    expect(code).toMatch(/aria-disabled=\{!canInvite \|\| undefined\}/);
    const dialog = source("app/(secured)/equipes/[id]/_components/InviteRolesDialog.tsx");
    expect(dialog).toMatch(/aria-disabled=\{pending \|\| undefined\}\s+aria-busy=\{pending \|\| undefined\}/);
    expect(dialog).toMatch(/if \(pending\) return;/);
    expect(code).not.toMatch(/\sdisabled=\{!canInvite\}/);
  });

  it("RolesDialog_submitWhilePending_ignoredByHandler", () => {
    expect(source("app/(secured)/equipes/[id]/_components/RolesDialog.tsx")).toMatch(/if \(unchanged \|\| pending\) return;/);
  });

  it("teamModuleCss_ariaDisabledButton_isDimmedAndNotAllowed", () => {
    const css = source("app/(secured)/equipes/[id]/team.module.css");
    expect(css).toMatch(/\.page :global\(\.btn\):where\(:disabled, \[aria-disabled="true"\]\) \{[^}]*cursor: not-allowed;[^}]*opacity: 0\.55;/);
  });

  it("teamModuleCss_busyButton_keepsLabelReadable", () => {
    const css = source("app/(secured)/equipes/[id]/team.module.css");
    expect(css).toMatch(/\[aria-disabled="true"\]\[aria-busy="true"\] \{[^}]*opacity: 1;[^}]*cursor: progress;/);
  });

  it("globalsCss_dimDisabledScope_definesDimmedAndBusyRules", () => {
    const css = source("app/globals.css");
    expect(css).toMatch(/\.dim-disabled \.btn\[aria-disabled="true"\] \{[^}]*opacity: 0\.55;/);
    expect(css).toMatch(/\.dim-disabled \.btn\[aria-disabled="true"\]\[aria-busy="true"\] \{[^}]*opacity: 1;/);
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

  it("MembershipActions_act_usesSynchronousRefLock", () => {
    const code = source("app/(secured)/equipes/[id]/_components/MembershipActions.tsx");
    expect(code).toMatch(/if \(busyRef\.current\) return false;\s+busyRef\.current = true;\s+setBusy\(true\);/);
    expect(code).toMatch(/finally \{\s+busyRef\.current = false;/);
  });
});
