import { describe, expect, it, jest } from "@jest/globals";

// Le cadre (portail, piège à focus) est neutralisé : seul le contenu se lit.
jest.mock("@/app/(secured)/tournois/[id]/_components/TournamentDialogFrame", () => ({
  TournamentDialogFrame: ({ children }: { children: unknown }) => children,
}));

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CertificationPromptDialog } from "@/app/(secured)/tournois/[id]/_components/CertificationPromptDialog";
import { AppLocaleProvider } from "@/components/i18n/locale-context";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import type { CertificationPrompt } from "@/lib/shared/certification-prompt";

/**
 * Modale d'invitation à certifier (`docs/features/CERTIFICATION_PROMPT.md`) :
 * ce qu'elle dit selon le motif et le jeu, en français et en anglais.
 */

const OW_MANAGER: CertificationPrompt = {
  reason: "MANAGER",
  discordVerified: true,
  battletagVerified: false,
  battletagRelevant: true,
};
const MR_TEAM: CertificationPrompt = {
  reason: "TEAM_WITHOUT_CONTACT",
  discordVerified: false,
  battletagVerified: false,
  battletagRelevant: false,
};

function render(prompt: CertificationPrompt, locale: "fr" | "en" = "fr"): string {
  const ui: ReactElement = <CertificationPromptDialog prompt={prompt} onClose={() => undefined} />;
  if (locale === "fr") return renderToStaticMarkup(ui);
  return renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <TournamentActionsTextProvider locale="en">{ui}</TournamentActionsTextProvider>
    </AppLocaleProvider>,
  );
}

describe("CertificationPromptDialog", () => {
  it("Overwatch : titre, deux pastilles, lien vers « Applications connectées »", () => {
    const html = render(OW_MANAGER);
    expect(html).toContain("Certifie ton Discord et ton BattleTag");
    expect(html).toContain("Tu gères une équipe engagée");
    expect(html).toContain("pill-success");
    expect(html).toContain("pill-warning");
    expect(html).toContain('href="/profil#connexions"');
    expect(html).toContain("Ne plus voir");
  });

  it("le titre prend le focus d'ouverture", () => {
    expect(render(OW_MANAGER)).toMatch(/<h3[^>]*tabindex="-1"[^>]*data-autofocus/);
  });

  it("Marvel Rivals : Discord seul, sans BattleTag ni Blizzard", () => {
    const html = render(MR_TEAM);
    expect(html).toContain("Certifie ton Discord<");
    expect(html).toContain("personne n&#x27;y a certifié son tag Discord.");
    expect(html).not.toContain("Blizzard le confirment");
    expect(html).not.toContain("Battle.net");
    expect(html).not.toContain(">BattleTag<");
  });

  it("chaque cellule du tableau porte son libellé de colonne (rendu mobile)", () => {
    const html = render(OW_MANAGER);
    expect(html.match(/data-label="Ce que ça fait"/g)).toHaveLength(4);
    expect(html.match(/data-label="Ce que ça ne fait pas"/g)).toHaveLength(4);
  });

  it("garde ses rôles de tableau (lignes, en-têtes, cellules)", () => {
    const html = render(OW_MANAGER);
    expect(html).toContain('role="table" aria-labelledby="certification-prompt-caption"');
    expect(html.match(/role="rowheader"/g)).toHaveLength(4);
    expect(html.match(/role="columnheader"/g)).toHaveLength(3);
    expect(html.match(/role="cell"/g)).toHaveLength(8);
  });

  it("en anglais, ni français ni lien sans préfixe de langue", () => {
    const html = render(OW_MANAGER, "en");
    expect(html).toContain("Verify your Discord and your BattleTag");
    expect(html).toContain("Don&#x27;t show again");
    expect(html).toContain('href="/en/profil#connexions"');
    expect(html).not.toContain("Certifie");
    const mr = render(MR_TEAM, "en");
    expect(mr).toContain("Verify your Discord<");
    expect(mr).not.toContain("Battle.net");
  });
});
