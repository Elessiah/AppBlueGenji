import type { ReactNode } from "react";
import { Users } from "lucide-react";
import { getGetiCommunity } from "@/lib/server/geti/community";
import { GETI_OFFICIAL_INVITE_URL, GETI_OFFICIAL_SERVER_NAME } from "@/lib/shared/geti/page";
import { getiText, type GetiMessages } from "@/lib/shared/geti/page-text";
import { formatLocalNumber } from "@/lib/shared/dates";
import type { Locale } from "@/lib/shared/locales";
import styles from "./geti.module.css";

type OfficialText = GetiMessages["official"];

/**
 * Carte du serveur Discord officiel de GETI, en tête de chaque catégorie et
 * dans la fenêtre « Publier » (`docs/features/GETI_INFO.md` § Page).
 *
 * **Notre** carte, pas le widget de Discord : la politique de sécurité du site
 * interdit tout cadre (`frame-src 'none'`), et aucune image n'est chargée de
 * chez Discord — l'emblème est un simple monogramme.
 */
export function GetiOfficialCard({
  text,
  locale,
  count = null,
  headingLevel = 2,
}: Readonly<{
  text: OfficialText;
  locale: Locale;
  /** Fréquentation, rendue à part (elle peut arriver après la carte). */
  count?: ReactNode;
  headingLevel?: 2 | 3;
}>) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <aside className={styles.official} aria-label={text.regionLabel}>
      <span className={styles.officialLogo} aria-hidden="true">
        {GETI_OFFICIAL_SERVER_NAME.charAt(0)}
      </span>
      <div className={styles.officialBody}>
        <span className={styles.officialEyebrow}>{text.eyebrow}</span>
        <Heading className={styles.officialName}>{GETI_OFFICIAL_SERVER_NAME}</Heading>
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
    </aside>
  );
}

/** Fréquentation du serveur GETI ; rien si Discord ne la donne pas. */
export async function GetiOfficialCount({ text, locale }: Readonly<{ text: OfficialText; locale: Locale }>) {
  const stats = await getGetiCommunity();
  if (!stats) return null;
  return (
    <p className={styles.officialCount}>
      <Users size={13} aria-hidden="true" />
      <span>{getiText(locale, text.members, { count: stats.memberCount })}</span>
      {stats.onlineCount > 0 ? (
        <span className={styles.officialOnline}>
          {getiText(locale, text.online, { count: formatLocalNumber(stats.onlineCount, locale) })}
        </span>
      ) : null}
    </p>
  );
}
