import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { RefereeSchedulingField } from "@/app/(secured)/tournois/_components/RefereeSchedulingField";
import { ENABLE_PLANNING_WHILE_RUNNING_WARNING } from "@/lib/shared/match-planning";

type Props = Parameters<typeof RefereeSchedulingField>[0];

function render(over: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    <RefereeSchedulingField
      mode="edit"
      checked={false}
      editable
      warnUndoesLaunches={false}
      onChange={() => {}}
      {...over}
    />,
  );
}

describe("RefereeSchedulingField", () => {
  it("rend une case modifiable, nommée par son titre", () => {
    const html = render();
    expect(html).toContain('id="referee-scheduling"');
    expect(html).toContain('aria-labelledby="referee-scheduling-label"');
    expect(html).not.toContain("disabled");
    expect(html).toContain("Matchs planifiés par l&#x27;arbitrage");
  });

  it("annonce qu'elle reste modifiable en cours de tournoi", () => {
    expect(render({ mode: "create" })).toContain("Modifiable ensuite, jusqu&#x27;à la clôture");
    expect(render({ mode: "edit" })).toContain("Modifiable jusqu&#x27;à la clôture du tournoi — même en cours.");
  });

  it("verrouille la case sur un tournoi terminé et le dit", () => {
    const html = render({ editable: false, checked: true });
    expect(html).toContain("disabled");
    expect(html).toContain("Le tournoi est terminé");
  });

  it("prévient avant d'enregistrer un allumage qui défait des lancements", () => {
    const html = render({ checked: true, warnUndoesLaunches: true });
    expect(html).toContain("<output");
    expect(html).toContain('aria-describedby="referee-scheduling-hint referee-scheduling-warning"');
    expect(html).toContain("leurs « Prêt » sont effacés");
    expect(ENABLE_PLANNING_WHILE_RUNNING_WARNING).toContain("Les matchs déjà lancés continuent.");
  });

  it("ne prévient de rien hors de ce cas", () => {
    const html = render({ checked: true });
    expect(html).not.toContain("<output");
    expect(html).toContain('aria-describedby="referee-scheduling-hint"');
  });
});
