import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Le **moteur** du balayage de styles, séparé de ce qu'on lui fait dire.
 *
 * Il vivait dans `tests/app/checkbox-style.test.ts`, où ses trois cents lignes
 * de logique noyaient la vingtaine d'assertions qui les emploient — un fichier
 * de 747 lignes pour garder l'apparence d'une case à cocher. Le partage n'est
 * pas cosmétique : ce balayage ne parle pas de cases à cocher, il répond à
 * « une règle locale reprend-elle la main sur une règle d'élément ? », question
 * qui vaudra pour le prochain contrôle posé de la même façon.
 *
 * Ses propres cas limites sont éprouvés dans `tests/app/style-sweep.test.ts` ;
 * `checkbox-style.test.ts` ne fait plus que l'appeler.
 */

export const ROOT = join(__dirname, "..", "..", "..");
export const globals = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

/**
 * Les commentaires en moins, remplacés par une espace (jamais par rien : deux
 * jetons que le commentaire séparait resteraient sinon collés).
 *
 * Une feuille se lit ici par motifs, et **un commentaire nomme ce qu'il
 * explique** : la règle de base ouvre justement sur « `padding: 0` n'est pas une
 * redondance », si bien qu'un contrôle cherchant `padding:\s*0` était satisfait
 * par la prose et non par la déclaration — on pouvait retirer le vrai `padding`
 * sans qu'un seul test bronche. Le symétrique guette à l'autre bout : le jour où
 * l'on écrit le mot `opacity` dans le commentaire de la règle `:disabled`, le
 * contrôle qui l'y interdit part au rouge sans qu'aucune déclaration n'ait
 * bougé. Un commentaire explique une règle, il ne la prouve pas.
 */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

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
export function blockFor(pattern: RegExp, source: string = globals): string {
  // Les commentaires partent **avant** la recherche, et pas seulement du corps
  // rendu : un commentaire précédant la règle peut porter le motif du sélecteur
  // et faire découper la mauvaise règle.
  const css = stripComments(source);
  const at = css.search(pattern);
  if (at < 0) throw new Error(`Règle introuvable dans globals.css : ${pattern}`);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

/** Le sélecteur de la règle de base, sauts de ligne et espaces indifférents. */
export const CHECKBOX_RULE = /input\[type="checkbox"\]\s*,\s*input\[type="radio"\]\s*\{/;

/** La règle de base, partagée par la case et le radio. */
export function checkboxBlock(): string {
  return blockFor(CHECKBOX_RULE);
}

/** Fichiers du projet portant l'extension donnée, `node_modules` exclu. */
export function walk(dir: string, suffix: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, suffix, found);
    else if (entry.name.endsWith(suffix)) found.push(path);
  }
  return found;
}

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
 *
 * Sa **limite**, et elle est assumée : ce balayage lit des feuilles, pas du JSX.
 * `input.maCase` est bien vu (`input` nu suivi d'une classe), mais une règle qui
 * n'atteint la case que par une classe — `.panel .maCase { appearance: auto }` —
 * ne se distingue d'aucune autre sans savoir à quel élément cette classe est
 * posée. Le cas est hors de portée d'un contrôle sur les sources, et c'est
 * justement pourquoi l'apparence est posée sur l'**élément** : une règle de
 * classe est un geste délibéré, pas un débordement qu'on n'a pas vu venir.
 */
export const BOX_PROPERTIES = [
  // `all` d'abord, parce qu'il vaut tous les autres à lui seul : `all: unset`
  // ou `all: revert` sur un `input` nu rend la case au système d'un mot, sans
  // nommer aucune des propriétés listées en dessous. C'est un idiome courant de
  // remise à zéro d'un contrôle de formulaire, donc la forme la plus probable
  // de la panne que ce balayage existe pour fermer.
  "all",
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
  // Les mêmes en **logique** : `inline-size` et `block-size` sont `width` et
  // `height` sous un autre nom, et le motif s'ancrant sur un début de
  // déclaration, aucun des deux précédents ne les atteint.
  "inline-size",
  "block-size",
  "padding",
  // Tenu **exactement**, sans sa famille, là où les autres sont des familles :
  // le raccourci défait le `margin: 0` global, mais `margin-top` aligne la case
  // de 16 px sur la première ligne de son étiquette sans rien changer à sa
  // boîte. C'est déjà l'exception que s'accorde le balayage des styles en ligne
  // (`INLINE_BANNED`, plus bas) ; la refuser ici rendrait illégale en feuille la
  // déclaration même qu'on déclare légale en ligne — donc interdirait de sortir
  // des styles en ligne, direction que ce correctif prend partout ailleurs.
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
 * Les propriétés tenues **au nom exact**, quand toutes les autres le sont en
 * famille (`border` attrape `border-color`, `background` attrape
 * `background-image`…). Deux y figurent, pour deux raisons opposées.
 *
 * `margin`, parce que la famille en dirait trop : `margin-top` n'habille pas la
 * case, il l'aligne sur la première ligne de son étiquette, et dépend donc de la
 * taille du texte d'à côté — aucune règle globale ne peut le prendre à la place
 * d'un écran. C'est déjà l'exception que s'accorde le balayage des styles en
 * ligne (`INLINE_BANNED`).
 *
 * `all`, parce qu'elle n'a pas de famille : c'est un nom complet, et le suffixe
 * ouvert de la forme générale lui ferait attraper la première propriété
 * inventée qui commencerait par ces trois lettres.
 */
const EXACT_PROPERTIES = new Set(["margin", "all"]);

/**
 * Un `input` sans `[type=…]` accolé : ce compound-là attrape les cases. La
 * parenthèse ouvrante compte parmi les débuts possibles — `:is(input, textarea)`
 * vise l'élément nu tout autant que `.x input`.
 */
const BARE_INPUT = /(^|[\s>+~,(])input(?![\w-]|\[|\s*\{)/;

export type Offender = { file: string; selector: string };

/**
 * Le compound sort-il **les deux** contrôles ? L'exclusion ne vaut que dans un
 * `:not(…)` : un `:is([type="checkbox"], [type="radio"])` nomme les mêmes types
 * pour mieux les viser, et pèse alors plus lourd que la règle globale.
 *
 * Et elle ne vaut que **chaînée**, un `:not()` par type : la liste dans un
 * `:not()` est du Sélecteurs 4, et un moteur qui ne la comprend pas jette la
 * règle **entière** — le `.field textarea` qui la partage avec elle. C'est la
 * raison écrite dans `app/globals.css` au-dessus de la règle des cases ; la
 * bénir ici, c'était laisser passer la forme que le projet s'interdit, et une
 * garde qui autorise ce que sa propre justification refuse ne garde rien. Un
 * `:not(…)` portant une virgule est donc **ignoré** : le compound retombe sur
 * l'`input` nu et le balayage le signale.
 */
function excludesBoth(compound: string): boolean {
  const negated = [...compound.matchAll(/:not\(([^()]*)\)/g)]
    .map((m) => m[1])
    .filter((inner) => !inner.includes(","))
    .join(" ");
  return negated.includes('[type="checkbox"]') && negated.includes('[type="radio"]');
}

/**
 * Découpe une liste de sélecteurs sur ses virgules **de premier niveau** : celle
 * d'un `:not([type="checkbox"], [type="radio"])` appartient au sélecteur, la
 * couper le mutilerait et ferait passer l'exclusion pour absente.
 */
export function splitSelectorList(selector: string): string[] {
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

/**
 * Le compound **vise-t-il** un `input` ? Le contenu d'un `:has(…)` ou d'un
 * `:not(…)` est une *condition* portée par le sujet, jamais le sujet :
 * `.carte:has(input:enabled)` habille la carte, pas la case. Un `:is(…)` ou un
 * `:where(…)`, eux, **sont** le sujet (`:is(input, textarea)` atteint bien
 * l'élément), et restent donc en place. La négation est retirée après que
 * `excludesBoth` l'a lue — elle n'y perd rien.
 */
function subjectOf(compound: string): string {
  return compound.replace(/:(?:has|not)\([^()]*\)/g, "");
}

export function bareInputOffenders(path: string, css: string): Offender[] {
  const offenders: Offender[] = [];
  // Les commentaires partent **d'abord** : le découpage naïf ci-dessous les
  // replie dans le sélecteur, si bien qu'une règle précédée d'un commentaire —
  // la forme même que laisse ce correctif — passait tout entière au travers.
  const stripped = stripComments(css);
  // Découpage volontairement naïf (`sélecteur { déclarations }`) : ces feuilles
  // n'ont ni `@media` imbriqué dans une règle ni accolade dans une valeur.
  for (const [, rawSelector, body] of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rawSelector.trim().replace(/\s+/g, " ");
    if (selector.startsWith("@") || selector === "") continue;
    const bare = splitSelectorList(selector)
      .flatMap((part) => splitCompounds(part))
      .filter((compound) => BARE_INPUT.test(subjectOf(compound)) && !excludesBoth(compound));
    if (bare.length === 0) continue;
    const declares = BOX_PROPERTIES.some((property) =>
      new RegExp(
        `(^|[;{\\s])${property}${EXACT_PROPERTIES.has(property) ? "(?![\\w-])" : "[\\w-]*"}\\s*:`,
      ).test(body),
    );
    if (declares) {
      offenders.push({ file: relative(ROOT, path), selector: bare.join(", ") });
    }
  }
  return offenders;
}

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
 * `all` ouvre la liste pour la même raison qu'en feuille : `all: "revert"` rend
 * la case au système d'un mot, sans en nommer aucune autre. `inlineSize` et
 * `blockSize` sont `width` et `height` sous leur nom logique.
 *
 * `margin` fait seul exception à la famille : le raccourci est tenu — il défait
 * le `margin: 0` global — mais pas `marginTop`, qui aligne la case de 16 px sur
 * la première ligne de son étiquette sans rien changer à sa boîte. Quatre
 * écrans s'en servent, et c'est le seul réglage qu'aucune règle globale ne peut
 * prendre à leur place : il dépend de la taille du texte d'à côté.
 */
export const INLINE_BANNED =
  /\b(all|width|minWidth|maxWidth|inlineSize|blockSize|height|minHeight|maxHeight|accentColor|[A-Za-z]*[Aa]ppearance|padding[A-Za-z]*|margin|display|border[A-Za-z]*|background[A-Za-z]*|box[A-Za-z]*|outline[A-Za-z]*|opacity|flex[A-Za-z]*|transform|scale|rotate|translate|zoom)\s*:/;

/**
 * La fin de la balise, cherchée sur le **premier `>` de premier niveau** et non
 * sur le premier `/>` venu.
 *
 * Une valeur d'attribut contient le sien : `icon={<Check />}` referme un autre
 * élément *avant* la balise qui le porte, si bien que le découpage naïf coupait
 * la balise en deux et n'y voyait jamais le `style` qui suit — un style en ligne
 * passait alors la garde sans qu'aucun test n'échoue, et cette garde est la
 * moitié forte de l'invariant (un style en ligne bat toute feuille). Les
 * accolades et les guillemets mettent donc le `>` hors de portée, exactement
 * comme le fait le parseur.
 */
function tagEnd(chunk: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < chunk.length; index += 1) {
    const char = chunk[index];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return index;
  }
  return -1;
}

export function inlineOffenders(path: string, source: string): Offender[] {
  const offenders: Offender[] = [];
  for (const chunk of source.split("<input").slice(1)) {
    const end = tagEnd(chunk);
    const tag = end === -1 ? chunk.slice(0, 600) : chunk.slice(0, end);
    // Le type peut être calculé (`type={isRadio ? "radio" : "checkbox"}`) : une
    // case écrite ainsi sortait avant d'avoir montré son style, et gardait donc
    // la sienne. On la reconnaît au mot, où qu'il soit dans l'expression.
    const literal = /type=["'](checkbox|radio)["']/.test(tag);
    const computed = /type=\{[^}]*["'](checkbox|radio)["'][^}]*\}/.test(tag);
    if (!literal && !computed) continue;
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

