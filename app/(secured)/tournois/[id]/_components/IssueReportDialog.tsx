"use client";

import { FormEvent, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  ISSUE_REPORT_MAX_LENGTH,
  ISSUE_REPORT_MIN_LENGTH,
  normalizeIssueReportMessage,
} from "@/lib/shared/discord-notifications";
import type { BracketMatch } from "@/lib/shared/types";
import { mapError } from "../_lib/error-map";

interface IssueReportDialogProps {
  tournamentId: number;
  /** Manche visée, `null` pour un signalement portant sur tout le tournoi. */
  match: BracketMatch | null;
  onClose: () => void;
}

/**
 * Signalement d'un problème au staff, pour un engagé du tournoi.
 *
 * Le message part sur Discord : canal de logs du bot et message privé à chaque
 * arbitre. Rien n'est stocké côté site — c'est une alerte, pas un ticket.
 *
 * Les bornes de longueur viennent du module partagé, celui-là même que le
 * serveur applique : l'interface ne peut donc pas accepter ce que la route
 * refusera.
 */
export function IssueReportDialog({ tournamentId, match, onClose }: IssueReportDialogProps) {
  const { showError, showSuccess } = useToast();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useDialogBehavior({ open: true, onClose, locked: busy });

  const valid = normalizeIssueReportMessage(message) !== null;
  const touched = message.trim().length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/report-issue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: message.trim(), matchId: match?.id ?? null }),
      });
      const payload = (await response.json()) as { error?: string; notifiedReferees?: number };
      if (!response.ok) throw new Error(payload.error || "ISSUE_REPORT_FAILED");
      showSuccess(
        payload.notifiedReferees && payload.notifiedReferees > 0
          ? `Signalement transmis à ${payload.notifiedReferees} arbitre(s).`
          : "Signalement transmis au staff.",
      );
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
        aria-labelledby="issue-report-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 500,
          background: "var(--cyber-bg-2, #14181f)",
          border: "1px solid var(--line-strong-cy, var(--line-soft))",
          borderRadius: "var(--r-cy-md, 12px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: 22,
        }}
      >
        <form onSubmit={submit}>
          <h3 id="issue-report-title" style={{ margin: 0, fontSize: 18, color: "var(--ink)" }}>
            Signaler un problème
          </h3>
          <p style={{ marginTop: 6, fontSize: 13, color: "var(--text-2, #9aa4b2)" }}>
            {match
              ? `Match : ${match.team1Name ?? "TBD"} vs ${match.team2Name ?? "TBD"}`
              : "Portée : tournoi entier"}
          </p>

          <div className="field" style={{ marginTop: 18 }}>
            <label htmlFor="issue-report-message">Que se passe-t-il ?</label>
            <textarea
              id="issue-report-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              maxLength={ISSUE_REPORT_MAX_LENGTH}
              aria-invalid={touched && !valid}
              aria-describedby="issue-report-hint"
              placeholder="Adversaire absent, score contesté, problème de serveur…"
              style={{ width: "100%", resize: "vertical", fontSize: 13 }}
            />
            <p
              id="issue-report-hint"
              style={{
                margin: "6px 0 0",
                fontSize: 12,
                color: touched && !valid ? "rgba(255,74,92,0.95)" : "var(--text-2, #9aa4b2)",
              }}
            >
              {touched && !valid
                ? `Décris le problème en ${ISSUE_REPORT_MIN_LENGTH} caractères au moins.`
                : `${message.trim().length}/${ISSUE_REPORT_MAX_LENGTH} — envoyé aux arbitres sur Discord.`}
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
              disabled={busy || !valid}
              style={{ padding: "8px 20px", fontSize: 13 }}
            >
              {busy ? "Envoi…" : "Envoyer au staff"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
