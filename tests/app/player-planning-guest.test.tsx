/**
 * PLANNING-GUESTS — case « Invité » de la fiche d'un joueur
 * (`docs/features/CAST_PLANNING.md` § Invités) : rendu, aide, câblage.
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "../helpers/read-source";

jest.mock("next/navigation", () => ({
  usePathname: () => "/joueurs/7",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
}));
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showError: () => undefined, showSuccess: () => undefined, showInfo: () => undefined }),
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));

import { PlanningGuestField } from "@/app/(secured)/joueurs/[id]/_components/PlanningGuestField";
import { planningGuestErrorMessage } from "@/app/(secured)/joueurs/[id]/_lib/planning-guest-errors";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { PlayersTextProvider } from "@/components/i18n/players-text-provider";
import { messagesFor } from "@/lib/server/i18n-messages";
import type { BusyGuard } from "@/lib/shared/hooks/useBusyGuard";
import { scopedText } from "@/lib/shared/scoped-text";

const EN = messagesFor("en");

const guard: BusyGuard = {
  busy: false,
  isBusy: () => false,
  run: async (task) => task(),
  isMounted: () => true,
  hold: () => undefined,
  whenIdle: (handler) => handler,
};

function field(guest: boolean | null): string {
  return renderToStaticMarkup(<PlanningGuestField userId="7" pseudo="Test_Caster" guest={guest} guard={guard} onSaved={() => undefined} />);
}

describe("PlanningGuestField", () => {
  it("planningGuestField_member_uncheckedBox", () => {
    const html = field(false);

    expect(html).toContain("Invité");
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
  });

  it("planningGuestField_guest_checkedBox", () => {
    expect(field(true)).toMatch(/type="checkbox"[^>]*checked/);
  });

  it("planningGuestField_infoHint_describesTheBox", () => {
    const html = field(false);

    expect(html).toContain('aria-describedby="player-planning-guest-help"');
    expect(html).toContain("Hors planning : garde ses droits de caster/prod mais n&#x27;apparaît pas au planning.");
  });

  it("planningGuestField_unreadableFlag_rendersDisabledBoxWithNote", () => {
    const html = field(null);

    expect(html).toMatch(/type="checkbox"[^>]*disabled/);
    expect(html).toContain("Le réglage n&#x27;a pas pu être lu : recharge la page.");
  });

  it("planningGuestField_partialFailure_isAnError", () => {
    const source = readSource("app/(secured)/joueurs/[id]/_components/PlanningGuestField.tsx");

    expect(source).toContain('showError(text.t("planningGuest.saved.partial"');
    expect(source).not.toContain("showInfo(text.t(\"planningGuest.saved.partial");
  });

  it("planningGuestField_save_putsToTheAdminRoute", () => {
    const source = readSource("app/(secured)/joueurs/[id]/_components/PlanningGuestField.tsx");

    expect(source).toContain("/api/admin/users/${userId}/planning-guest");
    expect(source).toContain('method: "PUT"');
    expect(source).toContain("ConfirmActionDialog");
  });
});

describe("PlanningGuestField — anglais sous /en", () => {
  it("planningGuestField_en_rendersEnglishLabelAndHint", () => {
    const html = renderToStaticMarkup(
      <AppLocaleProvider locale="en">
        <PlayersTextProvider locale="en" messages={EN.players}>
          <PlanningGuestField userId="7" pseudo="Test_Caster" guest={false} guard={guard} onSaved={() => undefined} />
        </PlayersTextProvider>
      </AppLocaleProvider>,
    );

    expect(html).toContain(">Guest<");
    expect(html).toContain("Off the schedule: keeps their caster/producer rights but does not appear on the schedule.");
    expect(html).toContain('lang="en"');
    expect(html).not.toContain("Invité");
  });

  it("planningGuestErrorMessage_en_adminRefusalInEnglish", () => {
    expect(planningGuestErrorMessage("PLANNING_GUEST_ADMIN", scopedText("en", EN.players))).toBe(
      "An administrator keeps the schedule: they cannot be a guest.",
    );
  });
});

describe("PlayerRolesPanel — câblage de la case", () => {
  it("playerRolesPanel_planningGuestBoolean_rendersField", () => {
    const panel = readSource("app/(secured)/joueurs/[id]/_components/PlayerRolesPanel.tsx");
    const page = readSource("app/(secured)/joueurs/[id]/page.tsx");

    expect(panel).toContain("planningGuest !== undefined");
    // un seul envoi à la fois : la garde du panneau est celle de la case
    expect(panel).toContain("guard={guard}");
    // relire la fiche sans changer les rôles ne remet pas les cases cochées à zéro
    expect(panel).toContain("}, [rolesKey]);");
    expect(page).toContain("planningGuest={data.planningGuest}");
  });
});

describe("planningGuestErrorMessage", () => {
  it("planningGuestErrorMessage_knownCode_returnsSentence", () => {
    expect(planningGuestErrorMessage("CANNOT_MODIFY_SELF")).toBe("Tu ne peux pas te déclarer invité toi-même.");
  });

  it("planningGuestErrorMessage_adminCode_returnsFrenchSentence", () => {
    expect(planningGuestErrorMessage("PLANNING_GUEST_ADMIN")).toBe("Un administrateur garde le planning : il ne peut pas être invité.");
  });

  it("planningGuestErrorMessage_unknownCode_returnsFallbackNeverRawCode", () => {
    expect(planningGuestErrorMessage("constructor")).toBe("L'enregistrement du réglage « Invité » a échoué.");
  });
});
