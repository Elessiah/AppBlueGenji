"use client";

import { FormEvent, useState } from "react";
import { useToast } from "@/components/ui/toast";
import {
  MAX_ENDURANCE_PENALTY_POINTS,
  MAX_ENDURANCE_PENALTY_REASON,
  checkEndurancePenalty,
} from "@/lib/shared/endurance-penalty";
import { useMapError } from "../_lib/error-map";
import { useDialogsText } from "../_lib/dialogs-text";
import { TournamentDialogFrame } from "./TournamentDialogFrame";

interface EndurancePenaltyDialogProps {
  tournamentId: number;
  teamId: number;
  teamName: string;
  /** Capital de l'engagé avant la sanction, pour annoncer ce qu'elle laisse. */
  currentPoints: number;
  /** Manche à laquelle la sanction sera portée (0 = avant la première). */
  round: number;
  onClose: () => void;
  onApplied: () => void;
}

/**
 * Pénalité de points d'endurance infligée par l'arbitrage (mode « BlueGenji
 * Survie », `docs/features/ENDURANCE_PENALTIES.md`).
 *
 * Un dialogue et non un `window.confirm` : la sanction a deux paramètres et un
 * motif obligatoire, et elle peut éliminer — c'est justement ce que le dialogue
 * annonce avant le clic, en calculant le capital qui restera. La règle est
 * celle du module partagé, celui-là même que la route applique : l'interface
 * ne peut pas accepter ce que le serveur refusera.
 */
export function EndurancePenaltyDialog({
  tournamentId,
  teamId,
  teamName,
  currentPoints,
  round,
  onClose,
  onApplied,
}: Readonly<EndurancePenaltyDialogProps>) {
  const { showError, showSuccess } = useToast();
  const mapError = useMapError();
  const { t } = useDialogsText();
  const [points, setPoints] = useState("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const parsedPoints = Number(points);
  const violation = checkEndurancePenalty(parsedPoints, reason);

  // Ce qu'il restera : un capital nul **élimine**, comme une défaite qui le
  // viderait. Le dire avant le clic évite d'apprendre la sortie d'une équipe en
  // lisant le classement après coup.
  const remaining = Number.isFinite(parsedPoints)
    ? Math.max(0, currentPoints - Math.floor(parsedPoints))
    : currentPoints;
  const eliminates = violation === null && remaining === 0;

  // Une ligne d'aide, trois messages, dans l'ordre de ce qui bloque : le refus
  // en cours d'abord — le bouton étant désactivé tant qu'il y en a un, sans
  // cette phrase l'arbitre n'aurait rien à corriger et rien à lire —, puis la
  // conséquence quand elle surprend, puis le rappel de forme.
  // Les refus de forme sont ceux de la table des refus (mêmes codes que la route).
  let hint = t("penalty.hint", { remaining });
  if (violation !== null) hint = mapError(violation);
  else if (eliminates) hint = t("penalty.eliminates", { name: teamName });
  const hintIsWarning = violation !== null || eliminates;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (violation !== null) {
      showError(mapError(violation));
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/penalties`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId, points: Math.floor(parsedPoints), reason }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "PENALTY_FAILED");
      showSuccess(t("penalty.applied", { points: Math.floor(parsedPoints), name: teamName }));
      onApplied();
      onClose();
    } catch (error) {
      showError(mapError((error as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TournamentDialogFrame
      titleId="endurance-penalty-title"
      maxWidth={480}
      zIndex={80}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <h3 id="endurance-penalty-title" style={{ margin: 0, fontSize: 18, color: "var(--ink)" }}>
          {t("penalty.title")}
        </h3>
        <p style={{ marginTop: 6, fontSize: 13, color: "var(--ink-quiet, #9aa4b2)" }}>
          {teamName} · {t("penalty.points", { count: currentPoints })} ·{" "}
          {round > 0 ? t("penalty.round", { round }) : t("penalty.beforeFirstRound")}
        </p>

        <div className="field" style={{ marginTop: 18 }}>
          <label htmlFor="endurance-penalty-points">{t("penalty.pointsLabel")}</label>
          <input
            id="endurance-penalty-points"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_ENDURANCE_PENALTY_POINTS}
            step={1}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            aria-invalid={violation === "POINTS_NOT_POSITIVE" || violation === "POINTS_TOO_HIGH"}
            aria-describedby="endurance-penalty-hint"
            style={{ width: 120, fontSize: 13 }}
          />
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="endurance-penalty-reason">{t("penalty.reasonLabel")}</label>
          <textarea
            id="endurance-penalty-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={MAX_ENDURANCE_PENALTY_REASON}
            aria-invalid={violation === "REASON_TOO_LONG"}
            aria-describedby="endurance-penalty-hint"
            placeholder={t("penalty.reasonPlaceholder")}
            style={{ width: "100%", resize: "vertical", fontSize: 13 }}
          />
          {/*
            `aria-live` : la ligne change sous les doigts de l'arbitre (le
            capital restant suit la saisie, l'élimination s'annonce), et un
            lecteur d'écran qui ne la relit pas laisserait cette annonce à la
            seule couleur.
          */}
          <p
            id="endurance-penalty-hint"
            aria-live="polite"
            style={{
              margin: "6px 0 0",
              fontSize: 12,
              color: hintIsWarning ? "rgba(255,74,92,0.95)" : "var(--ink-quiet, #9aa4b2)",
            }}
          >
            {hint}
          </p>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button
            type="button"
            className="btn ghost"
            onClick={onClose}
            disabled={busy}
            style={{ padding: "8px 18px", fontSize: 13 }}
          >
            {t("score.cancel")}
          </button>
          <button
            type="submit"
            className="btn"
            disabled={busy || violation !== null}
            style={{ padding: "8px 20px", fontSize: 13 }}
          >
            {busy ? t("schedule.saving") : t("penalty.apply")}
          </button>
        </div>
      </form>
    </TournamentDialogFrame>
  );
}
