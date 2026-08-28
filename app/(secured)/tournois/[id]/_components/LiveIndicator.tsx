"use client";

import { Pill } from "@/components/cyber";
import { REFRESH_CADENCE, type RefreshTier } from "@/lib/shared/refresh-tiers";

type LiveIndicatorProps = {
  /** Le flux temps réel est-il établi ? */
  isLive: boolean;
  /** Palier de fraîcheur accordé par le serveur. */
  tier: RefreshTier;
};

function cadenceLabel(tier: RefreshTier): string {
  const seconds = Math.round(REFRESH_CADENCE[tier].pushCoalesceMs / 1000);
  if (seconds <= 1) return "à la seconde";
  if (seconds < 60) return `toutes les ${seconds} secondes au plus`;
  return `toutes les ${Math.round(seconds / 60)} minutes au plus`;
}

/**
 * Dit à quel point la page est à jour — et surtout, qu'il est inutile de la
 * recharger.
 *
 * C'est le pendant visible du travail fait en dessous : sans repère, on continue
 * d'appuyer sur F5 par précaution, même quand la donnée arrive toute seule. Le
 * texte annonce donc la cadence réelle du palier accordé, et l'état de repli
 * quand le flux est coupé plutôt qu'un silence qui laisserait douter.
 *
 * `role="status"` + `aria-live="polite"` : le changement d'état est annoncé aux
 * lecteurs d'écran sans interrompre la lecture en cours.
 */
export function LiveIndicator({ isLive, tier }: LiveIndicatorProps) {
  const label = isLive ? "Direct" : "Reconnexion…";
  const title = isLive
    ? `Mise à jour automatique ${cadenceLabel(tier)}. Inutile de recharger la page.`
    : "Connexion au direct interrompue. La page se reconnecte seule et continue de se mettre à jour, plus lentement.";

  return (
    <Pill
      variant={isLive ? "live" : "default"}
      role="status"
      aria-live="polite"
      aria-label={`${label}. ${title}`}
      title={title}
    >
      {label}
    </Pill>
  );
}
