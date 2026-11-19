/**
 * Bouton « Se désister » d'une ligne de rôle du planning, rendu
 * (`ADMIN_ROLE_IMPERSONATION.md`) : montré sur sa propre attribution pour un
 * rôle de `withdrawRoles` seulement — une incarnation qui ne tiendrait pas la
 * place ne le voit pas (le serveur répondrait `403 PLAYER_VIEW_ACTIVE`).
 */
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { entryView } from "@/tests/helpers/planning";

// Deux jours avant le créneau des fabriques (`MONDAY` de tests/helpers/planning) : le désistement est ouvert.
jest.mock("@/lib/shared/hooks/useClock", () => ({ useClock: () => Date.UTC(2026, 10, 20, 23) }));

import { RoleRow } from "@/app/(secured)/planning/_components/PlanningBoard";
import { scopedText } from "@/lib/shared/scoped-text";
import type { PlanningRole } from "@/lib/shared/planning";
import enPlanning from "@/messages/en/planning.json";
import frPlanning from "@/messages/fr/planning.json";

const act = async () => true;
const onWithdraw = () => undefined;

function render(role: PlanningRole, withdrawRoles: PlanningRole[], options: { me?: number; source?: "MANUAL" | "CAST"; locale?: "fr" | "en" } = {}): string {
  const { me = 1, source = "MANUAL", locale = "fr" } = options;
  const entry = entryView({ assignments: [{ userId: 1, role, source, reason: "MANUAL", provisional: false }] });
  const text = scopedText(locale, locale === "fr" ? frPlanning : enPlanning);
  const view = { me, myRoles: [role], withdrawRoles, canManage: false, canCompute: false, members: [{ userId: 1, pseudo: "Moi", roles: [role], soloCaster: false }] };
  return renderToStaticMarkup(
    <dl>
      <RoleRow role={role} entry={entry} view={view} text={text} names={new Map([[1, "Moi"]])} slot="lun. 20 h" pending={null} act={act} onWithdraw={onWithdraw} />
    </dl>,
  );
}

const withdrawLabel = (locale: "fr" | "en", role: PlanningRole) => {
  const { t } = scopedText(locale, locale === "fr" ? frPlanning : enPlanning);
  return t("withdraw.actionLabel", { role: t(`roles.${role}`), slot: "lun. 20 h" });
};

describe("RoleRow — Se désister", () => {
  it("roleRow_ownAssignmentRoleWithdrawable_showsWithdraw", () => {
    expect(render("REFEREE", ["REFEREE", "CASTER", "PROD"])).toContain(`aria-label="${withdrawLabel("fr", "REFEREE")}"`);
  });

  it("roleRow_impersonationWithoutThatRole_hidesWithdraw", () => {
    expect(render("REFEREE", ["CASTER"])).not.toContain(`aria-label="${withdrawLabel("fr", "REFEREE")}"`);
  });

  it("roleRow_playerViewNoRole_hidesWithdraw", () => {
    expect(render("CASTER", [])).not.toContain(`aria-label="${withdrawLabel("fr", "CASTER")}"`);
  });

  it("roleRow_otherMembersAssignment_noWithdraw", () => {
    expect(render("CASTER", ["CASTER"], { me: 2 })).not.toContain(`aria-label="${withdrawLabel("fr", "CASTER")}"`);
  });

  it("roleRow_castManagedSeat_noWithdraw", () => {
    expect(render("CASTER", ["CASTER"], { source: "CAST" })).not.toContain(`aria-label="${withdrawLabel("fr", "CASTER")}"`);
  });

  it("roleRow_english_withdrawLabelTranslated", () => {
    const html = render("PROD", ["PROD"], { locale: "en" });

    expect(html).toContain(`aria-label="${withdrawLabel("en", "PROD")}"`);
    expect(withdrawLabel("en", "PROD")).not.toBe(withdrawLabel("fr", "PROD"));
  });
});
