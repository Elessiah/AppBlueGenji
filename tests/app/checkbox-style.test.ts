import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const globals = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

/**
 * L'apparence d'une case à cocher est posée **sur l'élément**, une fois.
 *
 * Huit écrans posent un `<input type="checkbox">` nu et aucun ne l'habillait :
 * la case restait celle du système — carré blanc dicté par l'OS — sur un fond
 * noir profond. Le seul réglage qu'on trouvait ici ou là, `accent-color`, ne
 * teinte que la case **cochée**.
 *
 * La règle porte donc sur le sélecteur d'élément plutôt que sur une classe ou un
 * composant : une case ajoutée demain en hérite sans que personne ait à s'en
 * souvenir, ce qui est la seule façon de fermer une panne qui tient justement à
 * ce qu'on l'oublie. Ces contrôles sont au niveau source — une feuille de style
 * n'a pas d'autre prise en test.
 */
/**
 * Le corps de la première règle dont le sélecteur correspond.
 *
 * La recherche se fait sur un **motif** et non sur une chaîne : un sélecteur
 * écrit sur deux lignes tient à la mise en forme de la feuille, que Prettier ou
 * un sélecteur ajouté peuvent replier — et un dépôt sorti en CRLF n'a pas les
 * mêmes sauts de ligne. La règle, elle, n'aurait pas bougé. L'absence lève une
 * `Error` nommée plutôt qu'un `expect` : appelé hors d'un test, celui-ci fait
 * échouer le **chargement du module**, donc les vingt contrôles d'un coup et
 * sans dire lequel.
 */
function blockFor(pattern: RegExp, css: string = globals): string {
  const at = css.search(pattern);
  if (at < 0) throw new Error(`Règle introuvable dans globals.css : ${pattern}`);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

/** Le sélecteur de la règle de base, sauts de ligne et espaces indifférents. */
const CHECKBOX_RULE = /input\[type="checkbox"\]\s*,\s*input\[type="radio"\]\s*\{/;

/** La règle de base, partagée par la case et le radio. */
function checkboxBlock(): string {
  return blockFor(CHECKBOX_RULE);
}

/** Fichiers du projet portant l'extension donnée, `node_modules` exclu. */
function walk(dir: string, suffix: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, suffix, found);
    else if (entry.name.endsWith(suffix)) found.push(path);
  }
  return found;
}

describe("Cases à cocher — apparence unique", () => {
  it("retire l'apparence système", () => {
    expect(checkboxBlock()).toContain("appearance: none");
    expect(checkboxBlock()).toContain("-webkit-appearance: none");
  });

  it("donne une taille au lieu de la laisser au système", () => {
    expect(checkboxBlock()).toMatch(/width: 16px/);
    expect(checkboxBlock()).toMatch(/height: 16px/);
  });

  it("remet le rembourrage à zéro — en `border-box`, il repousserait la taille", () => {
    expect(checkboxBlock()).toMatch(/padding: 0/);
  });

  it("habille aussi le bouton radio, qui n'est qu'une case ronde", () => {
    expect(checkboxBlock()).toContain("appearance: none");
    expect(blockFor(/input\[type="radio"\]\s*\{\s*border-radius/)).toContain("border-radius: 50%");
  });

  it("dessine la marque en image de fond, un input n'ayant pas de pseudo-élément garanti", () => {
    expect(blockFor(/input\[type="checkbox"\]:checked\s*\{/)).toContain("background-image: url(");
    expect(blockFor(/input\[type="radio"\]:checked\s*\{\s*background-image/)).toContain(
      "background-image: url(",
    );
    expect(globals).not.toContain('input[type="checkbox"]::after');
  });

  it("donne un anneau de focus clavier — `appearance: none` le retire", () => {
    expect(blockFor(/input\[type="checkbox"\]:focus-visible\s*,/)).toContain("box-shadow");
  });

  it("marque l'état désactivé sans effacer le contrôle", () => {
    const off = blockFor(/input\[type="checkbox"\]:disabled\s*,/);
    expect(off).toContain("cursor: not-allowed");
    // Décochée, la case n'est que sa bordure — `appearance: none` a retiré le
    // carré que le système dessinait dessous. Trop pâle, elle laisse un trou
    // dans la page à côté de son étiquette, et l'état désactivé est durable
    // (le radio `START_TIME` l'est tant que le match n'a pas de date).
    const alpha = off.match(/border-color: rgba\(255, 255, 255, ([\d.]+)\)/);
    expect(alpha).not.toBeNull();
    expect(Number(alpha![1])).toBeGreaterThanOrEqual(0.3);
    // Elle reste tout de même plus pâle que la case active, sans quoi
    // « désactivé » ne se lirait plus.
    const on = checkboxBlock().match(/border: 1px solid rgba\(255, 255, 255, ([\d.]+)\)/);
    expect(on).not.toBeNull();
    expect(Number(alpha![1])).toBeLessThan(Number(on![1]));
  });

  it("ne fait plus miroiter une carte verrouillée", () => {
    // Le halo et le balayage du survol annonçaient un clic que la carte
    // verrouillée ne rend pas — et l'opacité qui les recouvrait a dû partir,
    // elle effaçait la bordure de la case.
    expect(globals).toContain(".checkbox-card:not([data-locked]):hover");
    expect(globals).toContain(".checkbox-card:not([data-locked]):hover::before");
    expect(globals).not.toMatch(/\.checkbox-card:hover/);
    // Les deux écrans qui verrouillent cette carte doivent poser l'attribut.
    for (const file of [
      join(ROOT, "app", "(secured)", "tournois", "_components", "FormatSettings.tsx"),
      join(ROOT, "app", "(secured)", "tournois", "creer", "PhaseCard.tsx"),
    ]) {
      expect(readFileSync(file, "utf8")).toMatch(/data-locked=\{/);
    }
  });

  it("ne laisse pas le survol effacer le coché ni le focus", () => {
    // `:not()` compte son argument : sans ses exclusions, le survol pèse plus
    // lourd que `:checked` et `:focus-visible`, et les défait tous les deux.
    const hover = globals.slice(globals.indexOf('input[type="checkbox"]:hover'));
    expect(hover.slice(0, 120)).toContain(":not(:checked)");
    expect(hover.slice(0, 120)).toContain(":not(:focus-visible)");
  });

  it("relaie en CSS le focus de la pastille `Coche`, jamais par un état React", () => {
    // `:focus-visible` bascule aussi sur une touche pressée alors que l'élément
    // est **déjà** focalisé : aucun évènement ne le dit, un état échantillonné à
    // `onFocus` reste donc muet là où le clavier prend la main.
    expect(globals).toContain(".coche-input:focus-visible ~ .coche-pill");
    const coche = readFileSync(join(ROOT, "components", "Coche.tsx"), "utf8");
    expect(coche).toContain('className="coche-input"');
    expect(coche).toContain('className="coche-pill"');
    expect(coche).not.toContain("useState");
    expect(coche).not.toContain(':focus-visible")');
  });

  it("refuse `className` et `style` au lieu de les recevoir pour rien", () => {
    // Ils atterriraient sur l'input, que le composant masque (`opacity: 0`,
    // 0×0) : un appelant réglant la pastille par l'un des deux n'obtiendrait
    // aucun effet et aucun avertissement. Le type les refuse, comme `type`.
    const coche = readFileSync(join(ROOT, "components", "Coche.tsx"), "utf8");
    expect(coche).toMatch(/"type" \| "onChange" \| "className" \| "style"/);
    expect(coche).not.toContain("props.className");
    expect(coche).not.toContain("props.style");
  });

  it("rend la main au système en contrastes forcés", () => {
    // Le mode force la couleur de fond mais **pas** l'image : une coche presque
    // noire finirait sur un fond noir imposé, et cochée vaudrait décochée.
    const forced = globals.slice(globals.indexOf("@media (forced-colors: active)"));
    expect(forced).toContain("appearance: auto");
    expect(forced).toContain("background-image: none");
    // Le `box-shadow` du focus est supprimé lui aussi : il faut une `outline`.
    expect(forced).toMatch(/outline: 2px solid/);
  });

  it("donne aussi un anneau à la pastille `Coche` en contrastes forcés", () => {
    // Son seul repère est un `box-shadow`, que le mode supprime ; et l'`outline`
    // de secours posée sur la case ne peint rien — `Coche` la masque en ligne
    // (`opacity: 0`, 0×0). C'est la pastille, seule visible, qui doit la porter.
    const forcedBlocks = globals.split("@media (forced-colors: active)").slice(1);
    const pill = forcedBlocks.find((block) =>
      block.slice(0, 400).includes(".coche-input:focus-visible ~ .coche-pill"),
    );
    expect(pill).toBeDefined();
    expect(pill!.slice(0, 400)).toMatch(/outline: 2px solid/);
  });
});

/**
 * Garde anti-divergence — le seul débordement possible est la **spécificité**.
 *
 * `input[type="checkbox"]` pèse une classe et un élément : exactement le poids
 * d'un `.x input`. À égalité, c'est la dernière déclaration lue qui l'emporte,
 * et une feuille de module n'a pas d'ordre garanti vis-à-vis de `globals.css` —
 * une règle écrite pour un champ de saisie déborde donc sur la case qu'un écran
 * posera demain dans le même bloc. Le cas était réel : `.field input` imposait
 * son rembourrage (case rectangulaire, `appearance` retirée) et son anneau vert
 * au clic.
 *
 * La règle tenue ici est donc : **un sélecteur qui vise un `input` nu et décrit
 * sa boîte doit exclure la case à cocher**. Celui qui nomme son type
 * (`input[type="radio"]`, `input[type="number"]`) reste libre — il dit déjà ce
 * qu'il vise.
 */
const BOX_PROPERTIES = [
  "appearance",
  // Le motif s'ancre sur un début de déclaration : `-webkit-appearance` commence
  // par un tiret, `appearance` seul ne l'atteint donc pas. Or c'est lui qui
  // *rend* la case au système sur WebKit, et le rendre à un écran seul rouvre
  // exactement la panne — une case système au milieu de cases dessinées.
  "-webkit-appearance",
  "-moz-appearance",
  "accent-color",
  "width",
  "height",
  "padding",
  "margin",
  "display",
  "border",
  "background",
  "box-shadow",
  // Un `flex: 1` pose `flex-basis: 0%` : sur une case de 16 px dans une rangée
  // flex, le `flex-shrink: 0` global ne la protège pas d'un socle nul.
  "flex",
  "min-width",
  "max-width",
  // `height` seul ne les attrape pas : le motif s'ancre sur un début de
  // déclaration (`(^|[;{\s])`) et le tiret de `min-height` n'en est pas un.
  // Un `min-height: 44px` posé pour la cible tactile étire la case hors de sa
  // boîte de 16 px aussi sûrement qu'un `height`.
  "min-height",
  "max-height",
  // `appearance: none` retire l'anneau natif : `outline` fait désormais partie
  // de ce qui peut casser le contrôle sans qu'on le voie.
  "outline",
  // Une case décochée n'est plus dessinée que par sa bordure : la ternir, c'est
  // l'effacer. C'était le cas réel — `.field input:disabled` ne déclarait
  // *que* `opacity` et `cursor`, donc aucune des propriétés ci-dessus, et
  // serait passé au travers de ce balayage.
  "opacity",
  // Redimensionner par `transform` ne **collisionne** pas avec la règle globale,
  // il se compose avec elle : la case garde ses 16 px déclarés et s'affiche plus
  // grande, sans qu'aucune déclaration ne soit perdue. C'est donc la divergence
  // d'un écran à l'autre sous sa forme la moins visible d'ici. `scale`, `rotate`
  // et `translate` (propriétés indépendantes) font la même chose sans le mot.
  "transform",
  "scale",
  "rotate",
  "translate",
  "zoom",
];

/**
 * Un `input` sans `[type=…]` accolé : ce compound-là attrape les cases. La
 * parenthèse ouvrante compte parmi les débuts possibles — `:is(input, textarea)`
 * vise l'élément nu tout autant que `.x input`.
 */
const BARE_INPUT = /(^|[\s>+~,(])input(?![\w-]|\[|\s*\{)/;

type Offender = { file: string; selector: string };

/**
 * Le compound sort-il **les deux** contrôles ? L'exclusion ne vaut que dans un
 * `:not(…)` : un `:is([type="checkbox"], [type="radio"])` nomme les mêmes types
 * pour mieux les viser, et pèse alors plus lourd que la règle globale.
 */
function excludesBoth(compound: string): boolean {
  const negated = [...compound.matchAll(/:not\(([^()]*)\)/g)].map((m) => m[1]).join(" ");
  return negated.includes('[type="checkbox"]') && negated.includes('[type="radio"]');
}

/**
 * Découpe une liste de sélecteurs sur ses virgules **de premier niveau** : celle
 * d'un `:not([type="checkbox"], [type="radio"])` appartient au sélecteur, la
 * couper le mutilerait et ferait passer l'exclusion pour absente.
 */
function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of selector) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts.filter((part) => part.length > 0);
}

/**
 * Découpe un sélecteur en **compounds** sur ses combinateurs de premier niveau.
 *
 * L'exclusion appartient au compound qui la porte, pas au sélecteur entier :
 * `.field input:not([type="checkbox"]):not([type="radio"]) + input` en contient
 * **deux**, et seul le premier est gardé — lue sur la chaîne complète, la
 * négation du premier innocentait le second, qui réimposerait pourtant sa
 * largeur à une case, à spécificité égale.
 */
function splitCompounds(part: string): string[] {
  const compounds: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of part) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (depth === 0 && /[\s>+~]/.test(char)) {
      if (current.trim().length > 0) compounds.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) compounds.push(current.trim());
  return compounds;
}

function bareInputOffenders(path: string, css: string): Offender[] {
  const offenders: Offender[] = [];
  // Les commentaires partent **d'abord** : le découpage naïf ci-dessous les
  // replie dans le sélecteur, si bien qu'une règle précédée d'un commentaire —
  // la forme même que laisse ce correctif — passait tout entière au travers.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Découpage volontairement naïf (`sélecteur { déclarations }`) : ces feuilles
  // n'ont ni `@media` imbriqué dans une règle ni accolade dans une valeur.
  for (const [, rawSelector, body] of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rawSelector.trim().replace(/\s+/g, " ");
    if (selector.startsWith("@") || selector === "") continue;
    const bare = splitSelectorList(selector)
      .flatMap((part) => splitCompounds(part))
      .filter((compound) => BARE_INPUT.test(compound) && !excludesBoth(compound));
    if (bare.length === 0) continue;
    const declares = BOX_PROPERTIES.some((property) =>
      new RegExp(`(^|[;{\\s])${property}[\\w-]*\\s*:`).test(body),
    );
    if (declares) {
      offenders.push({ file: relative(ROOT, path), selector: bare.join(", ") });
    }
  }
  return offenders;
}

describe("Cases à cocher — aucune feuille ne redéfinit l'apparence", () => {
  // Toutes les feuilles, pas seulement celles de module : `/bot` en importe deux
  // qui sont globales (`bot.css`, `docs/docs.css`) et pèsent donc autant.
  const sheets = walk(join(ROOT, "app"), ".css")
    .concat(walk(join(ROOT, "components"), ".css"))
    .map((path) => ({ path, css: readFileSync(path, "utf8") }));

  it("trouve bien des feuilles à contrôler", () => {
    expect(sheets.some(({ path }) => path.endsWith("globals.css"))).toBe(true);
    expect(sheets.some(({ path }) => path.endsWith(".module.css"))).toBe(true);
    // Les feuilles globales hors module comptent aussi.
    expect(
      sheets.some(({ path }) => path.endsWith("bot.css") || path.endsWith("docs.css")),
    ).toBe(true);
  });

  it("n'habille jamais un `input` nu sans exclure la case à cocher", () => {
    const offenders = sheets.flatMap(({ path, css }) => bareInputOffenders(path, css));
    expect(offenders).toEqual([]);
  });

  it("laisse libre le sélecteur qui nomme son type", () => {
    // Le garde-fou ne doit pas interdire d'habiller un bouton radio, que la
    // règle globale ne couvre pas : il ne vise que l'`input` nu.
    expect(bareInputOffenders("x.css", 'input[type="date"] { padding: 4px; }')).toEqual([]);
    expect(bareInputOffenders("x.css", ".a > input { width: auto; }")).toHaveLength(1);
    expect(bareInputOffenders("x.css", '.a input[type="checkbox"] { width: auto; }')).toEqual([]);
    const excluded = '.a input:not([type="checkbox"]):not([type="radio"]) { width: auto; }';
    expect(bareInputOffenders("x.css", excluded)).toEqual([]);
    // Nommer les deux types pour mieux les **viser** n'est pas les exclure.
    const targeted = '.a input:is([type="checkbox"], [type="radio"]) { width: auto; }';
    expect(bareInputOffenders("x.css", targeted)).toHaveLength(1);
    // `flex: 1` donne un socle nul à un contrôle de 16 px.
    expect(bareInputOffenders("x.css", ".a input { flex: 1; }")).toHaveLength(1);
    // Exclure la case sans exclure le radio ne suffit plus : les deux sont posés
    // sur l'élément.
    const half = '.a input:not([type="checkbox"]) { width: auto; }';
    expect(bareInputOffenders("x.css", half)).toHaveLength(1);
    // Un `:is(…)` vise l'élément nu tout autant qu'un descendant écrit à plat.
    const wrapped = ".panel :is(input, textarea) { padding: 8px; }";
    expect(bareInputOffenders("x.css", wrapped)).toHaveLength(1);
    // `outline` casse l'anneau de focus, que `appearance: none` a retiré.
    expect(bareInputOffenders("x.css", ".a input:focus { outline: 2px solid; }")).toHaveLength(1);
    expect(bareInputOffenders("x.css", "input, textarea { font: inherit; }")).toEqual([]);
    // La virgule d'un `:not(…)` n'est pas celle d'une liste de sélecteurs.
    expect(splitSelectorList('a:not(.x, .y), b')).toEqual(["a:not(.x, .y)", "b"]);
    // Un commentaire au-dessus ne doit plus servir de laissez-passer.
    expect(bareInputOffenders("x.css", "/* note */\n.a input { width: auto; }")).toHaveLength(1);
    // Ternir une case décochée l'efface : sa bordure est tout ce qui la dessine.
    // C'est la forme exacte que prenait la règle corrigée (`opacity` + `cursor`,
    // et rien d'autre), donc celle que ce balayage devait déjà voir.
    const faded = ".a input:disabled { opacity: 0.6; cursor: not-allowed; }";
    expect(bareInputOffenders("x.css", faded)).toHaveLength(1);
    // L'exclusion appartient au compound qui la porte : lue sur le sélecteur
    // entier, celle du premier `input` innocentait le second, pourtant nu.
    const twoInputs =
      '.field input:not([type="checkbox"]):not([type="radio"]) + input { width: 100%; }';
    expect(bareInputOffenders("x.css", twoInputs)).toHaveLength(1);
    // Et une taille minimale étire la case hors de sa boîte de 16 px.
    expect(bareInputOffenders("x.css", ".a input { min-height: 44px; }")).toHaveLength(1);
    // Un `transform` ne collisionne pas, il se **compose** : la case garde ses
    // 16 px et s'affiche plus grande, sans qu'aucune déclaration ne se perde.
    expect(bareInputOffenders("x.css", ".a input { transform: scale(1.5); }")).toHaveLength(1);
    expect(bareInputOffenders("x.css", ".a input { scale: 1.5; }")).toHaveLength(1);
    // Le préfixe constructeur rend la case au système : il commence par un
    // tiret, là où le motif attend un début de déclaration.
    const prefixed = ".a input { -webkit-appearance: checkbox; }";
    expect(bareInputOffenders("x.css", prefixed)).toHaveLength(1);
  });
});

/**
 * Garde anti-divergence — un style **en ligne** bat toute feuille.
 *
 * Deux écrans posaient `width: 18, accentColor: …` sur leur case : ils gardaient
 * donc, seuls, la taille et la teinte dont la règle venait de sortir tout le
 * site — précisément le « deux écrans voisins n'avaient pas la même » que cette
 * règle ferme. `accent-color` y est en outre mort, `appearance: none` le
 * désactivant.
 */
/*
 * Les **longhands** comptent autant que les raccourcis : `backgroundColor` et
 * `borderColor` refont à eux deux la case entière, et le motif d'avant, qui
 * exigeait le nom exact suivi du deux-points, les laissait passer — la moitié
 * la plus forte de la garde était donc la plus permissive. D'où des familles
 * (`border…`, `background…`, `outline…`) plutôt qu'une liste de noms.
 *
 * `margin` fait seul exception à la famille : le raccourci est tenu — il défait
 * le `margin: 0` global — mais pas `marginTop`, qui aligne la case de 16 px sur
 * la première ligne de son étiquette sans rien changer à sa boîte. Quatre
 * écrans s'en servent, et c'est le seul réglage qu'aucune règle globale ne peut
 * prendre à leur place : il dépend de la taille du texte d'à côté.
 */
const INLINE_BANNED =
  /\b(width|minWidth|maxWidth|height|minHeight|maxHeight|accentColor|[A-Za-z]*[Aa]ppearance|padding[A-Za-z]*|margin|display|border[A-Za-z]*|background[A-Za-z]*|box[A-Za-z]*|outline[A-Za-z]*|opacity|flex[A-Za-z]*|transform|scale|rotate|translate|zoom)\s*:/;

function inlineOffenders(path: string, source: string): Offender[] {
  const offenders: Offender[] = [];
  for (const chunk of source.split("<input").slice(1)) {
    const end = chunk.indexOf("/>");
    const tag = end === -1 ? chunk.slice(0, 600) : chunk.slice(0, end);
    if (!/type=["'](checkbox|radio)["']/.test(tag)) continue;
    const style = tag.match(/style=\{\{([\s\S]*?)\}\}/);
    if (!style) {
      // Un `style={variable}` ne se lit pas d'ici : le balayage ne peut ni
      // l'innocenter ni le condamner, donc il le refuse — la règle globale doit
      // rester le seul endroit où l'apparence se décide. (Un `{...props}` sans
      // `style` reste permis : il ne porte pas d'apparence par lui-même.)
      if (/style=\{/.test(tag)) {
        offenders.push({ file: relative(ROOT, path), selector: "style non littéral" });
      }
      continue;
    }
    // Une case délibérément masquée (relais de focus d'un contrôle dessiné à
    // côté) donne sa propre boîte : elle ne peint rien.
    if (/opacity:\s*0(?![.\d])/.test(style[1])) continue;
    if (INLINE_BANNED.test(style[1])) {
      offenders.push({ file: relative(ROOT, path), selector: style[1].trim() });
    }
  }
  return offenders;
}

describe("Cases à cocher — aucun style en ligne ne reprend la main", () => {
  const sources = walk(join(ROOT, "app"), ".tsx")
    .concat(walk(join(ROOT, "components"), ".tsx"))
    .map((path) => ({ path, source: readFileSync(path, "utf8") }));

  it("trouve bien les cases du projet", () => {
    const withCheckbox = sources.filter(({ source }) => source.includes('type="checkbox"'));
    expect(withCheckbox.length).toBeGreaterThanOrEqual(8);
  });

  it("ne redit en ligne ni la taille ni la teinte de la case", () => {
    const offenders = sources.flatMap(({ path, source }) => inlineOffenders(path, source));
    expect(offenders).toEqual([]);
  });

  it("laisse passer la case volontairement masquée", () => {
    const hidden = '<input type="checkbox" style={{ opacity: 0, width: 0, height: 0 }} />';
    expect(inlineOffenders("x.tsx", hidden)).toEqual([]);
    const sized = '<input type="checkbox" style={{ width: 18, height: 18 }} />';
    expect(inlineOffenders("x.tsx", sized)).toHaveLength(1);
    // `opacity: 0.6` n'est pas un masquage : la case se voit, donc elle est tenue.
    const faded = '<input type="checkbox" style={{ opacity: 0.6, width: 18 }} />';
    expect(inlineOffenders("x.tsx", faded)).toHaveLength(1);
    // Illisible d'ici, donc refusé : l'apparence ne se décide qu'au global.
    const opaque = '<input type="checkbox" style={someStyle} />';
    expect(inlineOffenders("x.tsx", opaque)).toHaveLength(1);
    // Un étalement de props sans `style` ne porte aucune apparence.
    const spread = '<input type="checkbox" {...props} />';
    expect(inlineOffenders("x.tsx", spread)).toEqual([]);
    // `marginTop` aligne la case sur la première ligne de son étiquette : il ne
    // touche pas à sa boîte, et aucune règle globale ne peut le décider, la
    // taille du texte d'à côté n'étant pas la même d'un écran à l'autre.
    const aligned = '<input type="checkbox" style={{ marginTop: 2 }} />';
    expect(inlineOffenders("x.tsx", aligned)).toEqual([]);
  });

  it("tient en ligne tout ce que la feuille tient — c'est la moitié la plus forte", () => {
    // Un style en ligne bat la règle globale : cette liste ne peut pas être plus
    // permissive que celle du balayage des feuilles. `flex: 1` pose un
    // `flex-basis: 0%` (le `flex-shrink: 0` global ne protège pas d'un socle
    // nul), `border: "none"` efface la seule chose qui dessine une case
    // décochée, et `minWidth` n'était pas même atteint par le motif — `n` et `W`
    // sont deux caractères de mot, il n'y a pas de frontière entre eux.
    for (const style of [
      "flex: 1",
      "flexBasis: 0",
      'border: "none"',
      'borderColor: "#fff"',
      "borderWidth: 3",
      'background: "red"',
      'backgroundColor: "#fff"',
      "minWidth: 24",
      "maxWidth: 24",
      "minHeight: 44",
      "maxHeight: 44",
      "paddingLeft: 4",
      'display: "block"',
      'boxShadow: "none"',
      'boxSizing: "content-box"',
      'outline: "none"',
      'outlineColor: "#fff"',
      'transform: "scale(1.4)"',
      "scale: 1.5",
      'rotate: "45deg"',
      'translate: "0 2px"',
      "margin: 0",
      // Le préfixe constructeur n'est pas une frontière de mot : `\bappearance`
      // ne pouvait pas l'atteindre, le même piège que `minWidth`. Et c'est lui
      // qui rend la case au système sur WebKit.
      'WebkitAppearance: "checkbox"',
      'MozAppearance: "none"',
    ]) {
      expect(inlineOffenders("x.tsx", `<input type="checkbox" style={{ ${style} }} />`)).toHaveLength(
        1,
      );
    }
  });
});
