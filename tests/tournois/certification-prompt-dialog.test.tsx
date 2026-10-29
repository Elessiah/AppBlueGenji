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
  teamHasContact: true,
};
const MR_TEAM: CertificationPrompt = {
  reason: "TEAM_WITHOUT_CONTACT",
  discordVerified: false,
  battletagVerified: false,
  battletagRelevant: false,
  teamHasContact: false,
};

function render(prompt: CertificationPrompt, locale: "fr" | "en" = "fr", neverAgain = false): string {
  const ui: ReactElement = (
    <CertificationPromptDialog
      prompt={prompt}
      neverAgain={neverAgain}
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
    // « À certifier » : une étape refusable, en couleur d'information (décision 17).
    expect(html).toContain('class="pill pill-info">À certifier<');
    expect(html).not.toContain("pill-warning");
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
    // Décision 38 : en Marvel Rivals, aucun contact de match ne montre de BattleTag.
    expect(html).not.toContain("Si ta fiche porte un BattleTag");
  });

  it("dit tout ce que la certification ouvre : messages privés du bot, arbitres du site, BattleTag dès les adversaires connus", () => {
    for (const html of [render(OW_MANAGER), render(MR_TEAM)]) {
      expect(html).toContain("le bot t&#x27;envoie en message privé l&#x27;horaire et les rappels de tes matchs");
      expect(html).toContain("devient un moyen de connexion");
      expect(html).toContain("aux arbitres et aux administrateurs du site");
      expect(html).toContain("retirer ton tag Discord de ton profil retire sa certification");
      // Certifier par code rattache Discord : la modale dit comment le détacher.
      expect(html).toContain("se détache depuis « Applications connectées » tant qu&#x27;il te reste une autre façon de te connecter");
    }
    expect(render(OW_MANAGER)).toContain("tu peux être présenté comme son contact à l&#x27;adversaire et à l&#x27;arbitrage dès que vos adversaires sont connus, et aux casters le temps du match");
    expect(render(OW_MANAGER)).toContain("Battle.net remplace ton BattleTag par le sien, verrouillé tant qu&#x27;il reste rattaché");
    expect(render(OW_MANAGER)).toContain("Ne masque pas non plus ton BattleTag dans tes matchs : certifié ou non, présenté comme contact, il est montré même masqué");
    expect(render(OW_MANAGER)).toContain("dès que les deux adversaires du match sont connus et jusqu&#x27;à sa fin");
    const en = render(MR_TEAM, "en");
    expect(en).toContain("the bot sends you your match times and reminders by direct message");
    expect(en).not.toContain("If your profile holds a BattleTag");
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
    // En tableau, la première colonne a son intitulé visible.
    expect(html).toContain('<span role="columnheader">Sujet</span>');
    expect(html).not.toContain("sr-only");
    expect(html.match(/role="cell"/g)).toHaveLength(10);
  });

  it("render_neverAgainFalse_laterLabelAndUnchecked : case décochée, le bouton dit « Plus tard »", () => {
    const html = render(OW_MANAGER);
    expect(html).toContain('<input type="checkbox"/>');
    expect(html).toContain(">Plus tard</button>");
    expect(html).not.toContain(">Fermer</button>");
  });

  it("render_neverAgainTrue_closeLabelAndChecked : case cochée, le refus est définitif — le bouton dit « Fermer »", () => {
    const html = render(OW_MANAGER, "fr", true);
    expect(html).toContain('<input type="checkbox" checked=""/>');
    expect(html).toContain(">Fermer</button>");
    expect(html).not.toContain(">Plus tard</button>");
    expect(render(OW_MANAGER, "en", true)).toContain(">Close</button>");
    expect(render(OW_MANAGER, "en")).toContain(">Later</button>");
  });

  it("render_statusList_hasRoleList : la liste des pastilles garde son rôle sous WebKit", () => {
    expect(render(OW_MANAGER)).toContain('role="list" aria-label="Où tu en es"');
  });

  it("render_managerTeamWithoutContact_OW : le meneur apprend que son équipe est injoignable", () => {
    const html = render({ ...OW_MANAGER, discordVerified: false, teamHasContact: false });
    expect(html).toContain(
      "Tu mènes une équipe engagée dans ce tournoi, et personne n&#x27;y a certifié son tag Discord ni son BattleTag : l&#x27;adversaire et l&#x27;arbitrage n&#x27;ont aucun moyen sûr de vous joindre.",
    );
    expect(html).not.toContain("tu peux être présenté comme son contact à l&#x27;adversaire");
    expect(render({ ...OW_MANAGER, teamHasContact: false }, "en")).toContain(
      "You lead a team entered in this tournament, and nobody on it has verified their Discord tag or their BattleTag",
    );
  });

  it("render_managerTeamWithoutContact_MR : variante Discord seul, sans BattleTag", () => {
    const html = render({ ...MR_TEAM, reason: "MANAGER" });
    expect(html).toContain("Tu mènes une équipe engagée dans ce tournoi, et personne n&#x27;y a certifié son tag Discord :");
    expect(html).toContain("Certifie ton tag Discord pour être présenté comme son contact.");
    expect(html).not.toContain("BattleTag");
    expect(render({ ...MR_TEAM, reason: "MANAGER" }, "en")).toContain(
      "nobody on it has verified their Discord tag: the opponent",
    );
  });

  it("render_managerWithContact_keepsLeadManager : équipe joignable, le chapeau ordinaire du meneur", () => {
    expect(render(OW_MANAGER)).toContain("Tu mènes une équipe engagée dans ce tournoi : tu peux être présenté comme son contact");
  });

  it("render_tableTexts : cellules corrigées (EF-09), en français et en anglais", () => {
    const fr = render(OW_MANAGER);
    expect(fr).toContain("Te fait passer devant les membres qui n&#x27;ont rien certifié");
    expect(fr).toContain("avec ton tag Discord et ton BattleTag certifiés.");
    expect(fr).toContain("Pour t&#x27;écrire, le bot doit partager un serveur avec toi.");
    expect(fr).toContain(
      "Compte pour les tournois qui exigent un Discord certifié ou un compte Battle.net (de tout le roster si le tournoi l&#x27;exige).",
    );
    expect(render(MR_TEAM)).toContain("Compte pour les tournois qui exigent un Discord certifié (de tout le roster si le tournoi l&#x27;exige).");
    expect(render(MR_TEAM)).toContain("Te fait passer devant les membres");
    const en = render(OW_MANAGER, "en");
    expect(en).toContain("Puts you ahead of members who have verified nothing");
    expect(en).toContain("Does not give the site access to your password");
    expect(en).toContain("Nor does it hide your BattleTag in your matches");
    expect(en).toContain("To write to you, the bot has to share a server with you.");
    expect(en).toContain(">The organizers<");
    expect(en).toContain("(from the whole roster if the tournament requires it)");
    expect(en).not.toContain("organisers");
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
