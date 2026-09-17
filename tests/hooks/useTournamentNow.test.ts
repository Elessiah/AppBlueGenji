import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Le harnais Jest tourne en environnement `node`, sans DOM ni bibliothèque de
 * rendu : un hook React n'y est pas montable. Ce qui compte se teste donc là où
 * il vit — `nextTournamentStateChangeAt`, pure et couverte par
 * `tests/lib/shared/tournament-state.test.ts`. Restent deux garanties de
 * structure, qui n'ont pas d'autre endroit où être tenues :
 *
 * 1. le module **s'importe** : c'est un fichier `"use client"` qui tire React,
 *    et une erreur de chemin y passerait inaperçue jusqu'au build ;
 * 2. les dépendances d'effet sont des **primitives**. `TournamentStateInput`
 *    accepte une `Date`, qui est une nouvelle référence à chaque rendu : mise en
 *    dépendance, elle relancerait `setNow`, qui provoquerait le rendu suivant,
 *    en boucle serrée jusqu'au « Maximum update depth exceeded ». C'est la panne
 *    qu'`useMatchLiveState` documente, et aucun test de logique ne la voit.
 */

const SOURCE = join(__dirname, "..", "..", "lib", "shared", "hooks", "useTournamentNow.ts");

describe("useTournamentNow", () => {
  it("s'importe et expose un hook", () => {
    const module = require("@/lib/shared/hooks/useTournamentNow");
    expect(typeof module.useTournamentNow).toBe("function");
  });

  it("prend le tournoi en unique argument", () => {
    const { useTournamentNow } = require("@/lib/shared/hooks/useTournamentNow");
    expect(useTournamentNow.length).toBe(1);
  });

  it("ne met jamais l'objet du tournoi en dépendance d'effet", () => {
    const source = readFileSync(SOURCE, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const deps = [...source.matchAll(/\}, \[([^\]]*)\]\);/g)].map((match) => match[1]);

    expect(deps.length).toBeGreaterThan(0);
    for (const dep of deps) {
      expect(dep).not.toMatch(/\btournament\b/);
    }
  });

  it("plafonne le délai et garantit de dépasser la frontière", () => {
    // Deux pièges partagés avec `useScheduledBuckets` : `setTimeout` sature
    // au-delà de ~24,8 jours (et se déclenche alors immédiatement, en boucle),
    // et une horloge encore en deçà au réveil redonnerait la même frontière avec
    // un délai nul.
    const source = readFileSync(SOURCE, "utf8");

    expect(source).toContain("2_147_483_647");
    expect(source).toMatch(/setNow\(Math\.max\(at, Date\.now\(\)\)\)/);
  });

  it("ne pose aucun minuteur quand il n'y a plus de bascule", () => {
    const source = readFileSync(SOURCE, "utf8");

    expect(source).toMatch(/if \(at === null\) return;/);
  });
});
