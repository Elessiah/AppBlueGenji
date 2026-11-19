/**
 * Section « Casters autonomes » du planning (SOLO-CASTER-STAFF) : rendue au
 * staff des tournois (`canManage`) hors du panneau de calcul réservé aux
 * administrateurs — elle ne liste que les casters, avec leur réglage, FR et EN.
 */
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { SoloCastersStaff } from "@/app/(secured)/planning/_components/PlanningBoard";
import { scopedText } from "@/lib/shared/scoped-text";
import type { PlanningMember } from "@/lib/shared/planning-view";
import enPlanning from "@/messages/en/planning.json";
import frPlanning from "@/messages/fr/planning.json";

function member(overrides: Partial<PlanningMember> = {}): PlanningMember {
  return { userId: 1, pseudo: "Membre", roles: ["CASTER"], soloCaster: false, ...overrides };
}

const act = async () => true;

function render(locale: "fr" | "en", members: PlanningMember[]): string {
  const text = scopedText(locale, locale === "fr" ? frPlanning : enPlanning);
  return renderToStaticMarkup(<SoloCastersStaff text={text} view={{ me: 9, members }} pending={null} act={act} />);
}

describe("SoloCastersStaff", () => {
  it("soloCastersStaff_staffView_listsCastersOnlyWithTheirSetting", () => {
    const html = render("fr", [
      member({ userId: 1, pseudo: "Autonome", soloCaster: true }),
      member({ userId: 2, pseudo: "Accompagne" }),
      member({ userId: 3, pseudo: "ProdSeul", roles: ["PROD"] }),
    ]);

    expect(html).toContain("Casters autonomes");
    expect(html).toMatch(/<input type="checkbox" checked=""\/>Autonome/);
    expect(html).toMatch(/<input type="checkbox"\/>Accompagne/);
    expect(html).not.toContain("ProdSeul");
  });

  it("soloCastersStaff_noCaster_rendersNothing", () => {
    expect(render("fr", [member({ roles: ["PROD", "REFEREE"] })])).toBe("");
  });

  it("soloCastersStaff_english_titleTranslated", () => {
    const html = render("en", [member()]);

    expect(html).toContain("Solo casters");
    expect(html).not.toContain("Casters autonomes");
  });
});
