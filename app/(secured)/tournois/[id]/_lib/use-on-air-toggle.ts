"use client";

import { useToast } from "@/components/ui/toast";
import { useActionsText } from "./actions-text";
import { useMapError } from "./error-map";

/**
 * Ouvre ou coupe l'antenne d'un match en mode manuel
 * (`POST /api/admin/matches/[id]/live`), pour les deux fenêtres qui la portent
 * (« Configurer ma diffusion », diffusion du staff) : un seul appel, les mêmes
 * toasts et la même lecture des refus (`useMapError` :
 * `LIVE_TRIGGER_NOT_MANUAL`, `MATCH_NOT_LIVE_READY`, `LIVE_TRIGGER_NOT_OWNED`…).
 *
 * `setBusy` verrouille la fenêtre pendant l'envoi ; `onDone` relit le match.
 */
export function useOnAirToggle(
  matchId: number,
  onAir: boolean,
  { setBusy, onDone }: { setBusy: (busy: boolean) => void; onDone: () => void },
): () => Promise<void> {
  const { showError, showSuccess } = useToast();
  const mapError = useMapError();
  const { t } = useActionsText();
  return async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/matches/${matchId}/live`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ onAir: !onAir }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "MATCH_LIVE_UPDATE_FAILED");
      showSuccess(onAir ? t("cardActions.airClosed") : t("cardActions.airOpened"));
      onDone();
    } catch (error) {
      showError(mapError((error as Error).message));
    } finally {
      setBusy(false);
    }
  };
}
