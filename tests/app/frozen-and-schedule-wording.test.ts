import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import enActions from "@/messages/en/tournamentActions.json";
import frActions from "@/messages/fr/tournamentActions.json";
import enDialogs from "@/messages/en/tournamentDialogs.json";
import frDialogs from "@/messages/fr/tournamentDialogs.json";

/**
 * Textes et câblage des suivis EF-26 : formes courtes lues sur les lignes
 * figées (le motif complet vit dans la légende), aide « Sans jour = aucun
 * horaire », légende du journal des sanctions figées.
 */
const source = (file: string) => readFileSync(join(process.cwd(), "app/(secured)/tournois/[id]/_components", file), "utf8");

describe("forme courte d'une ligne figée", () => {
  it("existe en français et en anglais pour l'abandon et la pénalité, plus courte que le motif complet", () => {
    for (const [actions, short] of [
      [frActions, "(manche jouée depuis)"],
      [enActions, "(round played since)"],
    ] as const) {
      expect(actions.forfeitCancel.frozenShort).toBe(short);
      expect(actions.penaltyLift.frozenShort).toBe(short);
      expect(actions.forfeitCancel.frozenShort.length).toBeLessThan(actions.forfeitCancel.frozenTitle.length);
      expect(actions.penaltyLift.frozenShort.length).toBeLessThan(actions.penaltyLift.frozenTitle.length);
    }
  });

  it("la ligne figée lit la forme courte, jamais le motif complet", () => {
    const row = source("ForfeitRowAction.tsx");
    expect(row).toContain('<span className="sr-only"> {props.note}</span>');
    for (const file of ["SwissView.tsx", "SurvivalView.tsx", "EnduranceView.tsx"]) {
      const view = source(file);
      expect(view).toContain('note: a("forfeitCancel.frozenShort")');
      expect(view).not.toMatch(/title: a\("forfeitCancel\.frozenTitle"\)/);
    }
  });
});

describe("sanction figée du journal d'endurance", () => {
  const view = source("EnduranceView.tsx");

  it("le motif n'est plus dans un `title` : forme courte masquée sur l'élément, motif complet derrière le « i » de la légende", () => {
    expect(view).not.toMatch(/title=\{a\("penaltyLift\.frozenTitle"\)\}/);
    expect(view).toContain('<span className="sr-only"> {a("penaltyLift.frozenShort")}</span>');
    expect(view).toMatch(/<FrozenForfeitLegend\s+id="endurance-penalty-frozen"\s+label=\{a\("penaltyLift\.frozen"\)\}\s+reason=\{a\("penaltyLift\.frozenTitle"\)\}/);
  });

  it("la légende n'apparaît que si une sanction est figée et que le retrait est proposé", () => {
    expect(view).toContain("onLift !== undefined && penalties.some((penalty) => !penalty.removable)");
  });
});

describe("aide de la date de début : « Sans jour = aucun horaire »", () => {
  it.each(["hint", "hintDirect", "hintDirectTbd"] as const)("%s ne parle plus du mois (FR et EN)", (key) => {
    expect(frDialogs.schedule[key]).toMatch(/^Sans jour = aucun horaire/);
    expect(frDialogs.schedule[key]).not.toContain("ni mois");
    expect(enDialogs.schedule[key]).toMatch(/^No day = no time/);
    expect(enDialogs.schedule[key]).not.toContain("no month");
  });
});

describe("score : aucun bouton d'envoi natif `disabled` hors envoi", () => {
  it("PlayerScoreDialog et AdminScoreDialog gardent le focus après un rafraîchissement (`aria-disabled`)", () => {
    for (const file of ["PlayerScoreDialog.tsx", "AdminScoreDialog.tsx"]) {
      const dialog = source(file);
      const actions = dialog.slice(dialog.indexOf("className={styles.actions}"), dialog.indexOf("</form>"));
      expect(actions).not.toMatch(/(?<!aria-)disabled=\{/);
    }
  });
});
