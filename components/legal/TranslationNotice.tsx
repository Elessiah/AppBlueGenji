import { FRENCH_VERSION_PREVAILS } from "@/lib/shared/french-version-prevails";
import styles from "./TranslationNotice.module.css";

/**
 * « The French version prevails » (D1, lot 7b) : en tête de chaque page légale
 * **anglaise**, jamais d'une française — le texte français, seul à faire foi,
 * ne dit rien de sa traduction.
 *
 * Le lien mène à la même page en français : une navigation complète (`<a>`
 * nu), qui change de langue (`docs/features/I18N.md` § Liens et navigation).
 */
export function TranslationNotice({ frenchHref }: Readonly<{ frenchHref: string }>) {
  return (
    <div role="note" className={styles.notice} data-translation-notice="">
      <strong className={styles.title}>{FRENCH_VERSION_PREVAILS.title}</strong>
      <p>
        {FRENCH_VERSION_PREVAILS.body}{" "}
        <a href={frenchHref} hrefLang="fr">
          {FRENCH_VERSION_PREVAILS.link}
        </a>
        {/* NOSONAR S6772 — le point suit le lien sans espace */}
        .
      </p>
    </div>
  );
}
