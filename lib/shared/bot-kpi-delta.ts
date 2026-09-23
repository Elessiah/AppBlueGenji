/**
 * La pastille de variation d'une tuile de chiffres de `/bot`.
 *
 * Elle était écrite **en dur** : `className="kpi-delta up"` et un `▲` littéral,
 * quelle que soit la valeur reçue. Or `BotKpiEntry.delta` est une chaîne libre
 * venue du bot : une baisse annoncée `-8 %` sortait en vert, flèche vers le
 * haut, « ▲ -8 % ». Une pastille qui dit l'inverse de son texte est pire qu'une
 * pastille absente — c'est la couleur qu'on lit en premier, pas le signe.
 *
 * `app/bot/bot.css` portait d'ailleurs déjà `.kpi-delta.down` sans que rien ne
 * la référence : l'intention existait, il manquait la règle qui la choisit.
 *
 * Elle vit ici, pure, pour la raison qui vaut pour `bot-relay-status.ts` et
 * `bot-status-summary.ts` : elle se teste sans rendu, et elle doit nommer ce
 * qu'elle ne connaît pas — `fetchBotKpis` fait un simple `as BotKpis` sur du
 * JSON reçu par le réseau.
 */

import { botPayloadText } from "@/lib/shared/bot-payload";

export interface BotKpiDelta {
  /** Le texte à afficher — jamais vide, jamais un objet. */
  label: string;
  /** Suffixe de classe CSS : toujours l'une de ces trois valeurs. */
  tone: "up" | "down" | "flat";
  /** Le glyphe posé devant le texte, ou `""` quand le sens n'est pas su. */
  glyph: string;
}

/** Ce qu'affiche une tuile dont le bot n'a rien dit de lisible. */
const UNKNOWN_DELTA: BotKpiDelta = { label: "—", tone: "flat", glyph: "" };

/**
 * Les deux écritures du moins : le signe ASCII, et le **signe moins Unicode**
 * (U+2212) que produisent les formateurs de nombres — `Intl.NumberFormat` en
 * français rend `-8` par `−8`. Les confondre ferait passer la moitié des
 * baisses pour des hausses, selon la façon dont le bot a formaté sa chaîne.
 */
const MINUS_SIGNS = ["-", "−"];

/**
 * Le sens d'une variation — **lu sur un signe explicite, et sur rien d'autre**.
 *
 * Un `12 %` sans signe ne devient pas une hausse : c'est précisément la
 * supposition qui fabriquait le défaut qu'on retire. Sans signe, la pastille
 * porte le texte et reste neutre — le bot n'a pas dit dans quel sens, la page
 * ne le décide pas à sa place. Le jour où le bot enverra des variations
 * signées, elles seront colorées ; d'ici là, rien n'est affirmé.
 */
export function resolveBotKpiDelta(value: unknown): BotKpiDelta {
  const text = botPayloadText(value)?.trim();
  if (!text) return UNKNOWN_DELTA;

  if (MINUS_SIGNS.some((sign) => text.startsWith(sign))) {
    return { label: text, tone: "down", glyph: "▼" };
  }
  if (text.startsWith("+")) {
    return { label: text, tone: "up", glyph: "▲" };
  }
  return { label: text, tone: "flat", glyph: "" };
}

/**
 * Nom accessible de la pastille : **le texte visible d'abord** (WCAG 2.5.3),
 * puis ce que la flèche veut dire.
 *
 * La flèche et la couleur sont un dessin — elles ne se lisent ni au lecteur
 * d'écran ni en nuances de gris. Le sens qu'elles portent doit donc être dit,
 * et il ne l'est qu'une fois : une pastille neutre n'ajoute rien, puisqu'elle
 * n'affirme rien.
 */
export function botKpiDeltaAccessibleLabel(delta: BotKpiDelta, metric: string): string {
  if (delta.tone === "flat") return `${metric} : ${delta.label}`;
  const direction = delta.tone === "up" ? "en hausse" : "en baisse";
  return `${metric} : ${delta.label}, ${direction}`;
}
