import type { ReactNode } from "react";
import { GETI_OFFICIAL_INVITE_URL, GETI_OFFICIAL_SERVER_NAME } from "@/lib/shared/geti/page";
import { getiText, type GetiMessages } from "@/lib/shared/geti/page-text";
import type { Locale } from "@/lib/shared/locales";
import styles from "./geti.module.css";

/** Texte de la carte : importable côté client (la fenêtre « Publier » en reprend le surtitre et le bouton). */
export type OfficialText = GetiMessages["official"];

/**
 * Carte du serveur Discord officiel de GETI, en tête de chaque catégorie
 * (`docs/features/GETI_INFO.md` § Page). La fenêtre « Publier » n'en reprend
 * que le texte, dans le cadre de sa seconde option.
 *
 * **Notre** carte, pas le widget de Discord : la politique de sécurité du site
 * interdit tout cadre (`frame-src 'none'`), et aucune image n'est chargée de
 * chez Discord — l'emblème est un simple monogramme.
 */
export function GetiOfficialCard({
  text,
  locale,
  count = null,
}: Readonly<{
  text: OfficialText;
  locale: Locale;
  /** Fréquentation, rendue à part (elle peut arriver après la carte). */
  count?: ReactNode;
}>) {
  return (
    <section className={styles.official} aria-label={text.regionLabel}>
      <span className={styles.officialLogo} aria-hidden="true">
        {GETI_OFFICIAL_SERVER_NAME.charAt(0)}
      </span>
      <div className={styles.officialBody}>
        <span className={styles.officialEyebrow}>{text.eyebrow}</span>
        <h2 className={styles.officialName}>{GETI_OFFICIAL_SERVER_NAME}</h2>
        <p className={styles.officialLine}>{text.line}</p>
        {count}
      </div>
      <a
        className={styles.officialJoin}
        href={GETI_OFFICIAL_INVITE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={getiText(locale, text.joinLabel, { server: GETI_OFFICIAL_SERVER_NAME })}
      >
        {text.join}
      </a>
    </section>
  );
}
