import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkboxCardChrome } from "@/app/(secured)/tournois/_lib/form-styles";
import {
  ROOT,
  bareInputOffenders,
  blockFor,
  checkboxBlock,
  globals,
  inlineOffenders,
  walk,
} from "./_lib/style-sweep";

/**
 * L'apparence d'une case à cocher est posée **sur l'élément**, une fois.
 *
 * Huit écrans posaient un `<input type="checkbox">` nu et aucun ne l'habillait :
 * la case restait celle du système — carré blanc dicté par l'OS — sur un fond
 * noir profond. Le seul réglage qu'on trouvait ici ou là, `accent-color`, ne
 * teinte que la case **cochée**.
 *
 * La règle porte donc sur le sélecteur d'élément plutôt que sur une classe ou un
 * composant : une case ajoutée demain en hérite sans que personne ait à s'en
 * souvenir, ce qui est la seule façon de fermer une panne qui tient justement à
 * ce qu'on l'oublie. Ces contrôles sont au niveau source — une feuille de style
 * n'a pas d'autre prise en test.
 *
 * Le **moteur** des deux balayages vit dans `_lib/style-sweep.ts` et ses cas
 * limites dans `style-sweep.test.ts` : ce fichier-ci ne fait que l'appeler et
 * dire ce que la règle doit contenir.
 */
describe("règle de base", () => {
  const rule = checkboxBlock();

  it.each([
    ["retire l'apparence système", /appearance:\s*none/],
    ["donne une taille au lieu de la laisser au système", /width:\s*16px/],
    // En `border-box`, un rembourrage repousserait la taille imposée.
    ["remet le rembourrage à zéro", /padding:\s*0/],
  ])("%s", (_label, pattern) => {
    expect(rule).toMatch(pattern);
  });

  it("dessine la marque en image de fond, sur l'état coché", () => {
    // Un `input` n'a pas de pseudo-élément garanti : la coche est une image,
    // posée par la règle `:checked` et non par la règle de base.
    // L'accolade est exigée juste après : une règle **groupée** porte le même
    // sélecteur suivi d'une virgule et ne dessine, elle, que le cadrage.
    expect(blockFor(/input\[type="checkbox"\]:checked\s*\{/)).toMatch(/background-image/);
  });

  it("habille aussi le bouton radio, qui n'est qu'une case ronde", () => {
    // Les deux partagent une seule règle : les séparer les ferait diverger.
    expect(globals).toMatch(/input\[type="checkbox"\]\s*,\s*input\[type="radio"\]/);
  });

  it("donne un anneau de focus clavier — `appearance: none` le retire", () => {
    expect(blockFor(/input\[type="checkbox"\]:focus-visible/)).toMatch(/box-shadow|outline/);
  });

  it("marque l'état désactivé sans effacer le contrôle", () => {
    // Une case décochée n'est dessinée que par sa bordure : la ternir d'une
    // opacité l'efface. C'est une couleur qui dit le verrou, jamais une opacité.
    const disabled = blockFor(/input\[type="checkbox"\]:disabled/);
    expect(disabled).not.toMatch(/opacity/);
    expect(disabled).toMatch(/cursor:\s*not-allowed/);
  });
});

describe("contrastes forcés — la main revient au système", () => {
  const forced = globals.slice(globals.indexOf("@media (forced-colors: active)"));

  it("rend le dessin **et** les métriques", () => {
    // Le mode force la couleur de fond mais **pas** l'image : une coche presque
    // noire finirait sur un fond noir imposé, et cochée vaudrait décochée. Et
    // `appearance` rend le dessin, pas les métriques — une case native épinglée
    // à nos 16 px se rogne à côté d'un texte grossi, ce qui va justement de pair
    // avec ce mode sous Windows.
    const box = forced.slice(0, forced.indexOf("}"));
    for (const declaration of [
      "appearance: auto",
      "width: auto",
      "height: auto",
      "display: inline-block",
      "border-radius: 0",
    ]) {
      expect(box).toContain(declaration);
    }
    expect(forced).toContain("background-image: none");
  });

  it("remplace le halo du focus par une `outline`, que le mode ne supprime pas", () => {
    expect(forced).toMatch(/outline: 2px solid/);
  });

  it("en donne une aussi à la pastille `Coche`, seule visible", () => {
    // Son seul repère est un `box-shadow`, que le mode supprime ; et l'`outline`
    // posée sur la case ne peint rien — `Coche` la masque en ligne.
    const pill = globals
      .split("@media (forced-colors: active)")
      .slice(1)
      .find((block) => block.slice(0, 400).includes(".coche-input:focus-visible ~ .coche-pill"));
    expect(pill).toBeDefined();
  });
});

describe("pastille `Coche` — le focus passe par le CSS, jamais par React", () => {
  const coche = readFileSync(join(ROOT, "components", "Coche.tsx"), "utf8");

  it("relaie le focus par un sélecteur frère", () => {
    // Un état React redessinerait la pastille à chaque tabulation, et ne saurait
    // pas distinguer le clavier de la souris comme `:focus-visible` le fait.
    expect(globals).toContain(".coche-input:focus-visible ~ .coche-pill");
    expect(coche).not.toMatch(/useState.*[Ff]ocus/);
  });

  it("refuse `className`, `style` et `disabled` au lieu de les recevoir pour rien", () => {
    // La case est masquée en ligne (`opacity: 0`, 0×0) : un appelant qui la
    // réglerait par l'un des deux n'obtiendrait aucun effet et aucun
    // avertissement. `disabled`, lui, en obtiendrait la moitié — le geste
    // bloqué, la pastille intacte et son curseur toujours en « pointer » —, ce
    // que cette PR refuse ailleurs pour toutes les cases. Le type les refuse
    // tous les trois, comme `type`.
    expect(coche).toMatch(/"type" \| "onChange" \| "className" \| "style" \| "disabled"/);
    expect(coche).not.toContain("props.className");
    expect(coche).not.toContain("props.style");
  });
});

describe("carte « option » — le verrou se dit par la couleur", () => {
  it("ne passe jamais par une opacité", () => {
    // Elle se multiplierait avec la bordure de la case, seule à dessiner un
    // contrôle décoché, et l'effacerait. Une couleur ne se compose pas.
    // Sur le **code** seul : le bloc de doc explique justement pourquoi elle est
    // proscrite, et nommer l'interdit y est le propos.
    const source = readFileSync(
      join(ROOT, "app", "(secured)", "tournois", "_lib", "form-styles.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(source).not.toMatch(/opacity/);
  });

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])("rend un cadre pour coché=%s verrouillé=%s", (checked, locked) => {
    const chrome = checkboxCardChrome(checked, locked);
    expect(chrome.border).toMatch(/^1\.5px solid /);
    expect(chrome).not.toHaveProperty("opacity");
  });

  it("met la carte verrouillée en sourdine, cochée comme décochée", () => {
    // Verrouillée, elle gardait le chrome d'une carte qui répond au clic, seul
    // le texte changeant.
    expect(checkboxCardChrome(true, true).border).not.toBe(
      checkboxCardChrome(true, false).border,
    );
    expect(checkboxCardChrome(false, true).border).not.toBe(
      checkboxCardChrome(false, false).border,
    );
  });
});

describe("aucune feuille ne redéfinit l'apparence", () => {
  // Toutes les feuilles, pas seulement celles de module : `/bot` en importe deux
  // qui sont globales (`bot.css`, `docs/docs.css`) et pèsent donc autant.
  const sheets = walk(join(ROOT, "app"), ".css")
    .concat(walk(join(ROOT, "components"), ".css"))
    .map((path) => ({ path, css: readFileSync(path, "utf8") }));

  it("trouve bien des feuilles à contrôler", () => {
    expect(sheets.some(({ path }) => path.endsWith("globals.css"))).toBe(true);
    expect(sheets.some(({ path }) => path.endsWith(".module.css"))).toBe(true);
    expect(sheets.some(({ path }) => /bot\.css|docs\.css$/.test(path))).toBe(true);
  });

  it("n'habille jamais un `input` nu sans exclure la case à cocher", () => {
    expect(sheets.flatMap(({ path, css }) => bareInputOffenders(path, css))).toEqual([]);
  });
});

describe("aucun style en ligne ne reprend la main", () => {
  const sources = walk(join(ROOT, "app"), ".tsx")
    .concat(walk(join(ROOT, "components"), ".tsx"))
    .map((path) => ({ path, source: readFileSync(path, "utf8") }));

  it("trouve bien les cases du projet", () => {
    const withCheckbox = sources.filter(({ source }) => source.includes('type="checkbox"'));
    expect(withCheckbox.length).toBeGreaterThanOrEqual(8);
  });

  it("ne redit en ligne ni la taille ni la teinte de la case", () => {
    expect(sources.flatMap(({ path, source }) => inlineOffenders(path, source))).toEqual([]);
  });
});
