"use client";

import { FormEvent, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { canHaveReplay, isValidReplayUrl } from "@/lib/shared/match-replay";
import type { BracketMatch } from "@/lib/shared/types";
import { mapError } from "../_lib/error-map";

interface MatchReplayDialogProps {
  match: BracketMatch;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Lien YouTube de la rediff d'un match terminé, pour la permission `live`.
 *
 * Même règle que le serveur (`lib/shared/match-replay.ts`) : seul un lien de
 * vidéo YouTube passe, et seulement sur une rencontre réellement disputée. Le
 * retrait reste toujours possible, y compris sur un match rouvert.
 */
export function MatchReplayDialog({ match, onClose, onSaved }: MatchReplayDialogProps) {
  const { showError, showSuccess } = useToast();
  const [replayUrl, setReplayUrl] = useState(match.replayUrl ?? "");
  const [busy, setBusy] = useState(false);
  const dialogRef = useDialogBehavior({ open: true, onClose, locked: busy });

  const touched = replayUrl.trim().length > 0;
  const invalid = touched && !isValidReplayUrl(replayUrl);
  const replayable = canHaveReplay(match);
  // Rien à enregistrer : un champ vide sur un match sans lien.
  const noop = !touched && match.replayUrl === null;

  const save = async (value: string | null) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/matches/${match.id}/replay`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ replayUrl: value }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "MATCH_REPLAY_UPDATE_FAILED");
      showSuccess(value === null ? "Rediff retirée." : "Rediff enregistrée.");
      onSaved();
      onClose();
    } catch (error) {
      showError(mapError((error as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (invalid || noop || (touched && !replayable)) return;
    void save(touched ? replayUrl.trim() : null);
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
        aria-labelledby="match-replay-title"
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
          <h3 id="match-replay-title" style={{ margin: 0, fontSize: 18, color: "var(--ink)" }}>
            Rediff du match
          </h3>
          <p style={{ marginTop: 6, fontSize: 13, color: "var(--text-2, #9aa4b2)" }}>
            {match.team1Name ?? "TBD"} vs {match.team2Name ?? "TBD"}
          </p>

          {!replayable && (
            <p
              role="status"
              style={{
                margin: "12px 0 0",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,157,46,0.4)",
                background: "rgba(255,157,46,0.1)",
                fontSize: 12,
                color: "var(--text-1, #c3ccd8)",
              }}
            >
              Ce match n&apos;est pas (ou plus) terminé : sa rediff n&apos;est pas affichée. Tu
              peux seulement retirer le lien.
            </p>
          )}

          <div className="field" style={{ marginTop: 18 }}>
            <label htmlFor="match-replay-url">Lien YouTube</label>
            <input
              id="match-replay-url"
              type="text"
              inputMode="url"
              placeholder="https://www.youtube.com/watch?v=…"
              value={replayUrl}
              onChange={(e) => setReplayUrl(e.target.value)}
              disabled={busy || !replayable}
              aria-invalid={invalid}
              aria-describedby="match-replay-url-hint"
            />
            <p
              id="match-replay-url-hint"
              style={{
                margin: "6px 0 0",
                fontSize: 12,
                color: invalid ? "rgba(255,74,92,0.95)" : "var(--text-2, #9aa4b2)",
              }}
            >
              {invalid
                ? "Lien non reconnu : il faut le lien d'une vidéo YouTube (youtube.com/watch?v=…, youtu.be/… ou youtube.com/live/…)."
                : "Un bandeau « Rediff disponible » s'affichera sous le match, visible de tous."}
            </p>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "flex-end",
              gap: 10,
              marginTop: 20,
            }}
          >
            {match.replayUrl !== null && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => void save(null)}
                disabled={busy}
                style={{ padding: "8px 14px", fontSize: 13, marginRight: "auto" }}
              >
                Retirer la rediff
              </button>
            )}
            <button
              type="button"
              className="btn ghost"
              onClick={onClose}
              disabled={busy}
              style={{ padding: "8px 18px", fontSize: 13 }}
            >
              Annuler
            </button>
            {replayable && (
              <button
                type="submit"
                className="btn"
                disabled={busy || invalid || noop}
                style={{ padding: "8px 20px", fontSize: 13 }}
              >
                {busy ? "Enregistrement…" : "Enregistrer"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
