import { MATCH_LAUNCH_REFRESH_EVENT } from "@/lib/shared/match-launch";
import type { TournamentDetail } from "@/lib/shared/types";
import { isPersonalAlert, viewerAlert, viewerLaunchChanged, type ViewerAlert } from "@/lib/shared/viewer-alerts";
import { raiseAttention } from "./attention";
import { playAlertChime } from "./sounds";

/**
 * Annonce au lecteur ce qu'un nouvel instantané change pour lui
 * (`docs/features/REALTIME_REFRESH.md`).
 *
 * Appelé sur ce qui est **reçu**, pas sur ce qui est rendu : l'annonce part
 * même quand rien n'est redessiné — c'est justement quand le lecteur ne regarde
 * pas qu'elle sert. `alertLabel` : l'évènement dans la langue de la page, pour
 * le titre d'onglet (qui ne peut pas porter `lang`).
 */
export function announceViewerChanges(
  previous: TournamentDetail | null,
  next: TournamentDetail,
  alertLabel?: (alert: ViewerAlert) => string,
): void {
  const alert = viewerAlert(previous, next);
  if (alert) {
    if (isPersonalAlert(alert)) playAlertChime(alert);
    raiseAttention(alert, alertLabel?.(alert));
  }
  // La modale de lancement ne vit que de sa propre interrogation : on lui
  // signale ce que le flux vient d'apprendre sur une rencontre du lecteur
  // (lobby, « Prêt », lancement), plutôt que de la laisser le découvrir
  // jusqu'à une minute plus tard. Elle regroupe ces signaux.
  if (viewerLaunchChanged(previous, next)) {
    window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
  }
}
