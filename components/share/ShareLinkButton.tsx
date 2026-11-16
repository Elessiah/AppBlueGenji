"use client";

import { Share2 } from "lucide-react";
import { CyberButton } from "@/components/cyber/CyberButton";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { useToast } from "@/components/ui/toast";
import { absoluteShareUrl, shareLink } from "@/lib/shared/share-link";
import { visibleText } from "@/lib/shared/visible-text";

/**
 * Bouton « Partager » d'un tournoi ou d'un match (`docs/features/SHARE_EMBEDS.md`).
 *
 * Il partage toujours l'adresse **publique** (`/suivre/…`), qui s'ouvre sans
 * compte et porte l'aperçu riche — jamais celle de l'espace membre, qu'un
 * destinataire sans session verrait renvoyée vers la connexion. Feuille de
 * partage du système quand le navigateur en a une, sinon copie du lien ; le
 * résultat se dit en notification (`useToast`), jamais en ligne.
 *
 * @param path Chemin public sans préfixe de langue (`/suivre/tournois/12`).
 * @param label Texte visible (« Partager ») ; `ariaLabel` le contient.
 */
export function ShareLinkButton({
  path,
  title,
  label,
  ariaLabel,
  compact = false,
}: Readonly<{ path: string; title?: string; label: string; ariaLabel: string; compact?: boolean }>) {
  // La langue de la fiche : le lien partagé reste dans la langue lue (`/en/suivre/…`).
  const { t, locale } = useTournamentPageText();
  const { showError, showSuccess } = useToast();

  const onClick = async () => {
    const url = absoluteShareUrl(window.location.origin, path, locale);
    // Le titre est un nom saisi : nettoyé avant la feuille de partage (`UNTRUSTED_NAMES.md`).
    const shownTitle = title === undefined ? undefined : visibleText(title) || undefined;
    const outcome = await shareLink(typeof navigator === "undefined" ? undefined : navigator, url, shownTitle);
    if (outcome === "shared") showSuccess(t("shareLink.shared"));
    else if (outcome === "copied") showSuccess(t("shareLink.copied"));
    else if (outcome === "failed") showError(t("shareLink.copyFailed"));
  };

  return (
    <CyberButton
      variant="ghost"
      onClick={() => void onClick()}
      aria-label={ariaLabel}
      style={compact ? { fontSize: 12, padding: "6px 12px" } : { fontSize: 13, padding: "8px 18px" }}
    >
      <Share2 size={compact ? 13 : 14} aria-hidden="true" /> {label}
    </CyberButton>
  );
}
