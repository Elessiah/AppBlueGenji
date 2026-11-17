"use client";

import { BusyButton } from "@/components/ui/busy-button";
import { useToast } from "@/components/ui/toast";
import { BusyLabel } from "@/components/ui/busy-label";
import { useBusyGuard } from "@/lib/shared/hooks/useBusyGuard";
import { FormEvent, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { canHaveReplay, isValidReplayUrl } from "@/lib/shared/match-replay";
import type { BracketMatch } from "@/lib/shared/types";
import { useMapError } from "../_lib/error-map";
import { useDialogsText } from "../_lib/dialogs-text";

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
export function MatchReplayDialog({ match, onClose, onSaved }: Readonly<MatchReplayDialogProps>) {
  // Textes de la fenêtre (espace `tournamentDialogs`).
  const { showError, showSuccess } = useToast();
  const mapError = useMapError();
  const { t } = useDialogsText();
  const [replayUrl, setReplayUrl] = useState(match.replayUrl ?? "");
  // Garde synchrone (Entrée dans le champ, double clic) : un second envoi
  // partirait avant que `busy` soit rendu. Les boutons restent focalisables
  // pendant l'envoi (`aria-disabled` + `aria-busy`), le champ passe en lecture
  // seule (`readOnly`) : désactivé, il perdrait le focus qu'Entrée y laisse.
  const { busy, isBusy, run } = useBusyGuard();
  const dialogRef = useDialogBehavior({ open: true, onClose, locked: busy });
  const backdrop = useBackdropDismiss(onClose, busy);

  const touched = replayUrl.trim().length > 0;
  const invalid = touched && !isValidReplayUrl(replayUrl);
  const replayable = canHaveReplay(match);
  // Rien à enregistrer : un champ vide sur un match sans lien.
  const noop = !touched && match.replayUrl === null;

  const save = async (value: string | null) => {
    await run(async () => {
      try {
        const response = await fetch(`/api/admin/matches/${match.id}/replay`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ replayUrl: value }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(payload.error || "MATCH_REPLAY_UPDATE_FAILED");
        showSuccess(value === null ? t("replay.removed") : t("replay.saved"));
        onSaved();
        onClose();
      } catch (error) {
        showError(mapError((error as Error).message));
      }
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (invalid || noop || (touched && !replayable)) return;
    void save(touched ? replayUrl.trim() : null);
  };

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */
      role="presentation"
      {...backdrop}
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
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="dialog-bounded"
        aria-labelledby="match-replay-title"
        tabIndex={-1}
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
            {t("replay.title")}
          </h3>
          <p style={{ marginTop: 6, fontSize: 13, color: "var(--ink-quiet, #9aa4b2)" }}>
            {match.team1Name ?? "TBD"} vs {match.team2Name ?? "TBD"}
          </p>

          {!replayable && (
            <p /* NOSONAR S6819 — région live d'état, pas le résultat d'un formulaire */
              role="status"
              style={{
                margin: "12px 0 0",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(var(--amber-rgb), 0.4)",
                background: "rgba(var(--amber-rgb), 0.1)",
                fontSize: 12,
                color: "var(--ink-soft, #c3ccd8)",
              }}
            >
              {t("replay.notReplayable")}
            </p>
          )}

          <div className="field" style={{ marginTop: 18 }}>
            <label htmlFor="match-replay-url">{t("replay.url")}</label>
            <input
              id="match-replay-url"
              type="text"
              inputMode="url"
              placeholder="https://www.youtube.com/watch?v=…"
              value={replayUrl}
              onChange={(e) => setReplayUrl(e.target.value)}
              disabled={!replayable}
              readOnly={busy}
              aria-invalid={invalid}
              aria-describedby="match-replay-url-hint"
            />
            <p
              id="match-replay-url-hint"
              style={{
                margin: "6px 0 0",
                fontSize: 12,
                color: invalid ? "rgba(255,74,92,0.95)" : "var(--ink-quiet, #9aa4b2)",
              }}
            >
              {invalid ? t("replay.invalid") : t("replay.hint")}
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
              <BusyButton
                busy={busy}
                type="button"
                className="btn ghost"
                onClick={() => void save(null)}
                style={{ padding: "8px 14px", fontSize: 13, marginRight: "auto" }}
              >
                {t("replay.remove")}
              </BusyButton>
            )}
            <BusyButton
              busy={busy}
              type="button"
              className="btn ghost"
              onClick={() => {
                if (!isBusy()) onClose();
              }}
              style={{ padding: "8px 18px", fontSize: 13 }}
            >
              {t("score.cancel")}
            </BusyButton>
            {replayable && (
              <BusyButton
                busy={busy}
                blocked={invalid || noop}
                type="submit"
                className="btn"
                style={{ padding: "8px 20px", fontSize: 13 }}
              >
                <BusyLabel busy={busy} idle={t("schedule.save")} pending={t("schedule.saving")} />
              </BusyButton>
            )}
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
