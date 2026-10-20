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
    // Arbitre qui joue (décision du 2026-10-20, 15:02) : vrai dans tous les cas —
    // abandon imposé compris, seul membre du staff (journal seul), hors litige (aucune alerte).
    expect(fr).toContain(
      "Un arbitre qui joue ce match peut le trancher, y compris en imposant l'abandon de l'équipe adverse, mais les autres membres du staff en sont avertis (s'il est le seul membre du staff, son geste reste consigné au journal de l'arbitrage). Hors litige, un arbitre qui joue un match le valide sans que personne n'en soit averti.",
    );
    expect(en).toContain(
      "A referee who plays in this match may settle it, including by imposing the opposing team's withdrawal, but the other staff members are warned (if they are the only staff member, their action is still recorded in the refereeing log). Outside a dispute, a referee who plays in a match confirms it without anyone being warned.",
    );
    // Corriger un résultat acquis d'un match qu'il joue avertit aussi (revue sécurité, passe 4).
    expect(fr).toContain("Corriger le résultat d'un match qu'il joue avertit les autres membres du staff, comme trancher un litige.");
    expect(en).toContain("Correcting the result of a match they play in warns the other staff members, like settling a dispute.");
    // La suspension posée par un arbitre qui joue avertit aussi.
    expect(fr).toContain("le contester ouvre un litige. Si cet arbitre joue ce match, les autres membres du staff en sont avertis (s'il est le seul membre du staff, son geste reste consigné au journal de l'arbitrage).");
    expect(en).toContain("disputing it opens a dispute. If this referee plays in this match, the other staff members are warned (if they are the only staff member, their action is still recorded in the refereeing log).");
    // « après cette déclaration » : un « Enregistrer » antérieur au report ne suspend rien (`pauseAutoValidation`).
    expect(fr).toContain("Un arbitre qui, après cette déclaration, enregistre l'avancement du match sans le trancher la suspend");
    // « this automatic confirmation » : c'est elle, pas le match, qui est suspendue (FR « la suspend »).
    expect(en).toContain("A referee who, after this report, saves the match's progress without settling it pauses this automatic confirmation");
    // Contester ne tranche pas : cela ouvre un litige, que seul un arbitre règle.
    expect(fr).toContain("à moins que l'adversaire ne le confirme ; le contester ouvre un litige.");
    expect(en).toContain("unless the opponent confirms it; disputing it opens a dispute.");
    expect(fr).not.toContain("ne confirme ou ne conteste");
  });
});
