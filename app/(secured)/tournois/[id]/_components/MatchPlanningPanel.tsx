"use client";

import { useMemo, useState } from "react";
import { useToast } from "@/components/ui/toast";
import {
  canToggleRefereeScheduling,
  matchesToPlan,
  REFEREE_SCHEDULING_DESCRIPTION,
  refereeSchedulingErrorMessage,
  toPlanCountLabel,
} from "@/lib/shared/match-planning";
import type { BracketMatch, TournamentDetail } from "@/lib/shared/types";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import styles from "./MatchPlanningPanel.module.css";

interface MatchPlanningPanelProps {
  detail: TournamentDetail;
  /** Ouvre la date de début d'un match (dialogue de programmation). */
  onPlan: (match: BracketMatch) => void;
  /** Le suivi est arrêté : aucune action n'est offerte sur un plateau figé. */
  frozen: boolean;
}

/**
 * Planification des matchs par l'arbitrage (`lib/shared/match-planning.ts`).
 *
 * Deux publics :
 * - **tous** les lecteurs, option allumée : la règle est annoncée, pour qu'un
 *   engagé qui voit son match « À planifier » sache qu'il attend l'arbitrage et
 *   non un geste de sa part ;
 * - l'arbitrage (`tournaments`) : l'interrupteur, jusqu'à la clôture — tournoi
 *   en cours compris —, le nombre de matchs qui attendent une date, et un
 *   bouton qui ouvre la date du premier d'entre eux (dans l'ordre du plateau).
 *
 * L'allumage en cours de tournoi passe par une confirmation : il défait le
 * lancement des matchs non lancés et sans date, qui repassent à planifier.
 */
export function MatchPlanningPanel({ detail, onPlan, frozen }: MatchPlanningPanelProps) {
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const enabled = detail.card.refereeScheduling;
  const canManage = detail.isAdmin && !frozen;
  const toggleable = canManage && canToggleRefereeScheduling(detail.card.state);

  // Ce que l'allumage ferait passer « à planifier », et ce qui l'est déjà :
  // la même fonction, lue avec l'option allumée.
  // Rien n'est calculé pour un panneau qui ne rendra rien — le cas de la
  // plupart des lecteurs, sur la plupart des tournois.
  const visible = enabled || toggleable;
  const toPlan = useMemo(
    () => (visible ? matchesToPlan(detail.matches ?? [], true) : []),
    [visible, detail.matches],
  );

  if (!visible) return null;

  // Ce que l'allumage renverra **réellement** à planifier : un match déjà noté
  // par l'arbitrage est tenu pour lancé par le serveur (`setRefereeScheduling`),
  // il n'a pas sa place dans la confirmation.
  const moving = toPlan.filter((match) => match.team1Score === null && match.team2Score === null);

  const toggle = async (next: boolean): Promise<boolean> => {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/tournaments/${detail.card.id}/referee-scheduling`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        movedToPlanning?: number;
      };
      if (!response.ok) throw new Error(payload.error || "UNKNOWN");
      showSuccess(
        next
          ? payload.movedToPlanning
            ? `Planification activée : ${toPlanCountLabel(payload.movedToPlanning)}.`
            : "Planification par l'arbitrage activée."
          : "Planification par l'arbitrage désactivée : les matchs sans date entrent en lancement.",
      );
      return true;
    } catch (error) {
      showError(refereeSchedulingErrorMessage((error as Error).message));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onToggle = () => {
    // En cours, l'allumage défait des lancements : il se confirme. Avant le
    // coup d'envoi il n'y a aucun match, rien à défaire.
    if (!enabled && detail.card.state === "RUNNING" && moving.length > 0) {
      setConfirmEnable(true);
      return;
    }
    void toggle(!enabled);
  };

  const pending = enabled ? toPlan : [];
  const first = pending[0] ?? null;

  return (
    <section
      className={styles.panel}
      data-active={enabled && pending.length > 0 ? "true" : "false"}
      aria-labelledby="match-planning-title"
    >
      <div className={styles.text}>
        <h2 id="match-planning-title" className={styles.title}>
          <span aria-hidden="true">🗓 </span>
          {enabled ? "Matchs planifiés par l'arbitrage" : "Planification des matchs"}
        </h2>
        <p className={styles.description}>
          {enabled
            ? REFEREE_SCHEDULING_DESCRIPTION
            : "Désactivée : un match sans date entre en lancement dès que ses deux engagés sont connus."}
        </p>
        {/* Le décompte n'intéresse que ceux qui peuvent le résorber. Pas de
            région live : il change à chaque instantané du flux. */}
        {enabled && canManage && detail.card.state === "RUNNING" && (
          pending.length > 0 ? (
            <p className={styles.pending}>{toPlanCountLabel(pending.length)}</p>
          ) : (
            <p className={styles.done}>Tous les matchs jouables ont une date.</p>
          )
        )}
      </div>

      {canManage && (
        <div className={styles.actions}>
          {enabled && first && (
            <button
              type="button"
              className={`btn tap-target ${styles.plan}`}
              onClick={() => onPlan(first)}
              aria-label={`Planifier le prochain match : ${first.team1Name ?? "TBD"} contre ${first.team2Name ?? "TBD"}`}
            >
              🗓 Planifier le prochain
            </button>
          )}
          {toggleable && (
            <button
              type="button"
              className={`btn ghost tap-target ${styles.toggle}`}
              onClick={onToggle}
              disabled={busy}
            >
              {busy ? "…" : enabled ? "Désactiver la planification" : "Activer la planification"}
            </button>
          )}
        </div>
      )}

      {confirmEnable && !enabled && (
        <ConfirmActionDialog
          title="Activer la planification par l'arbitrage ?"
          confirmLabel="Activer"
          pendingLabel="Activation…"
          tone="primary"
          onClose={() => setConfirmEnable(false)}
          onConfirm={() => toggle(true)}
        >
          <p>
            {moving.length === 1
              ? "1 match, sans date et pas encore lancé, quitte le lancement — ses « Prêt » sont effacés — et attend qu'un arbitre fixe son horaire."
              : `${moving.length} matchs, sans date et pas encore lancés, quittent le lancement — leurs « Prêt » sont effacés — et attendent qu'un arbitre fixe leur horaire.`}{" "}
            Les matchs déjà lancés continuent, et les manches suivantes naîtront à planifier.
          </p>
        </ConfirmActionDialog>
      )}
    </section>
  );
}
