"use client";

import { useToast } from "@/components/ui/toast";
import { useActionsText } from "./actions-text";
import { useMapError } from "./error-map";
import { requestJson } from "./request-json";
import type { BusyRun } from "@/lib/shared/hooks/useBusyGuard";

/**
 * Ouvre ou coupe l'antenne d'un match en mode manuel
 * (`POST /api/admin/matches/[id]/live`), pour les deux fenêtres qui la portent
 * (« Configurer ma diffusion », diffusion du staff) : un seul appel, les mêmes
 * toasts et la même lecture des refus (`useMapError` :
 * `LIVE_TRIGGER_NOT_MANUAL`, `MATCH_NOT_LIVE_READY`, `LIVE_TRIGGER_NOT_OWNED`…).
 *
 * `run` est la garde d'envoi de la fenêtre (`useBusyGuard`) : l'antenne et
 * l'enregistrement partagent le même drapeau, un geste lancé pendant l'autre
 * (ou un double clic avant le rendu) est ignoré ; `onDone` relit le match.
 */
export function useOnAirToggle(
  matchId: number,
  onAir: boolean,
  { run, onDone }: { run: BusyRun; onDone: () => void },
): () => Promise<void> {
  const { showError, showSuccess } = useToast();
  const mapError = useMapError();
  const { t } = useActionsText();
  return async () => {
    await run(async () => {
      try {
        await requestJson(
          `/api/admin/matches/${matchId}/live`,
          { method: "POST", body: { onAir: !onAir } },
          "MATCH_LIVE_UPDATE_FAILED",
        );
        showSuccess(onAir ? t("cardActions.airClosed") : t("cardActions.airOpened"));
        onDone();
      } catch (error) {
        showError(mapError((error as Error).message));
      }
    });
  };
}
