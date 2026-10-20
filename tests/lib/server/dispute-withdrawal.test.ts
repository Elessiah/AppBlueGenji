import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import frRules from "@/messages/fr/rules.json";
import enRules from "@/messages/en/rules.json";

/**
 * Abandon du tournoi pendant un litige (`docs/features/SCORE_DISPUTE_LOCK.md`
 * § Abandon du tournoi, décision du 2026-10-20) : il **reste permis** et clôt la
 * manche en litige comme une défaite de l'équipe qui abandonne. Le verrou ne
 * vise que le forfait **du match** — aucun moteur d'abandon ne le consulte.
 */
const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const WITHDRAWAL_ENGINES = [
  "lib/server/tournaments/survival.ts",
  "lib/server/tournaments/swiss.ts",
  "lib/server/tournaments/bg-survie/forfeit.ts",
];

describe("abandon du tournoi pendant un litige", () => {
  it.each(WITHDRAWAL_ENGINES)("%s ne consulte pas le verrou du litige", (path) => {
    const code = source(path);
    expect(code).not.toContain("assertNoOpenDispute");
    expect(code).not.toContain("SCORE_LOCKED_DISPUTE");
  });

  it("le forfait du match, lui, reste verrouillé", () => {
    expect(source("lib/server/tournaments/player-forfeit.ts")).toContain("assertNoOpenDispute");
  });

  it("/regles le dit, en français et en anglais", () => {
    const fr = JSON.stringify(frRules);
    const en = JSON.stringify(enRules);
    expect(fr).toContain(
      "Abandonner le tournoi, là où le format le permet, reste possible pendant un litige : le match en litige est alors perdu par l'équipe qui abandonne.",
    );
    expect(en).toContain(
      "Withdrawing from the tournament, where the format allows it, remains possible during a dispute: the disputed match is then lost by the withdrawing team.",
    );
    // Les deux autres décisions du 2026-10-20, même page.
    expect(fr).toContain("Un arbitre qui joue ce match peut le trancher, mais les autres membres du staff en sont avertis.");
    expect(en).toContain("A referee who plays in this match may settle it, but the other staff members are warned.");
    expect(fr).toContain("Un arbitre qui enregistre l'avancement du match sans le trancher la suspend");
    // « this automatic confirmation » : c'est elle, pas le match, qui est suspendue (FR « la suspend »).
    expect(en).toContain("A referee who saves the match's progress without settling it pauses this automatic confirmation");
    // Contester ne tranche pas : cela ouvre un litige, que seul un arbitre règle.
    expect(fr).toContain("à moins que l'adversaire ne le confirme ; le contester ouvre un litige.");
    expect(en).toContain("unless the opponent confirms it; disputing it opens a dispute.");
    expect(fr).not.toContain("ne confirme ou ne conteste");
  });
});
