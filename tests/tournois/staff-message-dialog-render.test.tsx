import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

// Le cadre (portail, piège à focus) est neutralisé : seul le contenu se lit.
jest.mock("@/app/(secured)/tournois/[id]/_components/TournamentDialogFrame", () => {
  const { createElement } = jest.requireActual<typeof import("react")>("react");
  return {
    TournamentDialogFrame: ({ children }: { children: ReactNode }) => createElement("div", { "data-frame": "" }, children),
  };
});
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showError: () => undefined, showSuccess: () => undefined }),
}));

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaffMessageDialog } from "@/app/(secured)/tournois/[id]/_components/StaffMessageDialog";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import "@/tests/helpers/lazy-tournament-texts";

/**
 * Fenêtre « Message aux participants » (`docs/features/TOURNAMENT_STAFF_MESSAGE.md`) :
 * à l'ouverture, toutes les cases cochées, le décompte en attente et l'envoi
 * retenu tant que rien n'est écrit — en français et en anglais.
 */

function render(locale: "fr" | "en"): string {
  const ui = <StaffMessageDialog tournamentId={12} tournamentName="Coupe d'hiver" onClose={() => undefined} />;
  if (locale === "fr") return renderToStaticMarkup(ui);
  return renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <TournamentActionsTextProvider locale="en">{ui}</TournamentActionsTextProvider>
    </AppLocaleProvider>,
  );
}

const globals = globalThis as unknown as { document?: unknown };
beforeAll(() => {
  globals.document = { querySelector: () => null };
});
afterAll(() => {
  delete globals.document;
});

describe("StaffMessageDialog", () => {
  it("StaffMessageDialog_french_rendersEveryCategoryTicked", () => {
    const html = render("fr");

    expect(html.match(/type="checkbox" checked=""/g)).toHaveLength(5);
    for (const label of ["Joueurs", "Managers", "Capitaines", "Owners", "Tous"]) expect(html).toContain(label);
  });

  it("StaffMessageDialog_french_showsCountingAndTournament", () => {
    const html = render("fr");

    expect(html).toContain("Comptage des destinataires…");
    expect(html).toContain("Tournoi : Coupe d&#x27;hiver");
    expect(html).toContain("0/1200");
  });

  it("StaffMessageDialog_nothingWritten_sendIsHeldBack", () => {
    const html = render("fr");

    expect(html).toMatch(/<button[^>]*type="submit"[^>]*aria-disabled="true"[^>]*>Envoyer<\/button>/);
  });

  it("StaffMessageDialog_english_rendersEnglishLabels", () => {
    const html = render("en");

    expect(html).toContain("Message participants");
    expect(html).toContain("Everyone");
    expect(html).toContain("Counting recipients…");
    expect(html).not.toContain("Destinataires");
  });
});
