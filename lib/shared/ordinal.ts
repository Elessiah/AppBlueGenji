import { INTL_LOCALE, type Locale } from "@/lib/shared/locales";
import { cached } from "@/lib/shared/message-format";

/** Forme ordinale d'une langue : choisit la clé « 1st » / « 2nd » / « 3rd » / « 4th ». */
export type OrdinalForm = "one" | "two" | "few" | "other";

const rules = new Map<Locale, Intl.PluralRules>();

/**
 * Forme ordinale de `n` dans la langue (`Intl.PluralRules`, `ordinal`) : le
 * formateur réduit n'a pas de `selectordinal`, le message porte une clé par
 * forme. Le français ne connaît que `one` (« 1er ») et `other` (« 2e »).
 */
export function ordinalForm(locale: Locale, n: number): OrdinalForm {
  const form = cached(rules, locale, (l) => new Intl.PluralRules(INTL_LOCALE[l], { type: "ordinal" })).select(n);
  return form === "one" || form === "two" || form === "few" ? form : "other";
}

/**
 * Place finale d'un tournoi (« 1er » / « 1st »…) par la clé `<préfixe>.<forme>`
 * du texte ; `null` (tournoi en cours, classement non établi) rend un tiret.
 */
export function finalRankLabel(
  locale: Locale,
  rank: number | null,
  format: (form: OrdinalForm, rank: number) => string,
): string {
  if (rank === null || !Number.isInteger(rank) || rank < 1) return "—";
  return format(ordinalForm(locale, rank), rank);
}
