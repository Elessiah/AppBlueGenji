"use client";

import { Pill } from "@/components/cyber";
import { useSpectatorView } from "@/components/spectator-view";
import { SPECTATOR_NOT_FOUND_RECHECK_MINUTES } from "@/lib/shared/spectator-view";
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
  /**
   * Cadence de relecture, quand elle ne suit pas le palier : celle que le
   * serveur accorde à la page sans compte (`null` n'arrive qu'avec `fatal`).
   */
  cadenceMs?: number | null;
  /** Échec définitif : la page a cessé de réessayer. */
  fatal?: LiveFailure | null;
};

function cadenceLabel(text: TournamentPageText, cadenceMs: number): string {
  const seconds = Math.round(cadenceMs / 1000);
  if (seconds <= 1) return text.t("live.cadenceSecond");
  if (seconds < 60) return text.t("live.cadenceSeconds", { seconds: String(seconds) });
  // Arrondi vers le haut : la phrase promet un délai « au plus ».
  const minutes = Math.ceil(seconds / 60);
  if (minutes === 1) return text.t("live.cadenceMinute");
  return text.t("live.cadenceMinutes", { minutes });
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
export function LiveIndicator({ isLive, tier, cadenceMs, fatal = null }: Readonly<LiveIndicatorProps>) {
  // Témoin de flux (glossaire) : « À jour / Reconnexion… / Hors ligne » →
  // « Up to date / Reconnecting… / Offline ». L'état vient du flux, le texte
  // de la page : rien de localisé ne passe par l'instantané.
  const text = useTournamentPageText();
  const { t } = text;
  let label = t("live.reconnecting");
  // Page sans compte : pas de flux à rouvrir, une relecture qui réessaiera
  // plus tard.
  const spectator = useSpectatorView();
  let title = spectator ? t("live.retryTitle") : t("live.reconnectingTitle");
  if (fatal) {
    label = t("live.offline");
    // Sans compte, un introuvable est relu au plafond : rien n'est fini.
    title =
      spectator && fatal === "TOURNAMENT_NOT_FOUND"
        ? t("live.spectatorNotFoundTitle", { minutes: SPECTATOR_NOT_FOUND_RECHECK_MINUTES })
        : t(`live.fatal.${fatal}`);
  } else if (isLive) {
    label = t("live.upToDate");
    title = t("live.upToDateTitle", { cadence: cadenceLabel(text, cadenceMs ?? REFRESH_CADENCE[tier].pushCoalesceMs) });
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
