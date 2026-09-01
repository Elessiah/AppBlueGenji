import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canForfeitTeam,
  type ForfeitContext,
} from "@/app/(secured)/tournois/[id]/_lib/forfeit";

const MY_TEAM = 77;
const OTHER_TEAM = 88;

function context(overrides: Partial<ForfeitContext> = {}): ForfeitContext {
  return {
    format: "SURVIVAL",
    state: "RUNNING",
    isAdmin: false,
    myTeamId: MY_TEAM,
    canCreateReportsForTeamIds: [MY_TEAM],
    ...overrides,
  };
}

describe("forfait — éligibilité du bouton", () => {
  it("autorise un représentant à déclarer le forfait de son équipe", () => {
    expect(canForfeitTeam(context(), MY_TEAM)).toBe(true);
  });

  it("refuse à un représentant le forfait d'une autre équipe", () => {
    expect(canForfeitTeam(context(), OTHER_TEAM)).toBe(false);
  });

  it("refuse à un simple membre, qui ne représente pas l'équipe", () => {
    expect(canForfeitTeam(context({ canCreateReportsForTeamIds: [] }), MY_TEAM)).toBe(false);
  });

  it("refuse à un spectateur sans équipe", () => {
    expect(
      canForfeitTeam(context({ myTeamId: null, canCreateReportsForTeamIds: [] }), OTHER_TEAM),
    ).toBe(false);
  });

  it("autorise l'arbitrage sur n'importe quelle équipe", () => {
    const referee = context({ isAdmin: true, myTeamId: null, canCreateReportsForTeamIds: [] });
    expect(canForfeitTeam(referee, MY_TEAM)).toBe(true);
    expect(canForfeitTeam(referee, OTHER_TEAM)).toBe(true);
  });
});

describe("forfait — restrictions de contexte", () => {
  it("n'existe que dans un tournoi en cours", () => {
    for (const state of ["UPCOMING", "REGISTRATION", "FINISHED"] as const) {
      expect(canForfeitTeam(context({ state }), MY_TEAM)).toBe(false);
      // Même l'arbitrage ne peut pas forfaiter hors tournoi en cours
      expect(canForfeitTeam(context({ state, isAdmin: true }), MY_TEAM)).toBe(false);
    }
  });

  it("n'existe que dans les formats à classement (Survie, Ronde suisse)", () => {
    // En élimination, une équipe qui renonce perd son match : il n'y a rien à
    // abandonner en dehors du terrain.
    for (const format of ["SINGLE", "DOUBLE"] as const) {
      expect(canForfeitTeam(context({ format }), MY_TEAM)).toBe(false);
      expect(canForfeitTeam(context({ format, isAdmin: true }), MY_TEAM)).toBe(false);
    }
    for (const format of ["SURVIVAL", "SWISS", "BG_SURVIE"] as const) {
      expect(canForfeitTeam(context({ format }), MY_TEAM)).toBe(true);
      expect(canForfeitTeam(context({ format, isAdmin: true }), OTHER_TEAM)).toBe(true);
    }
  });
});

/**
 * Les vues sont des composants clients, sans DOM en test : le câblage se
 * vérifie donc au niveau source, comme ailleurs dans le projet. L'invariant
 * tenu ici est le seul qu'aucun test de comportement ne peut porter — la règle
 * d'éligibilité autorisait déjà l'abandon en BlueGenji Survie, et la route
 * l'acceptait, mais la vue du mode n'offrait aucun bouton pour le déclarer.
 */
describe("abandon — câblage des vues à classement", () => {
  const ROOT = join(__dirname, "..", "..");
  const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
  const page = read("app/(secured)/tournois/[id]/page.tsx");
  const enduranceView = read("app/(secured)/tournois/[id]/_components/EnduranceView.tsx");

  it("passe la règle d'éligibilité et l'action aux trois vues", () => {
    const wired = page.match(/canForfeit=\{canForfeit\}/g) ?? [];
    const handlers = page.match(/onForfeit=\{forfeitTeam\}/g) ?? [];
    // Survie, Ronde suisse, BlueGenji Survie.
    expect(wired).toHaveLength(3);
    expect(handlers).toHaveLength(3);
  });

  it("n'offre l'abandon en BlueGenji Survie que sur une équipe encore en lice", () => {
    // Trois conditions, toutes portées par la même règle de ligne : tournoi non
    // clos, équipe active, et la décision d'éligibilité déléguée à la page.
    const rule = enduranceView.slice(
      enduranceView.indexOf("const canForfeitRow"),
      enduranceView.indexOf("const showActions"),
    );
    expect(rule).toContain("!isFinished");
    expect(rule).toContain('status === "ACTIVE"');
    expect(rule).toContain("canForfeit(teamId)");
  });

  it("retire l'abandon dès les play-offs, que le service ne sait pas clore", () => {
    // `forfeitEnduranceTeam` ne clôt qu'un match de `endurance_current_round` :
    // l'arbre final est hors de sa portée, et un abandon accepté y laisserait un
    // match ouvert pour une équipe déclarée forfait.
    const rule = enduranceView.slice(
      enduranceView.indexOf("const canForfeitRow"),
      enduranceView.indexOf("const showActions"),
    );
    expect(rule).toContain("!endurance.playoffsStarted");
  });

  it("laisse le gabarit du classement en feuille de style, pas en style en ligne", () => {
    // Un style en ligne l'emporte sur la media query qui replie `.table-row` en
    // une colonne sous 920 px : le gabarit doit rester une classe.
    expect(enduranceView).not.toContain("gridTemplateColumns");

    const css = read("app/(secured)/tournois/[id]/_components/EnduranceView.module.css");
    expect(css).toContain("@media (max-width: 920px)");
    expect(css).toContain("grid-template-columns: 1fr;");
  });
});
