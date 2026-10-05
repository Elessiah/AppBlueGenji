/**
 * Règle locale `bluegenji/no-literal-ui-text` (`docs/features/I18N.md`).
 *
 * Dans un dossier **traduit**, tout texte d'interface passe par une clé de
 * traduction (`useTranslations` / `getTranslations`). La règle refuse :
 *
 * - un texte JSX littéral qui contient une lettre (`<p>Bonjour</p>`) — la
 *   ponctuation et les espaces seuls (`" — "`, `·`) restent permis ;
 * - une chaîne littérale qui contient une lettre dans un attribut lu par
 *   l'utilisateur ou un lecteur d'écran (`aria-label`, `ariaLabel`, `title`,
 *   `placeholder`, `alt`, `label`, `aria-description`, `aria-valuetext`) ;
 *
 * dans les deux cas, y compris derrière une condition, un `&&`/`||`/`??`,
 * une concaténation ou un gabarit (voir {@link literalTexts}).
 *
 * Les noms propres et marques qui ne se traduisent pas (« BlueGenji »,
 * « Discord ») se mettent quand même dans les messages : la règle ne sait pas
 * les distinguer, et un message identique dans les deux langues coûte une
 * ligne.
 */
"use strict";

const UI_ATTRIBUTES = new Set([
  "aria-label",
  "ariaLabel",
  "title",
  "placeholder",
  "alt",
  "label",
  "aria-description",
  "aria-valuetext",
]);

/** Une lettre de n'importe quel alphabet : le reste n'est que ponctuation. */
const LETTER = /\p{L}/u;

/**
 * Les morceaux de texte littéral qu'une expression peut **afficher** : la
 * chaîne elle-même, mais aussi les branches d'une condition
 * (`ok ? "Inscrit" : "Fermé"`), la valeur d'un `&&` / `||` / `??`
 * (`isOwner && "Gérer"`), les morceaux d'une concaténation (`"Équipe " + n`)
 * et les parties fixes d'un gabarit (`` `${n} équipes` ``) — les formes les
 * plus courantes d'un texte d'interface. Le test d'un `&&` (à gauche) n'est
 * jamais affiché : seul son côté droit compte.
 */
function literalTexts(node) {
  if (!node) return [];
  switch (node.type) {
    case "Literal":
      return typeof node.value === "string" ? [node.value] : [];
    case "TemplateLiteral":
      return node.quasis.map((quasi) => quasi.value.cooked ?? "");
    case "JSXExpressionContainer":
      return literalTexts(node.expression);
    case "ConditionalExpression":
      return [...literalTexts(node.consequent), ...literalTexts(node.alternate)];
    case "LogicalExpression":
      return node.operator === "&&" ? literalTexts(node.right) : [...literalTexts(node.left), ...literalTexts(node.right)];
    case "BinaryExpression":
      return node.operator === "+" ? [...literalTexts(node.left), ...literalTexts(node.right)] : [];
    default:
      return [];
  }
}

const hasLetter = (texts) => texts.some((text) => LETTER.test(text));

module.exports = {
  meta: {
    type: "problem",
    docs: { description: "Interdit le texte d'interface écrit en dur dans un dossier traduit." },
    schema: [],
    messages: {
      jsxText: "Texte d'interface en dur : passer par une clé de traduction (docs/features/I18N.md).",
      attribute: "Attribut « {{name}} » en dur : passer par une clé de traduction (docs/features/I18N.md).",
    },
  },
  create(context) {
    return {
      JSXText(node) {
        if (LETTER.test(node.value)) context.report({ node, messageId: "jsxText" });
      },
      JSXExpressionContainer(node) {
        // `<p>{"Bonjour"}</p>` : un littéral déguisé en expression.
        if (node.parent && node.parent.type === "JSXAttribute") return;
        if (hasLetter(literalTexts(node.expression))) context.report({ node, messageId: "jsxText" });
      },
      JSXAttribute(node) {
        const name = node.name.type === "JSXIdentifier" ? node.name.name : null;
        if (!name || !UI_ATTRIBUTES.has(name)) return;
        if (hasLetter(literalTexts(node.value))) context.report({ node, messageId: "attribute", data: { name } });
      },
    };
  },
};
