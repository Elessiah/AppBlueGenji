import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

// Le cadre (portail, piège à focus) est neutralisé : seul le contenu se lit.
jest.mock("@/app/(secured)/tournois/[id]/_components/TournamentDialogFrame", () => {
  const { createElement } = jest.requireActual<typeof import("react")>("react");
  return {
    TournamentDialogFrame: ({
      children,
      yields,
      initialFocus,
    }: {
      children: ReactNode;
      yields?: boolean;
      initialFocus?: string;
    }) =>
      createElement(
        "div",
        { "data-frame-yields": String(Boolean(yields)), "data-frame-focus": initialFocus ?? "first" },
        children,
      ),
  };
});

import type { ReactElement, ReactNode } from "react";
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
  const ui: ReactElement = (
    <CertificationPromptDialog
      prompt={prompt}
      onNeverAgainChange={() => undefined}
      onClose={() => undefined}
    />
  );
  if (locale === "fr") return renderToStaticMarkup(ui);
  return renderToStaticMarkup(
    <AppLocaleProvider locale="en">
      <TournamentActionsTextProvider locale="en">{ui}</TournamentActionsTextProvider>
    </AppLocaleProvider>,
  );
}

const globals = globalThis as unknown as { document?: unknown };
const noModal = { querySelector: () => null };

beforeEach(() => {
  globals.document = noModal;
});

afterAll(() => {
  delete globals.document;
});

describe("CertificationPromptDialog", () => {
  it("Overwatch, Discord certifié : titre sur le BattleTag seul, deux pastilles, lien vers « Applications connectées »", () => {
    const html = render(OW_MANAGER);
    expect(html).toContain("Certifie ton BattleTag<");
    expect(html).not.toContain("Certifie ton Discord");
    expect(html).toContain("Certifie ce qui te manque encore.");
    expect(html).toContain("pill-success");
    expect(html).toContain("pill-warning");
    expect(html).toContain('href="/profil#connexions"');
    expect(html).toContain("Ne plus voir");
  });

  it("le titre ne demande que ce qui manque", () => {
    const none = { ...OW_MANAGER, discordVerified: false };
    expect(render(none)).toContain("Certifie ton Discord et ton BattleTag<");
    expect(render({ ...none, battletagVerified: true })).toContain("Certifie ton Discord<");
    expect(render(none, "en")).toContain("Verify your Discord and your BattleTag<");
  });

  it("cède sa place à une modale urgente (`yields` sur le cadre)", () => {
    expect(render(OW_MANAGER)).toContain('data-frame-yields="true"');
  });

  it("le cadre prend le focus d'ouverture : la modale s'ouvre par le haut", () => {
    expect(render(OW_MANAGER)).toContain('data-frame-focus="container"');
  });

  it("ne se monte pas si une modale urgente l'a devancée pendant son chargement", () => {
    globals.document = { querySelector: () => ({}) };
    expect(render(OW_MANAGER)).toBe("");
  });

  it("Marvel Rivals : Discord seul, sans BattleTag ni Blizzard", () => {
    const html = render(MR_TEAM);
    expect(html).toContain("Certifie ton Discord<");
    expect(html).toContain("personne n&#x27;y a certifié son tag Discord.");
    expect(html).toContain('href="/profil?certifier=discord"');
    expect(html).not.toContain("Blizzard le confirment");
    expect(html).not.toContain("Battle.net");
    expect(html).not.toContain("BattleTag y est montré");
    expect(html).not.toContain(">BattleTag<");
    // Un contact de match montre son BattleTag même masqué, quel que soit le jeu.
    expect(html).toContain("Si ta fiche porte un BattleTag, présenté comme contact, il est montré même masqué");
  });

  it("dit tout ce que la certification ouvre : messages privés du bot, arbitres du site, BattleTag dès les adversaires connus", () => {
    for (const html of [render(OW_MANAGER), render(MR_TEAM)]) {
      expect(html).toContain("le bot peut t&#x27;écrire en message privé : horaire et rappels de tes matchs, demandes d&#x27;adhésion");
      expect(html).toContain("aux arbitres et aux administrateurs du site");
      expect(html).toContain("dès que les deux adversaires du match sont connus et jusqu&#x27;à sa fin");
      expect(html).toContain("retirer ton tag Discord de ton profil retire sa certification");
      // Certifier par code rattache Discord : la modale dit comment le détacher.
      expect(html).toContain("se détache depuis « Applications connectées »");
    }
    expect(render(OW_MANAGER)).toContain("tu peux être présenté comme son contact à l&#x27;adversaire, au caster et à l&#x27;arbitrage, dès que vos adversaires sont connus");
    expect(render(OW_MANAGER)).toContain("Certifié ou non, présenté comme contact, ton BattleTag est montré même masqué");
    const en = render(MR_TEAM, "en");
    expect(en).toContain("the bot may write to you by direct message: your match times");
    expect(en).toContain("If your profile holds a BattleTag");
  });

  it("chaque cellule du tableau porte son libellé de colonne (rendu mobile)", () => {
    const html = render(OW_MANAGER);
    expect(html.match(/data-label="Ce que ça fait"/g)).toHaveLength(5);
    expect(html.match(/data-label="Ce que ça ne fait pas"/g)).toHaveLength(5);
  });

  it("garde ses rôles de tableau (lignes, en-têtes, cellules)", () => {
    const html = render(OW_MANAGER);
    expect(html).toContain('role="table" aria-labelledby="certification-prompt-caption"');
    expect(html.match(/role="rowheader"/g)).toHaveLength(5);
    expect(html.match(/role="columnheader"/g)).toHaveLength(3);
    // L'en-tête masqué garde sa case de grille : seul son texte est `sr-only`.
    expect(html).toContain('<span role="columnheader"><span class="sr-only">');
    expect(html.match(/role="cell"/g)).toHaveLength(10);
  });

  it("la case « Ne plus voir » part décochée", () => {
    expect(render(OW_MANAGER)).toContain('<input type="checkbox"/>');
  });

  it("en anglais, ni français ni lien sans préfixe de langue", () => {
    const html = render(OW_MANAGER, "en");
    expect(html).toContain("Verify your BattleTag<");
    expect(html).toContain("Don&#x27;t show again");
    expect(html).toContain('href="/en/profil#connexions"');
    expect(html).not.toContain("Certifie");
    const mr = render(MR_TEAM, "en");
    expect(mr).toContain("Verify your Discord<");
    expect(mr).not.toContain("Battle.net");
  });
});
