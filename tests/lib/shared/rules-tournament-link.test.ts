import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseRulesTournamentParam, rulesHrefWithTournament } from "@/lib/shared/rules-tournament-link";

describe("paramètre ?tournoi= des règles", () => {
  it("n'accepte qu'un entier positif en base 10", () => {
    expect(parseRulesTournamentParam("12")).toBe(12);
    expect(parseRulesTournamentParam(["7", "8"])).toBe(7);
    for (const bad of [undefined, "", "0", "-3", "1.5", "012", "1e3", "abc", "99999999999999999"]) {
      expect(parseRulesTournamentParam(bad)).toBeNull();
    }
  });

  it("construit le lien des règles portant le tournoi", () => {
    expect(rulesHrefWithTournament("/regles/survie", 42)).toBe("/regles/survie?tournoi=42");
  });
});

// Le bouton « ? » de la fiche (composant client) importe ce module : il ne doit
// rien tirer d'autre dans son bundle — ni le constructeur des réglages, ni la
// configuration du moteur.
describe("rules-tournament-link — sans dépendance", () => {
  it("n'importe aucun module", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/shared/rules-tournament-link.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\bfrom\s+["']/);
  });

  it("est la seule porte du bouton des règles vers ce lien", () => {
    const fab = readFileSync(path.join(process.cwd(), "components/rules/RulesHelpFab.tsx"), "utf8");
    expect(fab).toContain('from "@/lib/shared/rules-tournament-link"');
    expect(fab).not.toContain("@/lib/shared/tournament-settings");
  });
});
