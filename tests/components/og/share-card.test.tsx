/**
 * Image d'aperçu (`components/og/share-card.tsx`) : la palette néon copiée des
 * jetons de `globals.css`, le contraste de chaque texte sur le fond le plus
 * clair que les halos produisent, et le balisage rendu pour chaque état
 * (`docs/features/SHARE_METADATA.md`).
 *
 * Le rendu PNG lui-même (Satori) n'est pas joué ici : il charge un module
 * WebAssembly que Jest n'exécute pas. On rend l'arbre React en HTML, qui porte
 * les mêmes styles en ligne.
 */
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ShareCard,
  SHARE_CARD_BADGE_FILL_ALPHA,
  SHARE_CARD_COLORS,
  SHARE_CARD_FACT_COLORS,
  SHARE_CARD_GLOWS,
  SHARE_CARD_TEXT_BOX,
  SHARE_CARD_TONE_COLORS,
  titleFontSize,
  type ShareCardTone,
} from "@/components/og/share-card";
import { contrastRatio } from "@/lib/shared/color-contrast";
import { SITE_SHARE_CARD, tournamentShareCard } from "@/lib/shared/share-metadata";
import type { TournamentState } from "@/lib/shared/types";
import { globals } from "../../app/_lib/style-sweep";
import { tournamentCard } from "../../helpers/tournament-card";

const root = globals.match(/(?:^|\})\s*:root\s*\{([^}]*)\}/)![1];
const token = (name: string) => root.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`))?.[1];

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as Rgb;
}

function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

function over(base: Rgb, color: string, alpha: number): Rgb {
  const top = rgb(color);
  return base.map((value, index) => value * (1 - alpha) + top[index] * alpha) as Rgb;
}

/**
 * Fond recomposé en un point : chaque halo est un dégradé linéaire de son
 * opacité au cœur à zéro, éteint à 70 % du rayon « coin le plus lointain » de
 * sa boîte carrée (soit côté × 0,7 / √2).
 */
function backgroundAt(x: number, y: number): Rgb {
  let color = rgb(SHARE_CARD_COLORS.background);
  for (const glow of SHARE_CARD_GLOWS) {
    const centerX = glow.place.left + glow.size / 2;
    const centerY = glow.place.top + glow.size / 2;
    const fade = (0.7 * glow.size) / Math.SQRT2;
    const alpha = glow.alpha * Math.max(0, 1 - Math.hypot(x - centerX, y - centerY) / fade);
    color = over(color, glow.color, alpha);
  }
  return color;
}

/** Le point le moins contrasté de la zone de texte pour une couleur donnée. */
function worstContrast(text: string, veil?: { color: string; alpha: number }): number {
  let worst = Infinity;
  for (let x = SHARE_CARD_TEXT_BOX.left; x <= SHARE_CARD_TEXT_BOX.right; x += 8) {
    for (let y = SHARE_CARD_TEXT_BOX.top; y <= SHARE_CARD_TEXT_BOX.bottom; y += 8) {
      let background = backgroundAt(x, y);
      if (veil) background = over(background, veil.color, veil.alpha);
      worst = Math.min(worst, contrastRatio(text, hex(background)));
    }
  }
  return worst;
}

const TONES: ShareCardTone[] = ["accent", "highlight", "info", "success"];
const STATES: TournamentState[] = ["UPCOMING", "REGISTRATION", "RUNNING", "FINISHED"];
const NOW = Date.parse("2026-08-10T12:00:00Z");

describe("palette de la carte", () => {
  it.each([
    ["background", "--cyber-bg"],
    ["ink", "--ink"],
    ["inkMute", "--ink-mute"],
    ["cyan", "--cyan-400"],
    ["blue", "--blue-500"],
    ["blueSoft", "--blue-300"],
    ["violetSoft", "--violet-300"],
    ["violet", "--violet-400"],
    ["pink", "--pink-400"],
    ["teal", "--teal-400"],
  ] satisfies [keyof typeof SHARE_CARD_COLORS, string][])("%s recopie %s de globals.css", (key, name) => {
    expect(token(name)).toBeDefined();
    expect(SHARE_CARD_COLORS[key]).toBe(token(name));
  });

  it("n'emploie ni le rouge du direct ni l'ambre des avertissements", () => {
    const values = Object.values(SHARE_CARD_COLORS);
    expect(values).not.toContain(token("--red-live"));
    expect(values).not.toContain(token("--amber"));
  });

  it("donne aux tons les couleurs des variantes `.pill-*`", () => {
    expect(SHARE_CARD_TONE_COLORS).toEqual({
      accent: token("--violet-300"),
      highlight: token("--pink-400"),
      info: token("--blue-300"),
      success: token("--teal-400"),
    });
  });
});

describe("contraste sur le fond le plus clair de la zone de texte", () => {
  it.each([
    ["titre et valeurs", SHARE_CARD_COLORS.ink],
    ["sous-titre et mentions", SHARE_CARD_COLORS.inkMute],
    ...SHARE_CARD_FACT_COLORS.map((color, index) => [`intitulé du fait ${index + 1}`, color] as [string, string]),
  ])("%s tient 4,5:1", (_label, color) => {
    expect(worstContrast(color)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["jeu", SHARE_CARD_COLORS.cyan],
    ...TONES.map((tone) => [`état ${tone}`, SHARE_CARD_TONE_COLORS[tone]] as [string, string]),
  ])("la pastille %s tient 4,5:1 sur son propre voile", (_label, color) => {
    expect(worstContrast(color, { color, alpha: SHARE_CARD_BADGE_FILL_ALPHA })).toBeGreaterThanOrEqual(4.5);
  });

  it("garde les halos visibles : la carte n'est plus un aplat noir", () => {
    const corner = backgroundAt(1200, 0);
    expect(contrastRatio(hex(corner), SHARE_CARD_COLORS.background)).toBeGreaterThan(1.5);
  });
});

describe("rendu", () => {
  it.each(STATES)("dessine l'état %s dans sa pastille, à sa couleur", (state) => {
    const props = tournamentShareCard(tournamentCard({ state }), NOW);
    const html = renderToStaticMarkup(<ShareCard {...props} logoSrc={null} />);
    expect(html).toContain(props.state.label);
    expect(html).toContain(`color:${SHARE_CARD_TONE_COLORS[props.state.tone]}`);
    expect(html).toContain(props.eyebrow);
    expect(html).toContain(props.title);
  });

  it("colore chaque intitulé de fait d'un néon distinct", () => {
    const props = tournamentShareCard(tournamentCard({ state: "REGISTRATION" }), NOW);
    const html = renderToStaticMarkup(<ShareCard {...props} />);
    props.facts.forEach((_fact, index) => {
      expect(html).toContain(`border-left:4px solid ${SHARE_CARD_FACT_COLORS[index]}`);
    });
  });

  it("pose le logo quand il est lu, décoratif (alt vide)", () => {
    const html = renderToStaticMarkup(<ShareCard {...SITE_SHARE_CARD} logoSrc="data:image/png;base64,AAAA" />);
    expect(html).toMatch(/<img[^>]*src="data:image\/png;base64,AAAA"[^>]*alt=""/);
  });

  it("se passe du logo sans rien casser quand il manque", () => {
    const html = renderToStaticMarkup(<ShareCard {...SITE_SHARE_CARD} logoSrc={null} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("BLUEGENJI");
  });

  it("la carte du site n'a pas de pastille d'état", () => {
    const html = renderToStaticMarkup(<ShareCard {...SITE_SHARE_CARD} />);
    expect(html).toContain(SITE_SHARE_CARD.eyebrow);
    for (const tone of ["highlight", "success"] as const) {
      expect(html).not.toContain(`color:${SHARE_CARD_TONE_COLORS[tone]}`);
    }
  });

  it("borne un nom long à trois lignes à la plus petite taille", () => {
    const props = tournamentShareCard(tournamentCard({ name: "Championnat ".repeat(20) }), NOW);
    const html = renderToStaticMarkup(<ShareCard {...props} />);
    expect(titleFontSize(props.title)).toBe(44);
    expect(html).toContain("-webkit-line-clamp:3");
    expect(html).toContain("…");
  });
});

describe("titleFontSize", () => {
  it("réduit la taille par paliers selon la longueur", () => {
    expect(titleFontSize("OW Cup")).toBe(76);
    expect(titleFontSize("x".repeat(29))).toBe(62);
    expect(titleFontSize("x".repeat(45))).toBe(52);
    expect(titleFontSize("x".repeat(65))).toBe(44);
  });
});
