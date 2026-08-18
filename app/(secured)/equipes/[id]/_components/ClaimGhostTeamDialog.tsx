"use client";

import { FormEvent, useState } from "react";
import { useToast } from "@/components/ui/toast";

interface ClaimGhostTeamDialogProps {
  teamId: number;
  teamName: string;
  onClose: () => void;
  onChanged: () => void;
}

/**
 * Attribution d'une équipe fantôme à un joueur réel (staff `tournaments`).
 * Le joueur devient OWNER et l'équipe cesse d'être fantôme : elle retrouve le
 * fonctionnement normal (invitations, gestion du roster par son propriétaire).
 */
export function ClaimGhostTeamDialog({ teamId, teamName, onClose, onChanged }: ClaimGhostTeamDialogProps) {
  const { showError, showSuccess } = useToast();
  const [pseudo, setPseudo] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`/api/teams/${teamId}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pseudo: pseudo.trim() }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "TEAM_CLAIM_FAILED");
      showSuccess(`${pseudo.trim()} est désormais propriétaire de ${teamName}.`);
      onClose();
      onChanged();
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="claim-ghost-title"
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
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--cyber-bg-2, #14181f)",
          border: "1px solid rgba(255,157,46,0.4)",
          borderRadius: "var(--r-cy-md, 12px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: 22,
        }}
      >
        <h3 id="claim-ghost-title" style={{ margin: 0, fontSize: 18, color: "var(--ink, #e6e9ef)" }}>
          Attribuer l&apos;équipe à un joueur
        </h3>
        <p style={{ marginTop: 6, fontSize: 13, color: "var(--text-2, #9aa4b2)" }}>
          {teamName} cessera d&apos;être une équipe fantôme : le joueur en devient propriétaire et
          gère lui-même son roster. L&apos;historique de tournois est conservé.
        </p>

        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="claim-pseudo">Pseudo du joueur</label>
          <input
            id="claim-pseudo"
            value={pseudo}
            onChange={(e) => setPseudo(e.target.value)}
            placeholder="Pseudo exact sur le site"
            required
            autoFocus
          />
          <span style={{ fontSize: 11, color: "var(--text-2, #9aa4b2)" }}>
            Le joueur ne doit appartenir à aucune autre équipe.
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={onClose}
            style={{ padding: "8px 18px", fontSize: 13 }}
          >
            Annuler
          </button>
          <button
            type="submit"
            className="btn"
            disabled={busy || pseudo.trim().length === 0}
            style={{
              padding: "8px 20px",
              fontSize: 13,
              background: "rgba(255,157,46,0.16)",
              borderColor: "rgba(255,157,46,0.38)",
              opacity: busy || pseudo.trim().length === 0 ? 0.5 : 1,
            }}
          >
            {busy ? "Attribution…" : "Attribuer l'équipe"}
          </button>
        </div>
      </form>
    </div>
  );
}
