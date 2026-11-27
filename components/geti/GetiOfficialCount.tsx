import { Users } from "lucide-react";
import { getGetiCommunity } from "@/lib/server/geti/community";
import { formatLocalNumber } from "@/lib/shared/dates";
import type { Locale } from "@/lib/shared/locales";
import { getiText } from "@/lib/shared/geti/page-text";
import type { OfficialText } from "./GetiOfficialCard";
import styles from "./geti.module.css";

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
