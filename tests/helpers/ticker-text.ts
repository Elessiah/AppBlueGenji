import type { TickerItem, TickerResultSide } from "@/lib/shared/ticker-items";

/** Texte brut d'une entrée du bandeau : amorce, noms et scores, sans repères d'issue ni mots masqués. */
export function tickerItemText(item: TickerItem): string {
  if (typeof item === "string") return item;
  if (item.kind === "champion") return `${item.lead} ${item.name}`;
  const [left, right] = item.sides;
  const side = (s: TickerResultSide) => (s.score === null ? s.name : `${s.name} ${s.score}`);
  return `${item.lead} ${side(left)} — ${side(right)}`;
}
