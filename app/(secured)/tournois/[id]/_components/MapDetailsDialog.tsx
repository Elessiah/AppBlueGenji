"use client";

import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import type { MatchMapResult } from "@/lib/shared/match-maps";
import dialogStyles from "./ScoreDialog.module.css";
import { MapResultList } from "./MapResultList";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";

/**
 * Modale du détail map par map d'un match tranché (`MatchMapDetails`). Chargée
 * à la demande, au premier clic sur le résumé : elle porte `ScoreDialog.module.css`
 * et les hooks de modale, que toute page de tournoi — spectateurs compris —
 * chargeait sinon d'emblée, alors que les dialogues de score qui partagent ce
 * CSS le sont déjà à la demande.
 */
export function MapDetailsDialog({
  matchId,
  maps,
  team1Name,
  team2Name,
  pointTarget = null,
  pointTargets = null,
  onClose,
}: Readonly<{
  matchId: number;
  maps: ReadonlyArray<MatchMapResult>;
  team1Name: string;
  team2Name: string;
  /** Points par carte du format Duel / Arcade (`null` = éteint). */
  pointTarget?: number | null;
  /** N effectif carte par carte (`BracketMatch.mapPointTargets`). */
  pointTargets?: ReadonlyArray<number> | null;
  onClose: () => void;
}>) {
  const dialogRef = useDialogBehavior({ open: true, onClose });
  const backdrop = useBackdropDismiss(onClose);
  const titleId = `map-details-${matchId}-title`;
  const { t } = useTournamentPageText();

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ className={dialogStyles.backdrop} role="presentation" {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        className={dialogStyles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={dialogStyles.head}>
          <div className={dialogStyles.headText}>
            <h3 id={titleId} className={dialogStyles.title}>
              {t("match.maps.title")}
            </h3>
            <p className={dialogStyles.opponents}>{t("match.maps.vs", { team1: team1Name, team2: team2Name })}</p>
          </div>
        </div>
        <MapResultList
          maps={maps}
          team1Name={team1Name}
          team2Name={team2Name}
          label={t("match.maps.listLabel")}
          pointTarget={pointTarget}
          pointTargets={pointTargets}
        />
        <div className={dialogStyles.actions}>
          <button type="button" className={`${dialogStyles.link} ${dialogStyles.close}`} onClick={onClose}>
            {t("match.maps.close")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
