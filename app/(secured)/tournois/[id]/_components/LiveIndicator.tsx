"use client";

import { Pill } from "@/components/cyber";
import { REFRESH_CADENCE, type RefreshTier } from "@/lib/shared/refresh-tiers";
import type { LiveFailure } from "../_lib/live-state";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import type { TournamentPageText } from "@/lib/shared/tournament-page-text";

// Ce que l'on dit quand la page a cessé de réessayer (`live.fatal.*`) :
// réessayer indéfiniment laisserait « Reconnexion… » à l'écran pour
// l'éternité, sans jamais dire quoi faire.

type LiveIndicatorProps = {
  /** Le flux temps réel est-il établi ? */
  isLive: boolean;
  /** Palier de fraîcheur accordé par le serveur. */
  tier: RefreshTier;
  /** Échec définitif : la page a cessé de réessayer. */
  fatal?: LiveFailure | null;
};

function cadenceLabel(text: TournamentPageText, tier: RefreshTier): string {
  const seconds = Math.round(REFRESH_CADENCE[tier].pushCoalesceMs / 1000);
  if (seconds <= 1) return text.t("live.cadenceSecond");
  if (seconds < 60) return text.t("live.cadenceSeconds", { seconds: String(seconds) });
  return text.t("live.cadenceMinutes", { minutes: Math.round(seconds / 60) });
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
 * Ni « Direct » ni la pastille rouge : le témoin ne parle que de la **connexion
 * au flux SSE**, jamais d'une diffusion ni de l'état du tournoi. Il s'allume sur
 * toute page de tournoi, y compris un tournoi sans chaîne et sans match — le
 * voir dire « ● Direct » à côté du tag d'état « En cours » faisait croire à un
 * stream inexistant. Le rouge de `pill-live` reste réservé à ce qui est
 * réellement à l'antenne.
 *
 * `role="status"` + `aria-live="polite"` : le changement d'état est annoncé aux
 * lecteurs d'écran sans interrompre la lecture en cours. Le nom accessible
 * reste le texte visible — court, puisqu'il est relu à chaque bascule ; un
 * `aria-label` portant toute l'explication ferait réciter une phrase entière à
 * la moindre coupure réseau. L'explication vit dans `title`.
 */
export function LiveIndicator({ isLive, tier, fatal = null }: Readonly<LiveIndicatorProps>) {
  // Témoin de flux (glossaire) : « À jour / Reconnexion… / Hors ligne » →
  // « Up to date / Reconnecting… / Offline ». L'état vient du flux, le texte
  // de la page : rien de localisé ne passe par l'instantané.
  const text = useTournamentPageText();
  const { t } = text;
  let label = t("live.reconnecting");
  let title = t("live.reconnectingTitle");
  if (fatal) {
    label = t("live.offline");
    title = t(`live.fatal.${fatal}`);
  } else if (isLive) {
    label = t("live.upToDate");
    title = t("live.upToDateTitle", { cadence: cadenceLabel(text, tier) });
  }

  return (
    <Pill
      variant={isLive ? "blue" : "neutral"}
      role="status"
      aria-live="polite"
      title={title}
    >
      {label}
    </Pill>
  );
}
