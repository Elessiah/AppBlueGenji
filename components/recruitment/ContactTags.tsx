"use client";

import { useRecruitmentText } from "@/components/i18n/recruitment-text";
import { useToast } from "@/components/ui/toast";
import type { RecruitmentAd } from "@/lib/shared/recruitment";
import { CopyGlyph, DiscordGlyph, OpenGlyph } from "./glyphs";
import styles from "./ContactTags.module.css";

interface ContactTagsProps {
  ad: RecruitmentAd;
}

// Un contact Discord fourni sous forme d'URL (invitation, lien profil) devient un
// lien ; sinon c'est un pseudo à copier.
function isUrl(value: string): boolean {
  return /^(https?:\/\/|discord\.gg\/)/i.test(value.trim());
}

// Normalise une URL Discord/lien pour l'attribut href (préfixe le schéma si absent).
function toHref(value: string): string {
  const v = value.trim();
  return v.startsWith("http") ? v : `https://${v}`;
}

/**
 * Tags de contact d'une annonce (pseudo Discord copiable ou lien d'invitation,
 * plus le deep-link « Ouvrir » quand l'ID Discord est connu). Partagés par la
 * carte de la liste et la modale de lecture, pour que les deux vues proposent
 * exactement les mêmes canaux — et le même canal mis en avant.
 *
 * Ne rend rien si l'annonce n'expose aucun contact Discord.
 */
export function ContactTags({ ad }: Readonly<ContactTagsProps>) {
  const { showError, showSuccess } = useToast();
  const { t } = useRecruitmentText();

  if (!ad.contactDiscord && !ad.contactDiscordId) return null;

  // Copie une valeur dans le presse-papiers. Toast de confirmation, jamais inline.
  async function copyContact(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      showSuccess(t("contact.copied", { value }));
    } catch {
      showError(t("contact.copyFailed"));
    }
  }

  const primary = ad.contactPreferred === "DISCORD" ? styles.contactTagPrimary : "";

  return (
    // `group` : sans rôle, le nom « Contacts » serait interdit (`aria-prohibited-attr`).
    <fieldset className={`native-group ${styles.contactTags}`} aria-label={t("contact.label")}>
      {ad.contactDiscord &&
        (isUrl(ad.contactDiscord) ? (
          <a
            className={`${styles.contactTag} ${primary}`}
            href={toHref(ad.contactDiscord)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <DiscordGlyph className={styles.contactTagIcon} />
            <span className={styles.contactTagKey}>{t("contact.discord")}</span>
            <span className={styles.contactTagVal}>{t("contact.join")}</span>
            <OpenGlyph className={styles.contactTagIcon} />
          </a>
        ) : (
          <button
            type="button"
            className={`${styles.contactTag} ${primary}`}
            onClick={() => copyContact(ad.contactDiscord!)}
            title={t("contact.copyTitle")}
          >
            <DiscordGlyph className={styles.contactTagIcon} />
            <span className={styles.contactTagKey}>{t("contact.discord")}</span>
            <span className={styles.contactTagVal}>{ad.contactDiscord}</span>
            <CopyGlyph className={styles.contactTagIcon} />
          </button>
        ))}
      {ad.contactDiscordId && (
        <a
          className={styles.contactTag}
          href={`https://discord.com/users/${ad.contactDiscordId}`}
          target="_blank"
          rel="noopener noreferrer"
          title={t("contact.openTitle")}
        >
          <DiscordGlyph className={styles.contactTagIcon} />
          <span className={styles.contactTagVal}>{t("contact.open")}</span>
          <OpenGlyph className={styles.contactTagIcon} />
        </a>
      )}
    </fieldset>
  );
}
