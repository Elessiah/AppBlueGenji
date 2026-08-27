"use client";

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
export function ContactTags({ ad }: ContactTagsProps) {
  const { showError, showSuccess } = useToast();

  if (!ad.contactDiscord && !ad.contactDiscordId) return null;

  // Copie une valeur dans le presse-papiers. Toast de confirmation, jamais inline.
  async function copyContact(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      showSuccess(`${label} copié : ${value}`);
    } catch {
      showError("Impossible de copier, copie manuellement.");
    }
  }

  const primary = ad.contactPreferred === "DISCORD" ? styles.contactTagPrimary : "";

  return (
    <div className={styles.contactTags} aria-label="Contacts">
      {ad.contactDiscord &&
        (isUrl(ad.contactDiscord) ? (
          <a
            className={`${styles.contactTag} ${primary}`}
            href={toHref(ad.contactDiscord)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <DiscordGlyph className={styles.contactTagIcon} />
            <span className={styles.contactTagKey}>Discord</span>
            <span className={styles.contactTagVal}>Rejoindre</span>
            <OpenGlyph className={styles.contactTagIcon} />
          </a>
        ) : (
          <button
            type="button"
            className={`${styles.contactTag} ${primary}`}
            onClick={() => copyContact(ad.contactDiscord!, "Pseudo Discord")}
            title="Copier le pseudo Discord"
          >
            <DiscordGlyph className={styles.contactTagIcon} />
            <span className={styles.contactTagKey}>Discord</span>
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
          title="Ouvrir la conversation Discord"
        >
          <DiscordGlyph className={styles.contactTagIcon} />
          <span className={styles.contactTagVal}>Ouvrir</span>
          <OpenGlyph className={styles.contactTagIcon} />
        </a>
      )}
    </div>
  );
}
