"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { useToast } from "@/components/ui/toast";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { InfoHint } from "@/components/ui/info-hint";
import { useBusyGuard } from "@/lib/shared/hooks/useBusyGuard";
import { MATCH_LAUNCH_REFRESH_EVENT } from "@/lib/shared/match-launch";
import type { BracketMatch } from "@/lib/shared/types";
import { TournamentDialogFrame } from "./TournamentDialogFrame";
import { launchErrorText, useActionsText } from "../_lib/actions-text";
import { useErrorsText } from "../_lib/error-map";
import { prodPickable, type ProdPanelView } from "../_lib/prod-dialog";
import styles from "./RefereeDialog.module.css";

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

/**
 * Fenêtre « Prod du match », pour le staff (permission `tournaments`) —
 * `docs/features/MATCH_PROD.md` : placer, changer ou retirer la prod du match.
 * Lue à l'ouverture et après chaque geste (`GET /api/admin/matches/[id]/prod`).
 * Chaque geste dit la prod qu'il remplace (`expectedUserId`) : changée entre-temps
 * par un autre membre du staff, rien ne bouge (`PROD_CHANGED`) et la fenêtre se relit.
 */
export function ProdDialog({
  match,
  matchLabel,
  onClose,
}: Readonly<{
  match: Pick<BracketMatch, "id">;
  matchLabel: string;
  onClose: () => void;
}>) {
  const actionText = useActionsText();
  const errorsText = useErrorsText();
  const { t } = actionText;
  const { showError, showSuccess } = useToast();
  const titleId = useId();
  const pickId = useId();
  const hintId = useId();
  const [panel, setPanel] = useState<ProdPanelView | null>(null);
  const [pick, setPick] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { busy, isBusy, run: guarded } = useBusyGuard();
  // Échec de lecture : un toast ; à l'ouverture, la fenêtre se referme (rien à montrer).
  const loadFailedRef = useRef<(initial: boolean) => void>(() => undefined);
  useEffect(() => {
    loadFailedRef.current = (initial) => {
      showError(t("cardActions.prodDialog.loadFailed"));
      if (initial) onClose();
    };
  });
  const errorText = (code: string) => launchErrorText(actionText, errorsText, code);

  const load = useCallback(
    async (initial = false) => {
      try {
        const payload = (await send(`/api/admin/matches/${match.id}/prod`, "GET")) as { panel: ProdPanelView };
        setPanel(payload.panel);
        setPick("");
      } catch {
        loadFailedRef.current(initial);
      }
    },
    [match.id],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const put = async (userId: number | null, success: string): Promise<boolean> => {
    if (isBusy() || !panel) return false;
    const done = await guarded(async () => {
      try {
        await send(`/api/admin/matches/${match.id}/prod`, "PUT", { userId, expectedUserId: panel.prod?.userId ?? null });
        showSuccess(success);
        window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
        await load(false);
        return true;
      } catch (error) {
        const code = (error as Error).message;
        showError(errorText(code));
        if (code === "PROD_CHANGED") await load(false);
        return false;
      }
    });
    return done ?? false;
  };

  const choices = panel ? prodPickable(panel) : [];
  const picked = choices.find((candidate) => String(candidate.userId) === pick) ?? null;
  const assign = (event: FormEvent) => {
    event.preventDefault();
    if (!picked) return;
    void put(picked.userId, t("cardActions.prodDialog.assigned", { pseudo: picked.pseudo }));
  };
  const close = () => {
    if (!isBusy()) onClose();
  };

  return (
    <>
      <TournamentDialogFrame titleId={titleId} maxWidth={440} zIndex={90} deferMount busy={busy} onClose={close}>
        <div className={styles.titleRow}>
          <h3 id={titleId} className={styles.title}>
            {t("cardActions.prodDialog.title", { match: matchLabel })}
          </h3>
          <InfoHint id={hintId} subject={t("cardActions.prodDialog.hintSubject")}>
            {t("cardActions.prodDialog.hint")}
          </InfoHint>
        </div>

        {!panel && <p className={styles.muted}>{t("cardActions.prodDialog.loading")}</p>}

        {panel && (
          <div className={styles.body}>
            <p className={styles.status} aria-live="polite">
              {panel.prod
                ? t("cardActions.prodDialog.current", { pseudo: panel.prod.pseudo })
                : t("cardActions.prodDialog.none")}
            </p>
            {panel.prod && (
              <div className={styles.row}>
                <BusyButton busy={busy} type="button" className="btn ghost" onClick={() => setConfirmRemove(true)}>
                  {t("cardActions.prodDialog.remove")}
                </BusyButton>
              </div>
            )}
            {choices.length === 0 ? (
              <p className={styles.muted}>{t("cardActions.prodDialog.noCandidate")}</p>
            ) : (
              <form className={styles.row} onSubmit={assign}>
                <div className={`field ${styles.control}`}>
                  <label htmlFor={pickId}>
                    {t(panel.prod ? "cardActions.prodDialog.replaceLabel" : "cardActions.prodDialog.assignLabel")}
                  </label>
                  <select id={pickId} value={pick} onChange={(event) => setPick(event.target.value)} disabled={busy}>
                    <option value="">{t("cardActions.prodDialog.assignPlaceholder")}</option>
                    {choices.map((candidate) => (
                      <option key={candidate.userId} value={candidate.userId}>
                        {candidate.pseudo}
                      </option>
                    ))}
                  </select>
                </div>
                <BusyButton busy={busy} blocked={picked === null} type="submit" className="btn ghost">
                  {t("cardActions.prodDialog.assign")}
                </BusyButton>
              </form>
            )}
          </div>
        )}

        <div className={styles.footer}>
          <button type="button" className="btn ghost" onClick={close}>
            {t("cardActions.prodDialog.close")}
          </button>
        </div>
      </TournamentDialogFrame>
      {confirmRemove && panel?.prod && (
        <ConfirmActionDialog
          title={t("cardActions.prodDialog.removeConfirm.title", { pseudo: panel.prod.pseudo })}
          confirmLabel={t("cardActions.prodDialog.removeConfirm.confirm")}
          pendingLabel={t("cardActions.prodDialog.pending")}
          onClose={() => setConfirmRemove(false)}
          onConfirm={() => put(null, t("cardActions.prodDialog.removed"))}
        >
          <p>{t("cardActions.prodDialog.removeConfirm.body")}</p>
        </ConfirmActionDialog>
      )}
    </>
  );
}
