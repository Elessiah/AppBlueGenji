import { describe, expect, it, jest } from "@jest/globals";
import { relative } from "node:path";

jest.mock("next/navigation", () => ({ usePathname: () => "/" }));
// L'en-tête et le pied de page lisent la session et la base : le gabarit ne
// s'intéresse qu'à leur **place**, des doublures suffisent.
jest.mock("@/components/cyber/landing/PublicHeader", () => ({
  PublicHeader: () => <header>en-tête</header>,
}));
jest.mock("@/components/cyber/landing/PublicFooter", () => ({
  PublicFooter: () => <footer>pied</footer>,
}));

import { renderToStaticMarkup } from "react-dom/server";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { focusLeftMenu } from "@/components/cyber/landing/PublicNavMenu";
import { ROOT, globals, splitSelectorList, stripComments, walk } from "./_lib/style-sweep";
import { readSource } from "../helpers/read-source";

const sources = (dir: string, suffix: string) =>
  walk(`${ROOT}/${dir}`, suffix).map((path) => ({
    file: relative(ROOT, path).replace(/\\/g, "/"),
    src: readSource(path),
  }));

describe("PublicPageShell — en-tête et pied de page hors de <main>", () => {
  const html = renderToStaticMarkup(
    <PublicPageShell>
      <h1>Contenu</h1>
    </PublicPageShell>,
  );

  it("rend l'en-tête, le contenu puis le pied de page, en frères", () => {
    expect(html).toBe(
      '<header>en-tête</header><main style="position:relative;z-index:1"><h1>Contenu</h1></main><footer>pied</footer>',
    );
  });
});

describe("pages vitrine — repères de premier niveau", () => {
  const pages = sources("app", ".tsx");

  // Un `<header>` ou un `<footer>` dans `<main>` perd son rôle de repère
  // (`banner`, `contentinfo`) : ni l'un ni l'autre ne doit y être rendu.
  it.each(pages.filter(({ src }) => /<Public(Header|Footer) \/>/.test(src)).map(({ file, src }) => [file, src]))(
    "%s rend l'en-tête et le pied de page hors de son <main>",
    (_file, src) => {
      const open = src.indexOf("<main");
      const close = src.lastIndexOf("</main>");
      expect(open).toBeGreaterThan(-1);
      expect(src.indexOf("<PublicHeader />")).toBeLessThan(open);
      expect(src.lastIndexOf("<PublicFooter />")).toBeGreaterThan(close);
    },
  );

  it("les pages vitrine passent par le gabarit", () => {
    const shelled = pages.filter(({ src }) => src.includes("<PublicPageShell>")).map(({ file }) => file);
    expect(shelled).toEqual(
      expect.arrayContaining([
        "app/page.tsx",
        "app/association/page.tsx",
        "app/benevoles/page.tsx",
        "app/recrutement/page.tsx",
        "app/regles/page.tsx",
        "app/regles/[slug]/page.tsx",
        "app/rgpd/page.tsx",
        "app/rgpd/registre/page.tsx",
        "app/mentions-legales/page.tsx",
        "app/privacy-policy-bot/page.tsx",
        "app/terms-of-service-bot/page.tsx",
      ]),
    );
  });

  // Toute page a son `<main>` : un `<aside>` écrit dans une page y est donc
  // imbriqué, et n'est pas un repère de premier niveau (RGAA 12.6).
  it("aucune page ne pose d'<aside> dans son contenu", () => {
    const offenders = pages
      // Les commentaires JSX peuvent nommer la balise pour expliquer son absence.
      .filter(({ file, src }) => file.endsWith("/page.tsx") && /<aside[\s>]/.test(src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe("/connexion — ordre des titres", () => {
  const src = readSource("app/connexion/_components/LoginForm.tsx");

  it("rend la modale de consentement (h2) après la carte qui porte le h1", () => {
    const h1 = src.indexOf("<h1");
    const modal = src.indexOf("<RgpdConsentModal");
    expect(h1).toBeGreaterThan(-1);
    expect(modal).toBeGreaterThan(src.indexOf("</CyberCard>"));
    expect(modal).toBeLessThan(src.indexOf("</main>"));
  });
});

describe("PublicNavMenu — fermeture quand la tabulation en sort", () => {
  const inside = { id: "lien" } as unknown as Node;
  const outside = { id: "ailleurs" } as unknown as Node;
  const root = { contains: (node: Node | null) => node === inside };

  it("ferme quand le focus part hors du menu", () => {
    expect(focusLeftMenu(root, outside)).toBe(true);
  });

  it("reste ouvert quand le focus passe d'un lien à l'autre du panneau", () => {
    expect(focusLeftMenu(root, inside)).toBe(false);
  });

  it("reste ouvert quand la fenêtre perd le focus (aucune cible)", () => {
    expect(focusLeftMenu(root, null)).toBe(false);
  });

  it("ne décide rien sans racine montée", () => {
    expect(focusLeftMenu(null, outside)).toBe(false);
  });

  it("est branché sur le focusout du composant", () => {
    const src = readSource("components/cyber/landing/PublicNavMenu.tsx");
    expect(src).toMatch(/onBlur=\{\(e\) => \{\s*if \(open && focusLeftMenu\(rootRef\.current, e\.relatedTarget\)\) setOpen\(false\);/);
  });
});

/** Les règles d'une feuille : sélecteurs et corps, commentaires retirés. */
function rules(css: string): { selectors: string[]; body: string }[] {
  const found: { selectors: string[]; body: string }[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(stripComments(css))) !== null) {
    found.push({ selectors: splitSelectorList(match[1].trim()), body: match[2] });
  }
  return found;
}

describe("focus des champs — un repère qui ne tient pas à la seule bordure", () => {
  const sheets = [...sources("app", ".css"), ...sources("components", ".css")];

  it("rétablit un contour de focus en contrastes forcés, pour tout contrôle", () => {
    const css = stripComments(globals).replace(/\r\n/g, "\n");
    expect(css).toMatch(
      /@media \(forced-colors: active\) \{\s*:focus-visible:not\(\[tabindex="-1"\]\) \{\s*outline: 2px solid CanvasText !important;\s*outline-offset: 2px !important;\s*\}\s*\}/,
    );
  });

  // Une règle de focus qui ne fait que changer la couleur d'une bordure ne
  // laisse qu'un repère faible, et aucun en contrastes forcés, qui impose une
  // seule couleur de bordure : elle doit poser un anneau (ou un contour).
  //
  // Le contrôle lit le sélecteur **du focalisé lui-même** : un focus nommé dans
  // `:not(…)` ne l'est pas, un focus nommé dans `:has(…)` ou sur un ancêtre
  // (`.ligne:focus-visible .avatar`) habille un voisin de l'élément focalisé,
  // qui porte son propre repère. Et il cumule les règles d'un même sélecteur
  // dans une feuille : `.a:hover, .a:focus-visible { border-color }` suivi de
  // `.a:focus-visible { box-shadow }` est un anneau, écrit en deux fois.
  it("aucune règle de focus ne se contente de changer la couleur de la bordure", () => {
    const focusesSelf = (selector: string) => {
      const flat = selector.replace(/:(not|has)\([^()]*\)/g, "");
      const last = flat.split(/[\s>+~]+/).filter(Boolean).pop() ?? "";
      return last.includes(":focus");
    };
    const offenders = sheets.flatMap(({ file, src }) => {
      const bodies = new Map<string, string>();
      for (const { selectors, body } of rules(src)) {
        for (const selector of selectors.filter(focusesSelf)) {
          bodies.set(selector, `${bodies.get(selector) ?? ""};${body}`);
        }
      }
      return [...bodies]
        .filter(([, body]) => /(^|[;\s])border-color\s*:/.test(body))
        .filter(([, body]) => !/(^|[;\s])box-shadow\s*:/.test(body) && !/(^|[;\s])outline\s*:\s*(?!none)/.test(body))
        .map(([selector]) => `${file} — ${selector}`);
    });
    expect(offenders).toEqual([]);
  });

  it.each([
    ["app/recrutement/page.module.css", ".modalInput:focus"],
    ["app/association/page.module.css", ".modalInput:focus"],
    ["app/benevoles/page.module.css", ".modalInput:focus"],
    ["components/cyber/landing/AboutPillars.module.css", ".modalInput:focus"],
    ["components/cyber/landing/AboutStats.module.css", ".modalInput:focus"],
    ["components/cyber/landing/SponsorsGrid.module.css", ".modalInput:focus"],
    ["components/cyber/landing/FooterContact.module.css", ".input:focus"],
    ["components/cyber/landing/EditableCopy.module.css", ".input:focus-visible"],
    ["app/globals.css", ".searchbar-input:focus"],
  ])("%s — %s pose un anneau", (file, selector) => {
    const rule = rules(readSource(file)).find(({ selectors }) => selectors.includes(selector));
    expect(rule?.body).toMatch(/box-shadow:\s*0 0 0 3px rgba\(/);
  });
});
