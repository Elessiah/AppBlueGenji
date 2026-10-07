"use client";

import { useMemo, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { canToggleRefereeScheduling, matchesToPlan } from "@/lib/shared/match-planning";
import type { BracketMatch, TournamentDetail } from "@/lib/shared/types";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { refereeSchedulingErrorText, useActionsText } from "../_lib/actions-text";
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
export function MatchPlanningPanel({ detail, onPlan, frozen }: Readonly<MatchPlanningPanelProps>) {
  const text = useTournamentPageText();
  // Ce que lit tout lecteur (titre, règle) vient de la consultation (lot 8a) ;
  // le décompte et les commandes du staff, des gestes (lot 8b).
  const actionText = useActionsText();
  const a = actionText.t;
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const enabled = detail.card.refereeScheduling;
  const canManage = detail.isAdmin && !frozen;
  const toggleable = canManage && canToggleRefereeScheduling(detail.card.state);
  // Activé ailleurs, ou geste retiré (droit, plateau figé) entre-temps : la
  // confirmation en attente est oubliée, pour ne pas se rouvrir seule plus tard.
  if (confirmEnable && (enabled || !toggleable)) setConfirmEnable(false);

  // Ce que l'allumage ferait passer « à planifier », et ce qui l'est déjà :
  // la même fonction, lue avec l'option allumée. Rien n'est calculé pour un panneau qui ne rendra rien — le cas de la
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
      const moved = payload.movedToPlanning ?? 0;
      if (!next) showSuccess(a("planning.disabled"));
      else showSuccess(moved > 0 ? a("planning.enabledMoved", { count: moved }) : a("planning.enabled"));
      return true;
    } catch (error) {
      showError(refereeSchedulingErrorText(actionText, (error as Error).message));
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

  const toggleLabel = a(enabled ? "planning.disable" : "planning.enable");
  const pending = enabled ? toPlan : [];
  const first = pending[0] ?? null;
  // Le décompte n'intéresse que ceux qui peuvent le résorber.
  const showCount = enabled && canManage && detail.card.state === "RUNNING";

  return (
    <section
      className={styles.panel}
      data-active={enabled && pending.length > 0 ? "true" : "false"}
      aria-labelledby="match-planning-title"
    >
      <div className={styles.text}>
        <h2 id="match-planning-title" className={styles.title}>
          <span aria-hidden="true">🗓 </span>
          {enabled ? text.t("planning.titleOn") : text.t("planning.titleOff")}
        </h2>
        <p className={styles.description}>
          {enabled ? text.t("planning.descriptionOn") : text.t("planning.descriptionOff")}
        </p>
        {/* Le décompte n'intéresse que ceux qui peuvent le résorber. Pas de
            région live : il change à chaque instantané du flux. */}
        {showCount && pending.length > 0 && (
          <p className={styles.pending}>{a("planning.toPlanCount", { count: pending.length })}</p>
        )}
        {showCount && pending.length === 0 && (
          <p className={styles.done}>{a("planning.allPlanned")}</p>
        )}
      </div>

      {canManage && (
        <div className={styles.actions}>
          {enabled && first && (
            <button
              type="button"
              className={`btn tap-target ${styles.plan}`}
              onClick={() => onPlan(first)}
              aria-label={a("planning.planNextAria", { team1: first.team1Name ?? "TBD", team2: first.team2Name ?? "TBD" })}
            >
              🗓 {a("planning.planNext")}
            </button>
          )}
          {toggleable && (
            <button
              type="button"
              className={`btn ghost tap-target ${styles.toggle}`}
              onClick={onToggle}
              disabled={busy}
            >
              {busy ? "…" : toggleLabel}
            </button>
          )}
        </div>
      )}

      {confirmEnable && !enabled && (
        <ConfirmActionDialog
          title={a("planning.confirm.title")}
          confirmLabel={a("planning.confirm.confirm")}
          pendingLabel={a("planning.confirm.pending")}
          tone="primary"
          onClose={() => setConfirmEnable(false)}
          onConfirm={() => toggle(true)}
        >
          <p>
            {a("planning.confirm.consequence", { count: moving.length })}{" "}
            {a("planning.confirm.next")}
          </p>
        </ConfirmActionDialog>
      )}
    </section>
  );
}
