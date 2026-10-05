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
 *   `placeholder`, `alt`, `label`, `aria-description`, `aria-valuetext`),
 *   y compris dans `{"…"}` ou un gabarit sans interpolation.
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

function literalText(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node.type === "JSXExpressionContainer") return literalText(node.expression);
  return null;
}

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
        const text = literalText(node.expression);
        if (text !== null && LETTER.test(text)) context.report({ node, messageId: "jsxText" });
      },
      JSXAttribute(node) {
        const name = node.name.type === "JSXIdentifier" ? node.name.name : null;
        if (!name || !UI_ATTRIBUTES.has(name)) return;
        const text = literalText(node.value);
        if (text !== null && LETTER.test(text)) context.report({ node, messageId: "attribute", data: { name } });
      },
    };
  },
};
