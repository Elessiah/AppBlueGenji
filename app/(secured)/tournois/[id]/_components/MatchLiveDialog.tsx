"use client";

import { FormEvent, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  isValidStreamUrl,
  LIVE_PLATFORMS,
  MATCH_LIVE_TRIGGER_LABELS,
  MAX_STREAM_URL_LENGTH,
  type MatchLiveTrigger,
} from "@/lib/shared/live-streams";
import type { BracketMatch } from "@/lib/shared/types";
import { mapError } from "../_lib/error-map";

interface MatchLiveDialogProps {
  match: BracketMatch;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Configuration de diffusion d'un match, pour la permission `live`.
 *
 * Un match n'est jamais casté par défaut et n'hérite jamais de la chaîne
 * officielle du tournoi : le lien saisi ici est celui de la chaîne qui montre
 * **ce** match, éventuellement celle d'un streamer indépendant.
 *
 * Comportement modal complet via `useDialogBehavior` : `Échap`, piège à focus,
 * arrière-plan figé, focus rendu au déclencheur à la fermeture.
 */
export function MatchLiveDialog({ match, onClose, onSaved }: MatchLiveDialogProps) {
  const { showError, showSuccess } = useToast();
  const [streamed, setStreamed] = useState(match.liveTrigger !== null);
  const [trigger, setTrigger] = useState<MatchLiveTrigger>(match.liveTrigger ?? "MANUAL");
  const [liveUrl, setLiveUrl] = useState(match.liveUrl ?? "");
  const [busy, setBusy] = useState(false);
  // `locked` pendant l'envoi : Échap ne doit pas refermer une modale en train
  // d'écrire.
  const dialogRef = useDialogBehavior({ open: true, onClose, locked: busy });

  const urlTouched = liveUrl.trim().length > 0;
  const urlInvalid = urlTouched && !isValidStreamUrl(liveUrl);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (urlInvalid) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/admin/matches/${match.id}/live`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trigger: streamed ? trigger : null,
          liveUrl: streamed ? liveUrl.trim() || null : null,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "MATCH_LIVE_UPDATE_FAILED");
      showSuccess(streamed ? "Diffusion du match enregistrée." : "Match retiré de la diffusion.");
      onSaved();
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
        aria-labelledby="match-live-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--cyber-bg-2, #14181f)",
          border: "1px solid var(--line-strong-cy, var(--line-soft))",
          borderRadius: "var(--r-cy-md, 12px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: 22,
        }}
      >
        <form onSubmit={submit}>
          <h3 id="match-live-title" style={{ margin: 0, fontSize: 18, color: "var(--ink)" }}>
            Diffusion du match
          </h3>
          <p style={{ marginTop: 6, fontSize: 13, color: "var(--text-2, #9aa4b2)" }}>
            {match.team1Name ?? "TBD"} vs {match.team2Name ?? "TBD"}
          </p>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              margin: "18px 0",
              fontSize: 14,
              color: "var(--text-0, #e6ebf2)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={streamed}
              onChange={(e) => setStreamed(e.target.checked)}
            />
            Ce match est casté
          </label>

          {streamed && (
            <>
              <fieldset style={{ border: "none", padding: 0, margin: "0 0 16px" }}>
                <legend
                  style={{
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--text-2, #9aa4b2)",
                    padding: 0,
                    marginBottom: 8,
                  }}
                >
                  Passage à l&apos;antenne
                </legend>
                {(["AUTO", "MANUAL"] as const).map((option) => (
                  <label
                    key={option}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                      color: "var(--text-1, #c3ccd8)",
                      marginBottom: 6,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="match-live-trigger"
                      value={option}
                      checked={trigger === option}
                      onChange={() => setTrigger(option)}
                    />
                    {MATCH_LIVE_TRIGGER_LABELS[option]}
                  </label>
                ))}
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-2, #9aa4b2)" }}>
                  Le direct s&apos;arrête tout seul dès qu&apos;un score est saisi.
                </p>
              </fieldset>

              <div className="field">
                <label htmlFor="match-live-url">Chaîne du match (facultatif)</label>
                <input
                  id="match-live-url"
                  value={liveUrl}
                  onChange={(e) => setLiveUrl(e.target.value)}
                  maxLength={MAX_STREAM_URL_LENGTH}
                  placeholder="https://twitch.tv/…"
                  aria-invalid={urlInvalid}
                  aria-describedby="match-live-url-hint"
                />
                <p
                  id="match-live-url-hint"
                  style={{
                    margin: "6px 0 0",
                    fontSize: 12,
                    color: urlInvalid ? "rgba(255,74,92,0.95)" : "var(--text-2, #9aa4b2)",
                  }}
                >
                  {urlInvalid
                    ? `Lien non reconnu. Plateformes acceptées : ${LIVE_PLATFORMS.join(", ")}.`
                    : `Laisser vide pour signaler le match sans lien. Plateformes acceptées : ${LIVE_PLATFORMS.join(", ")}.`}
                </p>
              </div>
            </>
          )}

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
              disabled={busy || urlInvalid}
              style={{ padding: "8px 20px", fontSize: 13 }}
            >
              {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
