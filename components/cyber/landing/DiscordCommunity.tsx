import Image from "next/image";
import { DISCORD_INVITE_URL, type DiscordCommunityStats } from "@/lib/shared/discord";
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
export function DiscordCommunity({ stats }: DiscordCommunityProps) {
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
            <span className={`num ${styles.count}`}>{stats.memberCount.toLocaleString("fr-FR")}</span>
            <span className={`mono ${styles.label}`}>Membres Discord</span>
            {/* La présence n'est affichée que si Discord l'a donnée : « 0 en
                ligne » sur un serveur actif serait un contresens, et le champ
                peut manquer là où le total ne manque pas. */}
            {stats.onlineCount > 0 && (
              <span className={styles.presence}>
                <span className={styles.dot} aria-hidden="true" />
                {stats.onlineCount.toLocaleString("fr-FR")} en ligne
              </span>
            )}
          </>
        ) : (
          <>
            <span className={styles.fallbackTitle}>Communauté BlueGenji</span>
            <span className={`mono ${styles.label}`}>Annonces, équipes, salons de jeu</span>
          </>
        )}
      </span>

      <span className={styles.cta}>
        Rejoindre le Discord
        <span aria-hidden="true">→</span>
        <span className="sr-only"> (nouvel onglet)</span>
      </span>
    </a>
  );
}
