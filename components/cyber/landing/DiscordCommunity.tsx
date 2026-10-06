import Image from "next/image";
import { DISCORD_INVITE_URL, type DiscordCommunityStats } from "@/lib/shared/discord";
import { useLandingText } from "@/components/i18n/landing-text";
import { LANDING_INTL_LOCALE } from "@/lib/shared/landing-text";
import styles from "./DiscordCommunity.module.css";

type DiscordCommunityProps = {
  /** Fréquentation du serveur, ou `null` si Discord n'a pas répondu. */
  stats: DiscordCommunityStats | null;
};

/**
 * Le Discord, en bout de ligne des chiffres du site.
 *
 * **Le bloc entier est le lien.** Pas un chiffre à côté d'un bouton : deux
 * cibles voisines qui mènent au même endroit, dont une minuscule, c'est une
 * cible ratée sur mobile. Ici toute la barre se clique, et le libellé
 * « Rejoindre le Discord » lui donne son affordance de bouton — d'où un `<span>`
 * et non un `<button>` ou un second `<a>`, imbriquer l'un ou l'autre dans une
 * ancre étant interdit (et, pour l'ancre, une casse d'hydratation).
 *
 * Aucun `aria-label` : le nom accessible se compose du texte visible, qui
 * contient déjà « Rejoindre le Discord ». Un libellé posé à la main **remplace**
 * ce texte et la commande vocale ne répond alors plus à ce qu'on lit sur le
 * lien (WCAG 2.5.3) — le piège que la vitrine a déjà payé deux fois.
 *
 * Sans chiffre, la barre **reste** : le bouton est la raison d'être du bloc, le
 * compteur n'en est que l'argument. Un Discord injoignable retire l'argument,
 * pas l'invitation.
 */
export function DiscordCommunity({ stats }: Readonly<DiscordCommunityProps>) {
  const { t, locale } = useLandingText();
  const tag = LANDING_INTL_LOCALE[locale];
  return (
    <a
      className={styles.root}
      href={DISCORD_INVITE_URL}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className={styles.mark} aria-hidden="true">
        {/* Décoratif : le mot « Discord » est écrit juste à côté, le répéter en
            `alt` le ferait annoncer deux fois. */}
        <Image src="/discord-white-icon.webp" alt="" width={22} height={22} />
      </span>

      <span className={styles.body}>
        {stats ? (
          <>
            <span className={`num ${styles.count}`}>{stats.memberCount.toLocaleString(tag)}</span>
            <span className={`mono ${styles.label}`}>{t("discord.members")}</span>
            {/* La présence n'est affichée que si Discord l'a donnée : « 0 en
                ligne » sur un serveur actif serait un contresens, et le champ
                peut manquer là où le total ne manque pas. */}
            {stats.onlineCount > 0 && (
              <span className={styles.presence}>
                <span className={styles.dot} aria-hidden="true" />
                {t("discord.online", { count: stats.onlineCount.toLocaleString(tag) })}
              </span>
            )}
          </>
        ) : (
          <>
            <span className={styles.fallbackTitle}>{t("discord.fallbackTitle")}</span>
            <span className={`mono ${styles.label}`}>{t("discord.fallbackLabel")}</span>
          </>
        )}
      </span>

      <span className={styles.cta}>
        {t("common.joinDiscord")}
        {/* NOSONAR S6772 — bouton en flex avec `gap` */}
        <span aria-hidden="true">→</span>
        <span className="sr-only">{` ${t("common.newTab")}`}</span>
      </span>
    </a>
  );
}
