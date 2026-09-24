import { describe, expect, it } from "@jest/globals";
import { A11Y_SETTING_KEYS } from "@/lib/shared/accessibility-settings";
import { globals, stripComments } from "./_lib/style-sweep";
import { readSource } from "../helpers/read-source";

/**
 * Les réglages d'accessibilité vivent dans la feuille globale, sous
 * `:root[data-a11y~="<clé>"]`. Deux promesses à tenir, que seul un balayage
 * de la feuille peut voir :
 *
 * - chaque clé du registre **fait quelque chose** — un interrupteur sans règle
 *   se cocherait sans effet, et rien ne le dirait ;
 * - aucune de ces règles ne vaut **sans** l'attribut — le site de base doit
 *   rester exactement celui d'avant le menu.
 */
const source = globals.replace(/\r\n/g, "\n");
const sheet = stripComments(source);
/** Début du commentaire qui ouvre la section : la découpe ne tombe pas au milieu. */
const SECTION_START = source.indexOf("/* ── Réglages d'accessibilité du lecteur");

/** Découpe une liste de sélecteurs sur ses virgules de premier niveau (pas celles d'un `:is(…)`). */
function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Sélecteurs des règles de la section des réglages. */
function sectionSelectors(): string[] {
  const section = stripComments(source.slice(SECTION_START));
  const selectors: string[] = [];
  const pattern = /([^{}]+)\{[^{}]*\}/g;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(section)) !== null) selectors.push(...splitSelectorList(found[1]));
  return selectors;
}

/** Déclarations d'une règle dont le sélecteur est exactement `selector`. */
function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sheet.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`règle introuvable : ${selector}`);
  return match[1];
}

/** Rapport de contraste WCAG entre deux couleurs `#rrggbb`. */
function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5]
      .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("réglages d'accessibilité — feuille globale", () => {
  it("trouve la section des réglages", () => {
    expect(SECTION_START).toBeGreaterThan(0);
    expect(sectionSelectors().length).toBeGreaterThanOrEqual(A11Y_SETTING_KEYS.length);
  });

  it.each(A11Y_SETTING_KEYS.map((key) => [key]))("la clé « %s » a au moins une règle", (key) => {
    expect(sheet).toContain(`:root[data-a11y~="${key}"]`);
  });

  it("n'applique aucune règle de la section sans l'attribut data-a11y", () => {
    const unscoped = sectionSelectors().filter((selector) => !selector.startsWith(':root[data-a11y~="'));
    expect(unscoped).toEqual([]);
  });

  it("ne mentionne data-a11y nulle part ailleurs que sous :root", () => {
    // Un second attribut accolé au premier (`…"font"][data-a11y~="spacing"]`)
    // reste sous `:root`.
    const outside = sheet.match(/(?<!:root|\])\[data-a11y/g) ?? [];
    expect(outside).toEqual([]);
  });

  it("le contraste renforcé porte les textes secondaires au-dessus de 4,5:1 sur le fond le plus clair", () => {
    const block = declarations(':root[data-a11y~="contrast"]');
    const surface = "#161a22"; // --cyber-bg-3, le fond le plus clair du site
    for (const token of ["--ink-dim", "--ink-mute", "--text-1", "--text-2", "--blue-700"]) {
      const value = block.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`))?.[1];
      expect(value).toBeDefined();
      expect(contrast(value!, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("la police simplifiée surcharge les jetons posés en ligne sur <body>", () => {
    const block = declarations(':root[data-a11y~="font"] body');
    for (const token of ["--font-title", "--font-body", "--font-mono", "--font-display"]) {
      expect(block).toMatch(new RegExp(`${token}:\\s*var\\(--font-sans\\)\\s*!important`));
    }
  });

  it("police simplifiée + espacement : l'espacement est reposé après la remise à zéro", () => {
    const reset = sheet.indexOf(':root[data-a11y~="font"] body *');
    const both = sheet.indexOf(':root[data-a11y~="font"][data-a11y~="spacing"] body *');
    expect(reset).toBeGreaterThan(0);
    expect(both).toBeGreaterThan(reset);
  });

  it("réduire les animations fige les animations décoratives", () => {
    expect(declarations(':root[data-a11y~="motion"]')).toMatch(/--deco-anim-state:\s*paused/);
  });

  it("le focus très visible passe aussi sur la pastille de Coche, dont l'input est masqué", () => {
    expect(sheet).toContain(':root[data-a11y~="focus"] .coche-input:focus-visible ~ .coche-pill');
  });

  it("les liens soulignés épargnent les liens habillés en bouton et les plaques de carte", () => {
    expect(sheet).toMatch(/:root\[data-a11y~="links"\] a\[href\]:not\(\.btn\):not\(\[class\*="CyberButton"\]\):not\(\[class\*="cardOverlay"\]\)/);
  });
});

/** Valeur en pixels d'une propriété dans le premier bloc du sélecteur. */
function px(css: string, selector: string, property: string, fromIndex = 0): number {
  const start = css.indexOf(`${selector} {`, fromIndex);
  if (start < 0) throw new Error(`bloc introuvable : ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  const value = body.match(new RegExp(`(?:^|[;\\s])${property}:\\s*(\\d+)px`))?.[1];
  if (value === undefined) throw new Error(`${property} introuvable dans ${selector}`);
  return Number(value);
}

describe("éléments flottants — pas de chevauchement", () => {
  const menu = stripComments(readSource("components/accessibility/AccessibilityMenu.module.css"));
  const toast = stripComments(readSource("components/ui/toast.module.css"));
  const badge = stripComments(readSource("components/client-power-badge.module.css"));
  const mobile = (css: string) => css.indexOf("@media (max-width: 720px)");

  it("le bouton d'accessibilité est à gauche, le « ? » et le témoin à droite", () => {
    expect(menu).toMatch(/\.root \{[^}]*left: 24px/);
    expect(declarations(".cta-float-help")).toMatch(/right: 28px/);
    expect(badge).toMatch(/\.root \{[^}]*right: 28px/);
  });

  it("les notifications passent au-dessus du bouton, sur ordinateur", () => {
    const top = px(menu, ".root", "bottom") + px(menu, ".fab", "height");
    expect(px(toast, ".stack", "bottom")).toBeGreaterThan(top);
  });

  it("les notifications passent au-dessus du bouton, sous 720 px", () => {
    const top = px(menu, ".root", "bottom", mobile(menu)) + px(menu, ".fab", "height", mobile(menu));
    expect(px(toast, ".stack", "bottom", mobile(toast))).toBeGreaterThan(top);
  });

  it("sous 720 px, la pile passe aussi au-dessus de la pastille de lancement de match", () => {
    const launch = stripComments(readSource("components/match-launch/MatchLaunchCenter.module.css"));
    // La pastille : son bas, plus sa hauteur (rembourrage 2 × 10 px, une ligne
    // de 13 px, bordures) — 40 px au moins.
    const pillTop = px(launch, ".fab", "bottom") + 40;
    expect(px(toast, ".stack", "bottom", mobile(toast))).toBeGreaterThan(pillTop);
  });

  it("sur ordinateur, la pile s'arrête à la moitié de l'écran, loin de la pastille de droite", () => {
    expect(toast).toMatch(/\.stack \{[^}]*max-width: min\(420px, calc\(50vw - 40px\)\)/);
  });

  it("la marge de défilement tient l'élément focalisé au-dessus du bouton", () => {
    // Deux déclarations : la première vaut partout, la seconde sous 720 px.
    const [desktop, phone] = [...sheet.matchAll(/html \{\s*scroll-padding-bottom: (\d+)px;\s*\}/g)].map((m) =>
      Number(m[1]),
    );
    expect(sheet).toMatch(/@media \(max-width: 720px\) \{\s*html \{\s*scroll-padding-bottom: \d+px;/);
    expect(desktop).toBeGreaterThanOrEqual(px(menu, ".root", "bottom") + px(menu, ".fab", "height"));
    expect(phone).toBeGreaterThanOrEqual(
      px(menu, ".root", "bottom", mobile(menu)) + px(menu, ".fab", "height", mobile(menu)),
    );
  });

  it("le panneau ouvert passe devant les autres boutons flottants", () => {
    const zMenu = Number(menu.match(/\.root \{[^}]*z-index: (\d+)/)?.[1]);
    const zBadge = Number(badge.match(/\.root \{[^}]*z-index: (\d+)/)?.[1]);
    const zHelp = Number(declarations(".cta-float-help").match(/z-index: (\d+)/)?.[1]);
    expect(zMenu).toBeGreaterThan(zBadge);
    expect(zMenu).toBeGreaterThan(zHelp);
  });

  it("le bouton tient la cible minimale de 24 px, et plus", () => {
    expect(px(menu, ".fab", "width")).toBeGreaterThanOrEqual(44);
    expect(px(menu, ".fab", "width", mobile(menu))).toBeGreaterThanOrEqual(44);
  });
});

describe("pauses — feuilles des notifications et du bandeau", () => {
  const toast = stripComments(readSource("components/ui/toast.module.css"));
  const ticker = stripComments(readSource("components/cyber/Ticker.module.css"));

  it("la barre de progression s'arrête avec le décompte", () => {
    expect(toast).toMatch(/\.toast\[data-paused\] \.progress \{[^}]*animation-play-state: paused/);
  });

  it("la barre de progression se tait en mouvement réduit, système ou réglage", () => {
    expect(toast).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\.progress \{[^}]*display: none/);
    expect(toast).toMatch(/:global\(:root\[data-a11y~="motion"\]\) \.progress \{[^}]*display: none/);
  });

  it("le bandeau s'arrête au survol, au focus et au bouton pause — après la règle de la piste", () => {
    const track = ticker.indexOf(".track {");
    const pause = ticker.indexOf(".ticker[data-paused] .track");
    expect(ticker).toMatch(/\.ticker:hover \.track,\s*\.ticker:focus-within \.track,\s*\.ticker\[data-paused\] \.track \{[^}]*animation-play-state: paused/);
    expect(pause).toBeGreaterThan(track);
  });

  it("les boutons pause tiennent au moins 24 px", () => {
    expect(px(ticker, ".pause", "width")).toBeGreaterThanOrEqual(24);
    expect(px(toast, ".action", "width")).toBeGreaterThanOrEqual(24);
  });
});

describe("mise en page racine", () => {
  const layout = readSource("app/layout.tsx");

  it("pose l'attribut dès le HTML initial, depuis le cookie", () => {
    expect(layout).toMatch(/parseA11yCookie\(cookieStore\.get\(A11Y_COOKIE\)\?\.value\)/);
    expect(layout).toMatch(/<html lang="fr" data-a11y=\{a11yAttribute\(a11ySettings\)\}>/);
  });

  it("rend le menu en premier dans la page", () => {
    expect(layout).toMatch(/<ToastProvider>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<AccessibilityMenu initialSettings=\{a11ySettings\} \/>/);
  });

  it("déclare le cookie sur /rgpd", () => {
    expect(readSource("app/rgpd/page.tsx")).toContain("<strong>bg_a11y</strong>");
  });
});
