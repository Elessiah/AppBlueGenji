import { describe, expect, it } from "@jest/globals";
import { join } from "node:path";
import { contrastRatio } from "@/lib/shared/color-contrast";
import { TEAM_ROLE_ORDER, teamRoleTone, type TeamRoleTone } from "@/lib/shared/team-role-display";
import { getPaletteColor, TEAM_COLORS } from "@/lib/shared/palette";
import { globals, ROOT, stripComments } from "./_lib/style-sweep";
import { readSource } from "../helpers/read-source";

/**
 * Lot « Équipes et joueurs » de LANDING_ANIMATIONS.md : rôles teintés par
 * `teamRoleTone`, section équipes passée de l'orange au violet néon, et chaque
 * texte coloré lisible (4,5:1) sur sa pastille teintée.
 */

const root = stripComments(globals).match(/(?:^|\})\s*:root\s*\{([^}]*)\}/)![1];
const hex = (name: string) => root.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`))![1];
const triplet = (name: string) =>
  root
    .match(new RegExp(`${name}:\\s*(\\d+),\\s*(\\d+),\\s*(\\d+);`))!
    .slice(1, 4)
    .map(Number);

function toHex(channels: number[]): string {
  return `#${channels.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Fond translucide `rgba(tint, alpha)` posé sur `base`. */
function blend(baseHex: string, tint: number[], alpha: number): string {
  const base = [1, 3, 5].map((i) => Number.parseInt(baseHex.slice(i, i + 2), 16));
  return toHex(base.map((c, i) => c * (1 - alpha) + tint[i] * alpha));
}

const SURFACE = hex("--cyber-bg-3"); // le fond le plus clair

/** Texte, teinte du fond et opacité maximale de chaque teinte (team.module.css, annuaire.module.css). */
const TONES: Record<Exclude<TeamRoleTone, "neutral">, { text: string; fill: string; alpha: number }> = {
  pink: { text: "--pink-400", fill: "--pink-400-rgb", alpha: 0.1 },
  violet: { text: "--violet-300", fill: "--violet-400-rgb", alpha: 0.1 },
  cyan: { text: "--cyan-400", fill: "--cyan-400-rgb", alpha: 0.08 },
  blue: { text: "--blue-300", fill: "--blue-500-rgb", alpha: 0.1 },
  teal: { text: "--teal-400", fill: "--teal-400-rgb", alpha: 0.08 },
};

const TEAM_CSS = stripComments(readSource(join(ROOT, "app", "(secured)", "equipes", "[id]", "team.module.css")));
const ANNUAIRE_CSS = stripComments(readSource(join(ROOT, "app", "(secured)", "_shared", "annuaire.module.css")));

describe("teamRoleTone", () => {
  it("donne à chaque rôle connu une teinte colorée, jamais le neutre", () => {
    for (const role of TEAM_ROLE_ORDER) expect(teamRoleTone(role)).not.toBe("neutral");
  });

  it("suit l'usage des jeux : tank bleu, DPS rose, soutien vert d'eau ; la gestion en violet", () => {
    expect(teamRoleTone("TANK")).toBe("blue");
    expect(teamRoleTone("DPS")).toBe("pink");
    expect(teamRoleTone("HEAL")).toBe("teal");
    expect(teamRoleTone("MANAGER")).toBe("violet");
    expect(teamRoleTone("OWNER")).toBe("pink");
    expect(teamRoleTone("CAPITAINE")).toBe("cyan");
  });

  it("laisse neutre un code inconnu, y compris un nom hérité d'Object", () => {
    expect(teamRoleTone("JOKER")).toBe("neutral");
    expect(teamRoleTone("")).toBe("neutral");
    expect(teamRoleTone("toString")).toBe("neutral");
  });
});

describe("pastilles de rôle teintées", () => {
  it.each(Object.keys(TONES))("la teinte %s est stylée sur la fiche d'équipe et sur les cartes de joueur", (tone) => {
    expect(TEAM_CSS).toContain(`.rolePill[data-tone="${tone}"]`);
    expect(ANNUAIRE_CSS).toContain(`.plRole[data-tone="${tone}"]`);
  });

  it.each(Object.entries(TONES))("le texte %s tient 4,5:1 sur sa pastille teintée", (_tone, { text, fill, alpha }) => {
    const background = blend(SURFACE, triplet(fill), alpha);
    expect(contrastRatio(hex(text), background)).toBeGreaterThanOrEqual(4.5);
  });

  it("ni un rôle de joueur ni une défaite n'emprunte le rouge réservé au direct", () => {
    const rules = [...ANNUAIRE_CSS.matchAll(/\.(?:plRole|tmFormCell)[^{]*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
    expect(rules).not.toMatch(/red-live|#ff4d5e|255, 77, 94/);
    const teamCard = stripComments(readSource(join(ROOT, "app", "(secured)", "equipes", "cards", "TeamCard.module.css")));
    expect(teamCard).not.toMatch(/red-live|#ff4d5e|255, 77, 94/);
  });
});

describe("teintes des emblèmes (getPaletteColor)", () => {
  const tokenValues = new Set(
    ["--blue-500", "--violet-400", "--cyan-400", "--teal-400", "--pink-400", "--blue-300", "--violet-300"].map(hex),
  );

  it("ne prend que des néons froids de la palette, lisibles sur le fond le plus clair", () => {
    for (const color of TEAM_COLORS) {
      expect(tokenValues.has(color)).toBe(true);
      expect(contrastRatio(color, SURFACE)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("boucle sur la palette par identifiant", () => {
    expect(getPaletteColor(0)).toBe(TEAM_COLORS[0]);
    expect(getPaletteColor(TEAM_COLORS.length + 2)).toBe(TEAM_COLORS[2]);
  });
});

describe("section équipes sans teinte chaude", () => {
  const files = [
    ["app", "(secured)", "equipes", "[id]", "team.module.css"],
    ["app", "(secured)", "equipes", "[id]", "_components", "TeamHeader.module.css"],
    ["app", "(secured)", "equipes", "cards", "TeamCard.module.css"],
    ["app", "(secured)", "equipes", "cards", "HighlightStrip.module.css"],
    ["components", "stats", "StatsPanel.module.css"],
  ];

  it.each(files.map((parts) => [parts.at(-1)!, parts]))("%s n'utilise plus l'orange", (_name, parts) => {
    const css = stripComments(readSource(join(ROOT, ...parts)));
    expect(css).not.toMatch(/orange-rgb|#ff9d2e|#ffc78a|255, 157, 46/);
  });

  it("les cartes d'équipe et de joueur de l'annuaire n'utilisent plus l'orange", () => {
    const cards = ANNUAIRE_CSS.slice(ANNUAIRE_CSS.indexOf(".tmGrid"), ANNUAIRE_CSS.indexOf(".ticker {"));
    expect(cards).not.toMatch(/orange-rgb|#ff9d2e|255, 157, 46/);
  });

  it("l'en-tête et les titres de section de la fiche passent au violet", () => {
    const header = readSource(join(ROOT, "app", "(secured)", "equipes", "[id]", "_components", "TeamHeader.tsx"));
    expect(header).not.toMatch(/\borange\b/);
    expect(header).toContain('"ds-header purple"');
  });
});
