import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import frActions from "@/messages/fr/tournamentActions.json";
import enActions from "@/messages/en/tournamentActions.json";

/**
 * Nom accessible des boutons « Abandonner » / « Annuler l'abandon » des
 * classements (WCAG 2.5.3, CLAUDE.md « Nom accessible = contient son texte
 * visible ») : un utilisateur de commande vocale dit le texte qu'il voit — le
 * nom doit le contenir d'un seul tenant, dans les deux langues.
 */
const LOCALES = [
  ["fr", frActions],
  ["en", enActions],
] as const;

const withName = (template: string) => template.replace("{name}", "Frost Alliance");

describe("nom accessible des boutons d'abandon", () => {
  for (const [locale, actions] of LOCALES) {
    const visibleForfeit = actions.forfeit.button.label;
    const visibleCancel = actions.forfeitCancel.button;

    it(`${locale} : le nom de « Annuler l'abandon » contient son texte visible`, () => {
      expect(withName(actions.forfeitCancel.buttonAria)).toContain(visibleCancel);
    });

    it(`${locale} : le nom d'« Abandonner » contient son texte visible, en Survie comme en suisse`, () => {
      expect(withName(actions.forfeit.button.otherAriaSurvival)).toContain(visibleForfeit);
      expect(withName(actions.forfeit.button.otherAriaSwiss)).toContain(visibleForfeit);
      expect(actions.forfeit.button.selfAria.TEAM).toContain(visibleForfeit);
      expect(actions.forfeit.button.selfAria.SOLO).toContain(visibleForfeit);
    });

    it(`${locale} : en BG Survie, le nom de « Forfait » commence par son libellé, celui d'« Abandonner » le contient`, () => {
      expect(withName(actions.forfeit.endurance.otherTitle).startsWith(actions.forfeit.endurance.other)).toBe(true);
      expect(actions.forfeit.endurance.selfAria).toContain(visibleForfeit);
    });

    it(`${locale} : le nom de « Pénalité » contient son libellé (casse ignorée)`, () => {
      expect(withName(actions.penalty.buttonAria).toLowerCase()).toContain(actions.penalty.button.toLowerCase());
      expect(withName(actions.penaltyLift.buttonAria).toLowerCase()).toContain(actions.penaltyLift.button.toLowerCase());
    });

    it(`${locale} : en tournoi individuel, l'abandon du lecteur ne parle pas d'équipe`, () => {
      const team = locale === "fr" ? /équipe/ : /team/;
      expect(actions.forfeit.button.selfTitle.SOLO).not.toMatch(team);
      expect(actions.forfeit.button.selfAria.SOLO).not.toMatch(team);
      expect(actions.forfeit.button.selfTitle.TEAM).toMatch(team);
    });

    it(`${locale} : pas de majuscule après les deux-points de l'infobulle BG Survie`, () => {
      for (const title of [actions.forfeit.endurance.selfTitle.TEAM, actions.forfeit.endurance.selfTitle.SOLO]) {
        expect(title).toMatch(/: [a-zà-ÿ]/);
      }
    });
  }
});

describe("confirmation de l'annulation d'un abandon", () => {
  for (const [locale, actions] of LOCALES) {
    it(`${locale} : ne promet pas l'appariement sans réserve — le rejeu peut éliminer l'engagé`, () => {
      for (const body of [actions.forfeitCancel.body.TEAM, actions.forfeitCancel.body.SOLO]) {
        expect(body).toMatch(locale === "fr" ? /sauf si/ : /unless/);
      }
    });

    it(`${locale} : la confirmation ne commence pas par « Annuler », comme le bouton qui ferme la modale`, () => {
      expect(actions.forfeitCancel.confirm).not.toMatch(/^(Annuler|Cancel)/);
    });

    it(`${locale} : le succès a ses variantes équipe / joueur`, () => {
      expect(actions.forfeitCancel.success.TEAM).toContain("{name}");
      expect(actions.forfeitCancel.success.SOLO).toContain("{name}");
      if (locale === "en") expect(actions.forfeitCancel.success.SOLO).not.toMatch(/\bits\b/);
    });

    it(`${locale} : l'infobulle du bouton ne promet pas non plus le retour en lice`, () => {
      expect(actions.forfeitCancel.buttonTitle).not.toMatch(/revient en lice|back in contention/);
      expect(withName(actions.forfeitCancel.buttonTitle)).toContain(actions.forfeitCancel.button);
    });
  }
});

describe("estompage des lignes sorties du classement", () => {
  // À 0,55, le texte discret (`--ink-quiet`) d'une ligne sortie tombait vers
  // 3:1 sur le fond du tableau ; à 0,8, le chiffre de défaite
  // (`--result-loss-ink`) restait vers 4,1:1 sur la ligne du lecteur. Le
  // plancher est 0,9, partout (Survie, suisse, BG Survie `ROW_OPACITY`).
  const survival = readFileSync(
    join(__dirname, "..", "..", "app/(secured)/tournois/[id]/_components/SurvivalView.tsx"),
    "utf8",
  );

  const swiss = readFileSync(
    join(__dirname, "..", "..", "app/(secured)/tournois/[id]/_components/SwissView.tsx"),
    "utf8",
  );
  const endurance = readFileSync(
    join(__dirname, "..", "..", "app/(secured)/tournois/[id]/_components/EnduranceRankingViews.tsx"),
    "utf8",
  );
  const css = readFileSync(join(__dirname, "..", "..", "app/globals.css"), "utf8");
  // Premier bloc `:root` : le thème sombre par défaut.
  const token = (name: string): string => {
    const match = new RegExp(String.raw`--${name}:\s*(#[0-9a-fA-F]{6})`).exec(css);
    if (!match?.[1]) throw new Error(`jeton ${name} introuvable`);
    return match[1];
  };
  const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const luminance = (c: number[]) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const mix = (fg: number[], bg: number[], alpha: number) => fg.map((v, i) => v * alpha + (bg[i] ?? 0) * (1 - alpha));
  const ratio = (fg: number[], bg: number[]) => {
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  };
  // Fond du plateau (`.ds-block`, rgba(17,19,25,0.85) sur --bg-0), et la ligne
  // du lecteur, teintée de bleu à 6 %.
  const board = mix([17, 19, 25], rgb(token("bg-0")), 0.85);
  const mine = mix([89, 212, 255], board, 0.06);
  const ROW_INKS = ["ink-quiet", "ink-dim", "amber", "result-loss-ink", "violet-300", "teal-400", "pink-400"];

  const fadeOf = (source: string, pattern: RegExp): number => Number(pattern.exec(source)?.[1]);

  it("estompe les lignes sorties (Survie, suisse, BG Survie) sans passer sous 4,5:1", () => {
    const fades = [
      fadeOf(survival, /opacity: team\.status === "ELIMINATED" \? ([\d.]+) : 1,/),
      fadeOf(swiss, /const FORFEIT_FADE: CSSProperties = \{ opacity: ([\d.]+) \};/),
      fadeOf(endurance, /ELIMINATED: ([\d.]+),/),
      fadeOf(endurance, /FORFEIT: ([\d.]+),\s*\};/),
    ];
    for (const fade of fades) {
      expect(fade).toBeGreaterThan(0);
      expect(fade).toBeLessThan(1);
      for (const ink of ROW_INKS) {
        for (const bg of [board, mine]) {
          expect(ratio(mix(rgb(token(ink)), bg, fade), bg)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
