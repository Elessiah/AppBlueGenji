import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Une confirmation (`ConfirmActionDialog`) ne s'ouvre que sur un clic : l'état
 * « confirmation en attente » est **oublié** dès que son action disparaît
 * (instantané du flux), pas seulement masqué — sinon la modale se rouvrirait
 * seule au retour de l'action. Pas de rendu DOM dans la suite (environnement
 * `node`) : la remise à zéro, la garde d'affichage et le seul déclencheur
 * (le clic) sont vérifiés dans la source, comme le panneau « Plus d'actions ».
 */
const read = (file: string) =>
  readFileSync(join(__dirname, "..", "..", "app/(secured)/tournois/[id]/_components", file), "utf8");

const CASES = [
  {
    file: "MatchCardActions.tsx",
    reset: "if (confirmForce && !hasForce) setConfirmForce(false);",
    guard: "{confirmForce && hasForce && (",
    opener: "force: () => setConfirmForce(true),",
    openers: /setConfirmForce\(true\)/g,
    close: "onClose={() => setConfirmForce(false)}",
  },
  {
    file: "MatchPlanningPanel.tsx",
    reset: "if (confirmEnable && enabled) setConfirmEnable(false);",
    guard: "{confirmEnable && !enabled && (",
    opener: "setConfirmEnable(true)",
    openers: /setConfirmEnable\(true\)/g,
    close: "setConfirmEnable(false)",
  },
  {
    file: "RegistrationsPanel.tsx",
    reset: "if (confirmingMove !== null && !reorderable) setConfirmingMove(null);",
    guard: "{confirmingMove !== null && reorderable && (",
    opener: "setConfirmingMove({",
    openers: /setConfirmingMove\(\{/g,
    close: "setConfirmingMove(null)",
  },
];

describe.each(CASES)("confirmation en attente — $file", ({ file, reset, guard, opener, openers, close }) => {
  const source = read(file);

  it("l'action disparue puis revenue : la confirmation est oubliée, la modale reste fermée", () => {
    expect(source).toContain(reset);
    // La remise à zéro précède le rendu de la modale : elle agit au rendu même
    // où l'action disparaît, avant tout retour.
    expect(source.indexOf(reset)).toBeLessThan(source.indexOf(guard));
  });

  it("garde la modale masquée tant que l'action n'est pas offerte", () => {
    expect(source).toContain(guard);
  });

  it("ne s'ouvre que par un clic explicite (un seul déclencheur)", () => {
    expect(source).toContain(opener);
    expect(source.match(openers)).toHaveLength(1);
  });

  it("annuler ou confirmer referme toujours la modale", () => {
    expect(source).toContain(close);
  });
});
