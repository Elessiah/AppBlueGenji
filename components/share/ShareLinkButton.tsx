"use client";

import { useCallback } from "react";
import { Share2 } from "lucide-react";
import { CyberButton } from "@/components/cyber/CyberButton";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { useToast } from "@/components/ui/toast";
import { absoluteShareUrl, shareLink } from "@/lib/shared/share-link";
import { visibleText } from "@/lib/shared/visible-text";

/**
 * Le geste « Partager » (`docs/features/SHARE_EMBEDS.md`), commun au bouton
 * d'un tournoi et à l'action d'un match : l'adresse **publique** absolue dans
 * la langue de la fiche (`/en/suivre/…` en anglais), la feuille de partage du
 * système, sinon la copie, et le résultat en notification (`useToast`).
 *
 * @returns `share(path, title?)` — `path` : chemin public sans préfixe de
 *   langue ; `title` : nom saisi, nettoyé avant la feuille de partage
 *   (`UNTRUSTED_NAMES.md`).
 */
export function useShareLink(): (path: string, title?: string) => Promise<void> {
  // La langue de la fiche : le lien partagé reste dans la langue lue.
  const { t, locale } = useTournamentPageText();
  const { showError, showSuccess } = useToast();
  // Une seule fonction tant que la langue et les notifications ne changent
  // pas : la carte d'un match se redessine à chaque mise à jour du flux.
  return useCallback(
    async (path: string, title?: string) => {
      const url = absoluteShareUrl(window.location.origin, path, locale);
      const shownTitle = title === undefined ? undefined : visibleText(title) || undefined;
      const outcome = await shareLink(typeof navigator === "undefined" ? undefined : navigator, url, shownTitle);
      if (outcome === "shared") showSuccess(t("shareLink.shared"));
      else if (outcome === "copied") showSuccess(t("shareLink.copied"));
      else if (outcome === "failed") showError(t("shareLink.copyFailed"));
    },
    [t, locale, showError, showSuccess],
  );
}

/**
 * Bouton « Partager » d'un tournoi (`docs/features/SHARE_EMBEDS.md`).
 *
 * Il partage toujours l'adresse **publique** (`/suivre/…`), qui s'ouvre sans
 * compte et porte l'aperçu riche — jamais celle de l'espace membre, qu'un
 * destinataire sans session verrait renvoyée vers la connexion.
 *
 * @param path Chemin public sans préfixe de langue (`/suivre/tournois/12`).
 * @param label Texte visible (« Partager ») ; `ariaLabel` le contient.
 */
export function ShareLinkButton({
  path,
  title,
  label,
  ariaLabel,
}: Readonly<{ path: string; title?: string; label: string; ariaLabel: string }>) {
  const share = useShareLink();
  return (
    <CyberButton
      variant="ghost"
      onClick={() => void share(path, title)}
      aria-label={ariaLabel}
      style={{ fontSize: 13, padding: "8px 18px" }}
    >
      <Share2 size={14} aria-hidden="true" /> {label}
    </CyberButton>
  );
}
