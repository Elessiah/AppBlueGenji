import { Fragment } from "react";
import { EmphasisText } from "@/components/rules/EmphasisText";

/** A French name quoted in an English legal sentence: « … », guillemets included. */
const FRENCH_QUOTE = /(« [^«»]+ »)/;

/**
 * Renders an English legal sentence (lot 7b) whose French names — a category of
 * the report form, « Autre », « Contestation », « RGPD » — are quoted between
 * guillemets: each quotation is marked `lang="fr"` (WCAG 3.1.2), so a screen
 * reader does not read it as English. The rest keeps the `**bold**` emphasis.
 *
 * In these English constants, guillemets are reserved for French quotations
 * (English quotations use “ ”): the convention is checked by the tests.
 */
export function EnglishLegalText({ text }: Readonly<{ text: string }>) {
  return (
    <>
      {text.split(FRENCH_QUOTE).map((part, index) => (
        <Fragment key={index} /* NOSONAR S6479 — segments dérivés d'un texte immuable */>
          {FRENCH_QUOTE.test(part) ? <span lang="fr">{part}</span> : <EmphasisText text={part} />}
        </Fragment>
      ))}
    </>
  );
}
