"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useToast } from "@/components/ui/toast";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { FIRST_MAP_MAX_LENGTH } from "@/lib/shared/match-referee";
import { MATCH_LAUNCH_REFRESH_EVENT } from "@/lib/shared/match-launch";
import type { BracketMatch } from "@/lib/shared/types";
import { TournamentDialogFrame } from "./TournamentDialogFrame";
import { launchErrorText, useActionsText } from "../_lib/actions-text";
import { useErrorsText } from "../_lib/error-map";
import { refereeDialogActions, type RefereePanelView } from "../_lib/referee-dialog";
import styles from "./RefereeDialog.module.css";

const FIRST_MAP_FIELD_ERRORS = { INVALID_FIRST_MAP: "map" } as const;

/** Geste qui attend sa confirmation : il retire quelqu'un, ou touche toute une manche. */
type PendingConfirm = "removeReferee" | "selfOn" | "roundOn" | "roundOff";

async function send(url: string, method: string, body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "UNKNOWN");
  return payload;
}

/** Phrase d'état de la fenêtre : l'arbitre nommé, l'autogestion, ou aucun des deux. */
function refereeStatusText(panel: RefereePanelView, t: ReturnType<typeof useActionsText>["t"]): string {
  if (panel.referee) return t("cardActions.refereeDialog.current", { pseudo: panel.referee.pseudo });
  return t(panel.selfManaged ? "cardActions.refereeDialog.selfManagedNow" : "cardActions.refereeDialog.none");
}

/**
 * Fenêtre « Arbitrage » d'un match, pour le staff (permission `tournaments`) —
 * `docs/features/MATCH_REFEREE.md` : prendre le match, s'en retirer, désigner
 * ou remplacer l'arbitre, passer le match (ou toute sa manche) en
 * autogestion, fixer la première carte. Lue à l'ouverture et après chaque
 * geste (`GET /api/admin/matches/[id]/referee`) : l'arbitre n'est nommé que
 * là, jamais dans l'instantané diffusé.
 */
export function RefereeDialog({
  match,
  matchLabel,
  viewerUserId,
  onClose,
}: Readonly<{
  match: Pick<BracketMatch, "id" | "tournamentId">;
  matchLabel: string;
  viewerUserId: number;
  onClose: () => void;
}>) {
  const actionText = useActionsText();
  const errorsText = useErrorsText();
  const { t } = actionText;
  const { showError, showSuccess } = useToast();
  const titleId = useId();
  const pickId = useId();
  const mapId = useId();
  const [panel, setPanel] = useState<RefereePanelView | null>(null);
  // Échec de lecture : un toast, jamais un message en ligne ; à l'ouverture,
  // la fenêtre se referme (rien à montrer). Ref : `load` reste stable.
  const loadFailedRef = useRef<(initial: boolean) => void>(() => undefined);
  useEffect(() => {
    loadFailedRef.current = (initial) => {
      showError(t("cardActions.refereeDialog.loadFailed"));
      if (initial) onClose();
    };
  });
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const [map, setMap] = useState("");
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const fieldErrors = useFieldErrors(FIRST_MAP_FIELD_ERRORS, { map: mapId });
  const errorText = (code: string) => launchErrorText(actionText, errorsText, code);

  const load = useCallback(
    async (initial = false) => {
      try {
        const payload = (await send(`/api/admin/matches/${match.id}/referee`, "GET")) as { panel: RefereePanelView };
        setPanel(payload.panel);
        setMap(payload.panel.firstMap ?? "");
      } catch {
        loadFailedRef.current(initial);
      }
    },
    [match.id],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const run = async (request: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusy(true);
    try {
      await request();
      showSuccess(success);
      window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
      await load();
      return true;
    } catch (error) {
      const code = (error as Error).message;
      const message = errorText(code);
      fieldErrors.report(code, message);
      showError(message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const base = `/api/admin/matches/${match.id}`;
  const actions = panel ? refereeDialogActions(panel, viewerUserId) : null;
  const assign = (event: FormEvent) => {
    event.preventDefault();
    if (pick === "") return;
    void run(() => send(`${base}/referee`, "PUT", { userId: Number(pick) }), t("cardActions.refereeDialog.assigned"));
  };
  const saveMap = (event: FormEvent) => {
    event.preventDefault();
    void run(() => send(`${base}/first-map`, "PUT", { map: map.trim() === "" ? null : map }), t("cardActions.refereeDialog.mapSaved"));
  };
  const roundBody = (enabled: boolean) =>
    panel ? { phaseId: panel.round.phaseId, roundNumber: panel.round.roundNumber, bracket: panel.round.bracket, enabled } : {};

  const confirmations: Record<PendingConfirm, { title: string; body: string; confirm: string; action: () => Promise<boolean> }> = {
    removeReferee: {
      title: t("cardActions.refereeDialog.removeConfirm.title", { match: matchLabel }),
      body: t("cardActions.refereeDialog.removeConfirm.body"),
      confirm: t("cardActions.refereeDialog.removeConfirm.confirm"),
      action: () => run(() => send(`${base}/referee`, "PUT", { userId: null }), t("cardActions.refereeDialog.removed")),
    },
    selfOn: {
      title: t("cardActions.refereeDialog.selfOnConfirm.title", { match: matchLabel }),
      body: t("cardActions.refereeDialog.selfOnConfirm.body"),
      confirm: t("cardActions.refereeDialog.selfOnConfirm.confirm"),
      action: () =>
        run(() => send(`${base}/self-management`, "PUT", { enabled: true }), t("cardActions.refereeDialog.selfOn")),
    },
    roundOn: {
      title: t("cardActions.refereeDialog.roundOnConfirm.title"),
      body: t("cardActions.refereeDialog.roundOnConfirm.body"),
      confirm: t("cardActions.refereeDialog.roundOnConfirm.confirm"),
      action: () =>
        run(
          () => send(`/api/admin/tournaments/${match.tournamentId}/self-management`, "PUT", roundBody(true)),
          t("cardActions.refereeDialog.roundOn"),
        ),
    },
    roundOff: {
      title: t("cardActions.refereeDialog.roundOffConfirm.title"),
      body: t("cardActions.refereeDialog.roundOffConfirm.body"),
      confirm: t("cardActions.refereeDialog.roundOffConfirm.confirm"),
      action: () =>
        run(
          () => send(`/api/admin/tournaments/${match.tournamentId}/self-management`, "PUT", roundBody(false)),
          t("cardActions.refereeDialog.roundOff"),
        ),
    },
  };
  const pending = confirm === null ? null : confirmations[confirm];

  return (
    <>
      <TournamentDialogFrame titleId={titleId} maxWidth={480} zIndex={90} deferMount busy={busy} onClose={onClose}>
        <h3 id={titleId} className={styles.title}>
          {t("cardActions.refereeDialog.title", { match: matchLabel })}
        </h3>

        {!panel && <p className={styles.muted}>{t("cardActions.refereeDialog.loading")}</p>}

        {panel && actions && (
          <div className={styles.body}>
            <p className={styles.status}>
              {refereeStatusText(panel, t)}
              {panel.referee && !panel.referee.eligible && (
                <span className={styles.warn}> {t("cardActions.refereeDialog.ineligible")}</span>
              )}
            </p>

            <div className={styles.row}>
              {actions.take && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(() => send(`/api/matches/${match.id}/referee`, "POST"), t("cardActions.refereeDialog.taken"))
                  }
                >
                  {t("cardActions.refereeDialog.take")}
                </button>
              )}
              {actions.releaseSelf && (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(() => send(`/api/matches/${match.id}/referee`, "DELETE"), t("cardActions.refereeDialog.released"))
                  }
                >
                  {t("cardActions.refereeDialog.releaseSelf")}
                </button>
              )}
              {actions.removeOther && (
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirm("removeReferee")}>
                  {t("cardActions.refereeDialog.remove")}
                </button>
              )}
            </div>

            <form className={styles.row} onSubmit={assign}>
              <label htmlFor={pickId} className={styles.label}>
                {t("cardActions.refereeDialog.assignLabel")}
              </label>
              <select id={pickId} value={pick} onChange={(event) => setPick(event.target.value)} disabled={busy}>
                <option value="">{t("cardActions.refereeDialog.assignPlaceholder")}</option>
                {actions.candidates.map((candidate) => (
                  <option key={candidate.userId} value={candidate.userId}>
                    {candidate.pseudo}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn ghost" disabled={busy || pick === ""}>
                {t("cardActions.refereeDialog.assign")}
              </button>
            </form>

            <div className={styles.row}>
              {panel.selfManaged ? (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => send(`${base}/self-management`, "PUT", { enabled: false }),
                      t("cardActions.refereeDialog.selfOff"),
                    )
                  }
                >
                  {t("cardActions.refereeDialog.selfOffAction")}
                </button>
              ) : (
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirm("selfOn")}>
                  {t("cardActions.refereeDialog.selfOnAction")}
                </button>
              )}
              <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirm("roundOn")}>
                {t("cardActions.refereeDialog.roundOnAction")}
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirm("roundOff")}>
                {t("cardActions.refereeDialog.roundOffAction")}
              </button>
            </div>

            <form className={styles.row} onSubmit={saveMap}>
              <label htmlFor={mapId} className={styles.label}>
                {t("cardActions.refereeDialog.mapLabel")}
              </label>
              <input
                id={mapId}
                type="text"
                value={map}
                maxLength={FIRST_MAP_MAX_LENGTH}
                onChange={(event) => {
                  setMap(event.target.value);
                  fieldErrors.clear("map");
                }}
                disabled={busy}
                {...fieldErrors.aria("map")}
              />
              <button type="submit" className="btn ghost" disabled={busy}>
                {t("cardActions.refereeDialog.mapSave")}
              </button>
              <FieldErrorText fieldId={mapId} message={fieldErrors.message("map")} />
            </form>
          </div>
        )}

        <div className={styles.footer}>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            {t("cardActions.refereeDialog.close")}
          </button>
        </div>
      </TournamentDialogFrame>
      {pending && (
        <ConfirmActionDialog
          title={pending.title}
          confirmLabel={pending.confirm}
          pendingLabel={t("cardActions.refereeDialog.pending")}
          onClose={() => setConfirm(null)}
          onConfirm={pending.action}
        >
          <p>{pending.body}</p>
        </ConfirmActionDialog>
      )}
    </>
  );
}
