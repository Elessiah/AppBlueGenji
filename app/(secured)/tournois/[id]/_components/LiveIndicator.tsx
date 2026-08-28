"use client";

import { Pill } from "@/components/cyber";
import { REFRESH_CADENCE, type RefreshTier } from "@/lib/shared/refresh-tiers";
import type { LiveFailure } from "../_lib/live-state";

/**
 * Ce que l'on dit quand la page a cessé de réessayer. Réessayer indéfiniment
 * laisserait « Reconnexion… » à l'écran pour l'éternité, sans jamais dire quoi
 * faire.
 */
const FATAL_TITLES: Record<LiveFailure, string> = {
  UNAUTHORIZED:
    "Ta session a expiré : le suivi en direct est arrêté. Reconnecte-toi pour le reprendre.",
  TOURNAMENT_NOT_FOUND: "Ce tournoi n'existe plus : il n'y a plus rien à suivre.",
};

type LiveIndicatorProps = {
  /** Le flux temps réel est-il établi ? */
  isLive: boolean;
  /** Palier de fraîcheur accordé par le serveur. */
  tier: RefreshTier;
  /** Échec définitif : la page a cessé de réessayer. */
  fatal?: LiveFailure | null;
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
 * lecteurs d'écran sans interrompre la lecture en cours. Le nom accessible
 * reste le texte visible — court, puisqu'il est relu à chaque bascule ; un
 * `aria-label` portant toute l'explication ferait réciter une phrase entière à
 * la moindre coupure réseau. L'explication vit dans `title`.
 */
export function LiveIndicator({ isLive, tier, fatal = null }: LiveIndicatorProps) {
  const label = fatal ? "Hors ligne" : isLive ? "Direct" : "Reconnexion…";
  const title = fatal
    ? FATAL_TITLES[fatal]
    : isLive
      ? `Mise à jour automatique ${cadenceLabel(tier)}. Inutile de recharger la page.`
      : "Connexion au direct interrompue. La page se reconnecte seule et continue de se mettre à jour, plus lentement.";

  return (
    <Pill
      variant={isLive ? "live" : "default"}
      role="status"
      aria-live="polite"
      title={title}
    >
      {label}
    </Pill>
  );
}
