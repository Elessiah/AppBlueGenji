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
] as const;

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("écrans d'équipe — boutons pendant une requête", () => {
  it.each(SCREENS.map((path) => [path]))("%s ne désactive aucun bouton par l'état de la requête", (path) => {
    // Seule une case à cocher garde `disabled={loading}` (CreateTeamForm) : un champ, pas un bouton.
    const buttons = source(path).match(/<button[\s\S]*?<\/button>/g) ?? [];

    for (const button of buttons) {
      expect(button).not.toMatch(/\sdisabled=\{(?:pending|loading|busy|logoBusy)\}/);
      expect(button).not.toMatch(/\sdisabled=\{[^}]*\|\|\s*(?:pending|loading|busy|logoBusy)\}/);
    }
  });

  it.each(SCREENS.map((path) => [path]))("%s annonce l'envoi par aria-busy", (path) => {
    expect(source(path)).toMatch(/aria-busy=\{(?:pending|loading|busy|logoBusy) \|\| undefined\}/);
  });

  it("RolesDialog_submitWhilePending_ignoredByHandler", () => {
    expect(source("app/(secured)/equipes/[id]/_components/RolesDialog.tsx")).toMatch(/if \(unchanged \|\| pending\) return;/);
  });
});
