/**
 * « The French version prevails » (D1, lot 7b) — **English only**.
 *
 * The site's legal texts are written in French, and the French text alone
 * prevails; their English pages are translations and say so. These sentences
 * have no French counterpart on purpose: a French page never mentions its
 * translation, and the French legal text must stay exactly as accepted
 * (`TERMS_VERSION`). Kept apart from the translated texts so that the terms
 * popups can import them without the rest — the popup mounted on every page
 * receives its note from the root layout, under `/en` only, so that French
 * pages do not load it.
 */

/** Notice at the top of every English legal page (`components/legal/TranslationNotice.tsx`). */
export const FRENCH_VERSION_PREVAILS = {
  title: "Translation provided for convenience",
  body: "This page is an English translation of the French original, provided for convenience. In case of any discrepancy between the two, the French version prevails.",
  link: "Read the French version",
} as const;

/**
 * Note under the terms checkbox of the English popups (login consent, terms
 * acceptance): accepting on `/en` accepts the French text, same version.
 */
export const TERMS_TRANSLATION_NOTE = {
  text: "The English terms are a translation provided for convenience: what you accept is the French text, which prevails in case of discrepancy.",
  link: "Read the French terms",
} as const;

/** Shape of `TERMS_TRANSLATION_NOTE`, for a client popup that receives it as a prop. */
export type TermsTranslationNote = typeof TERMS_TRANSLATION_NOTE;
