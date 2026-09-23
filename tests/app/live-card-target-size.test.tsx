import { readFileSync } from "fs";
import { join } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveCard } from "@/components/cyber/landing/LiveCard";
import type { LandingLive } from "@/lib/shared/landing";

/** Retire les commentaires : ils citent en prose les valeurs que ces gardes lisent. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Déclarations de chaque règle, indexées par sélecteur.
 *
 * Seule la **première** occurrence est retenue : `.streamButton` est redéclarée
 * sous `prefers-reduced-motion`, et la garder écraserait la règle de base par un
 * `transition: none` qui ne dit rien des dimensions.
 */
function cssRules(source: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  for (const [, rawSelector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rawSelector.trim();
    if (rules.has(selector)) continue;
    const declarations = new Map<string, string>();
    for (const declaration of body.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon === -1) continue;
      declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
    rules.set(selector, declarations);
  }
  return rules;
}

const RULES = cssRules(
  stripCssComments(
    readFileSync(
      join(__dirname, "..", "..", "components", "cyber", "landing", "LiveCard.module.css"),
      "utf8",
    ),
  ),
);

function declarations(selector: string): Map<string, string> {
  const found = RULES.get(selector);
  if (!found) throw new Error(`règle introuvable : ${selector}`);
  return found;
}

/** Première longueur en pixels d'une déclaration (`padding: 5px 10px` → 5). */
function px(selector: string, property: string): number {
  const value = declarations(selector).get(property);
  if (value === undefined) throw new Error(`${selector} ne déclare pas ${property}`);
  const found = value.match(/([\d.]+)px/);
  if (!found) throw new Error(`${selector} { ${property}: ${value} } n'est pas en pixels`);
  return Number(found[1]);
}

/**
 * Minimum de la règle WCAG 2.5.8 « Target Size (Minimum) », que l'audit
 * Lighthouse `target-size` applique telle quelle.
 */
const MIN_TARGET_PX = 24;

/**
 * Hauteur de la boîte en ligne, en multiples de la taille de police.
 *
 * Elle ne vient pas de la feuille mais des métriques de la fonte : pour Inter,
 * `(ascender + descender) / unitsPerEm` ≈ 1,21. Mesuré à 18,4 px sur du 15 px
 * dans le navigateur, soit 1,227 — on garde la borne basse, ces gardes
 * calculant un **minorant** de la cible.
 */
const INTER_CONTENT_RATIO = 1.21;

/** Ce que Lighthouse mesure : la boîte de bordure du lien. */
function targetHeight(fontSizePx: number, paddingBlockPx: number, borderPx = 0): number {
  return fontSizePx * INTER_CONTENT_RATIO + 2 * paddingBlockPx + 2 * borderPx;
}

describe("LiveCard — taille des cibles de l'accueil", () => {
  it("porte le nom d'un engagé à au moins 24 px de haut", () => {
    // Le défaut relevé : 15 px de police sans rembourrage font ~18 px, sous le
    // seuil — c'était le seul point qui tenait l'accessibilité de l'accueil à 96.
    const fontSize = px(".teamName", "font-size");
    const padding = px(".entrantLink", "padding-block");
    expect(fontSize).toBe(15);
    expect(padding).toBeGreaterThan(0);
    expect(targetHeight(fontSize, padding)).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  });

  it("donne à la ligne de quoi contenir la cible, faute de quoi elle serait rognée", () => {
    // `overflow: hidden` coupe la zone cliquable comme il coupe le texte : une
    // cible plus haute que sa ligne perd ce qui dépasse, des deux côtés.
    expect(px(".teamName", "line-height")).toBeGreaterThanOrEqual(
      targetHeight(px(".teamName", "font-size"), px(".entrantLink", "padding-block")),
    );
  });

  it("garde le lien en ligne, sans quoi l'ellipse cesserait de couper", () => {
    // Un `inline-block` serait une boîte atomique : `text-overflow: ellipsis`
    // ne saurait plus la couper, et un nom d'équipe long déborderait sa carte.
    // On échangerait un défaut d'accessibilité contre un défaut de mise en page.
    expect(declarations(".entrantLink").has("display")).toBe(false);
  });

  it("conserve l'élision du nom trop long", () => {
    const name = declarations(".teamName");
    expect(name.get("overflow")).toBe("hidden");
    expect(name.get("text-overflow")).toBe("ellipsis");
    expect(name.get("white-space")).toBe("nowrap");
  });

  it("porte aussi le bouton de diffusion à 24 px", () => {
    // 11 px de police (hérité du bandeau) + 1 px de bordure : il passait à ~23 px.
    // Il n'apparaît qu'à l'antenne ouverte, d'où son absence des audits.
    expect(targetHeight(11, px(".streamButton", "padding"), 1)).toBeGreaterThanOrEqual(
      MIN_TARGET_PX,
    );
  });

  it("applique bien la classe au lien de l'engagé", () => {
    // Une règle CSS que personne ne porte ne corrige rien.
    const live = {
      tournament: {
        id: 7,
        name: "Test - Direct",
        format: "SINGLE",
        participantType: "TEAM",
      },
      game: "OW",
      viewers: 12,
      currentMatch: {
        id: 42,
        round: 1,
        roundLabel: "Manche 1",
        bracket: "UPPER",
        team1Name: "Alpha",
        team2Name: "Beta",
        team1Href: "/equipes/1",
        team2Href: "/equipes/2",
        team1LogoUrl: null,
        team2LogoUrl: null,
        team1Score: 1,
        team2Score: 0,
        team1Seed: null,
        team2Seed: null,
        liveState: "OFF",
        liveUrl: null,
        matchFormat: null,
      },
    } as unknown as LandingLive;

    const markup = renderToStaticMarkup(<LiveCard live={live} />);
    const anchors = markup.match(/<a\b[^>]*>/g) ?? [];
    expect(anchors.filter((tag) => tag.includes("entrantLink"))).toHaveLength(2);
  });
});
