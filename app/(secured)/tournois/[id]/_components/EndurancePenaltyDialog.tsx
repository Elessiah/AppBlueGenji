"use client";

import { FormEvent, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  MAX_ENDURANCE_PENALTY_POINTS,
  MAX_ENDURANCE_PENALTY_REASON,
  checkEndurancePenalty,
  endurancePenaltyMessage,
} from "@/lib/shared/endurance-penalty";
import { mapError } from "../_lib/error-map";

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
}: EndurancePenaltyDialogProps) {
  const { showError, showSuccess } = useToast();
  const [points, setPoints] = useState("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useDialogBehavior({ open: true, onClose, locked: busy });

  const parsedPoints = Number(points);
  const violation = checkEndurancePenalty(parsedPoints, reason);

  // Ce qu'il restera : un capital nul **élimine**, comme une défaite qui le
  // viderait. Le dire avant le clic évite d'apprendre la sortie d'une équipe en
  // lisant le classement après coup.
  const remaining = Number.isFinite(parsedPoints)
    ? Math.max(0, currentPoints - Math.floor(parsedPoints))
    : currentPoints;
  const eliminates = violation === null && remaining === 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (violation !== null) {
      showError(endurancePenaltyMessage(violation));
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
      showSuccess(`Pénalité de ${Math.floor(parsedPoints)} point(s) appliquée à ${teamName}.`);
      onApplied();
      onClose();
    } catch (error) {
      showError(mapError((error as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(6, 8, 12, 0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="endurance-penalty-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          background: "var(--cyber-bg-2, #14181f)",
          border: "1px solid var(--line-strong-cy, var(--line-soft))",
          borderRadius: "var(--r-cy-md, 12px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: 22,
        }}
      >
        <form onSubmit={submit}>
          <h3 id="endurance-penalty-title" style={{ margin: 0, fontSize: 18, color: "var(--ink)" }}>
            Pénalité d&apos;endurance
          </h3>
          <p style={{ marginTop: 6, fontSize: 13, color: "var(--text-2, #9aa4b2)" }}>
            {teamName} · {currentPoints} point{currentPoints > 1 ? "s" : ""} ·{" "}
            {round > 0 ? `manche ${round}` : "avant la première manche"}
          </p>

          <div className="field" style={{ marginTop: 18 }}>
            <label htmlFor="endurance-penalty-points">Points retirés</label>
            <input
              id="endurance-penalty-points"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_ENDURANCE_PENALTY_POINTS}
              step={1}
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              style={{ width: 120, fontSize: 13 }}
            />
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="endurance-penalty-reason">Motif</label>
            <textarea
              id="endurance-penalty-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={MAX_ENDURANCE_PENALTY_REASON}
              aria-invalid={reason.trim().length > 0 && violation === "REASON_TOO_LONG"}
              aria-describedby="endurance-penalty-hint"
              placeholder="Retard au coup d'envoi, joueur non éligible aligné…"
              style={{ width: "100%", resize: "vertical", fontSize: 13 }}
            />
            <p
              id="endurance-penalty-hint"
              style={{
                margin: "6px 0 0",
                fontSize: 12,
                color: eliminates ? "rgba(255,74,92,0.95)" : "var(--text-2, #9aa4b2)",
              }}
            >
              {/*
                Le motif est obligatoire : la sanction est publique et sera
                contestée. La ligne dit d'abord la conséquence — c'est elle qui
                peut surprendre —, le rappel de forme ensuite.
              */}
              {eliminates
                ? `Capital ramené à 0 : ${teamName} sera éliminée du tournoi.`
                : `Motif obligatoire, visible par tous. Capital restant : ${remaining}.`}
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
              Annuler
            </button>
            <button
              type="submit"
              className="btn"
              disabled={busy || violation !== null}
              style={{ padding: "8px 20px", fontSize: 13 }}
            >
              {busy ? "Enregistrement…" : "Appliquer la pénalité"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
