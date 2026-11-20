/**
 * Liste des désistements d'une entrée (staff des tournois) : la sortie d'un
 * invité par le staff (`staffRelease`) se dit « Sorti par le staff », FR et EN
 * (`CAST_PLANNING.md` § Invités).
 */
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { Withdrawals } from "@/app/(secured)/planning/_components/PlanningBoard";
import { scopedText } from "@/lib/shared/scoped-text";
import type { PlanningWithdrawalView } from "@/lib/shared/planning-view";
import enPlanning from "@/messages/en/planning.json";
import frPlanning from "@/messages/fr/planning.json";
import { entryView } from "../helpers/planning";

function row(overrides: Partial<PlanningWithdrawalView> = {}): PlanningWithdrawalView {
  return { userId: 9, role: "CASTER", late: false, reason: null, confirmed: true, createdAt: "2026-11-20T10:00:00.000Z", ...overrides };
}

function render(locale: "fr" | "en", withdrawals: PlanningWithdrawalView[]): string {
  const text = scopedText(locale, locale === "fr" ? frPlanning : enPlanning);
  return renderToStaticMarkup(<Withdrawals entry={entryView({ withdrawals })} text={text} names={new Map([[9, "Test_CasterInvite"]])} />);
}

describe("Withdrawals", () => {
  it("withdrawals_staffRelease_tagShown", () => {
    const html = render("fr", [row({ staffRelease: true })]);

    expect(html).toContain('cy-tag-info">Sorti par le staff</span>');
    expect(html).toContain("Test_CasterInvite");
  });

  it("withdrawals_memberWithdrawal_noStaffTag", () => {
    // Le texte d'aide (« i ») cite le libellé : seule l'étiquette compte.
    expect(render("fr", [row()])).not.toContain('cy-tag-info">Sorti par le staff');
  });

  it("withdrawals_english_staffTagTranslated", () => {
    const html = render("en", [row({ staffRelease: true })]);

    expect(html).toContain('cy-tag-info">Removed by staff</span>');
    expect(html).not.toContain("Sorti par le staff");
  });
});
