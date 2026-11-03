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
    // `useConfirmWhile` porte la remise à zéro (voir plus bas).
    reset: "const [confirmForce, setConfirmForce] = useConfirmWhile(hasForce);",
    guard: "{confirmForce && (",
    opener: "force: () => setConfirmForce(true),",
    openers: /setConfirmForce\(true\)/g,
    close: "onClose={() => setConfirmForce(false)}",
  },
  {
    file: "MatchPlanningPanel.tsx",
    reset: "if (confirmEnable && (enabled || !toggleable)) setConfirmEnable(false);",
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

describe("useConfirmWhile — la règle commune de MatchCardActions.tsx", () => {
  const source = read("MatchCardActions.tsx");

  it("useConfirmWhile_actionGone_forgetsAndHidesTheConfirmation", () => {
    expect(source).toContain("if (open && !present) setOpen(false);");
    expect(source).toContain("return [open && present, setOpen] as const;");
  });

  it("useConfirmWhile_everyPendingModal_goesThroughTheHook", () => {
    // Plus aucune copie à la main de la règle : chaque modale passe par le hook.
    expect(source).not.toContain("if (confirmForce && !hasForce)");
    expect(source).not.toContain("if (contactsOpen && !actions.some");
    expect(source).toContain('const [contactsOpen, setContactsOpen] = useConfirmWhile(actions.some((a) => a.id === "contacts"));');
  });

  it("useConfirmWhile_contactsModal_singleOpener", () => {
    expect(source).toContain("contacts: () => setContactsOpen(true),");
    expect(source.match(/setContactsOpen\(true\)/g)).toHaveLength(1);
    expect(source).toContain("onClose={() => setContactsOpen(false)}");
  });
});
