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
import { panelWithProd, prodOptions, prodPickable, type ProdPanelUserView, type ProdPanelView } from "../_lib/prod-dialog";
import { requestJson } from "../_lib/request-json";
import styles from "./ProdDialog.module.css";

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
  // Retrait réussi : le bouton qui ouvrait la confirmation n'existe plus, le focus
  // revient au choix d'un autre compte, à défaut à « Fermer ».
  const [refocus, setRefocus] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
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
        const payload = await requestJson<{ panel: ProdPanelView }>(
          `/api/admin/matches/${match.id}/prod`,
          {},
          "MATCH_PROD_PANEL_FAILED",
        );
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

  useEffect(() => {
    if (!refocus || confirmRemove) return;
    (selectRef.current ?? closeRef.current)?.focus();
    setRefocus(false);
  }, [refocus, confirmRemove, panel]);

  const put = async (userId: number | null, success: string): Promise<boolean> => {
    if (isBusy() || !panel) return false;
    const done = await guarded(async () => {
      try {
        await requestJson(
          `/api/admin/matches/${match.id}/prod`,
          { method: "PUT", body: { userId, expectedUserId: panel.prod?.userId ?? null } },
          "MATCH_PROD_ASSIGN_FAILED",
        );
        showSuccess(success);
        window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
        // La liste des comptes ne change pas : pas de relecture (un balayage
        // des comptes) quand la prod placée s'y trouve.
        const next = panelWithProd(panel, userId);
        if (next) {
          setPanel(next);
          setPick("");
        } else {
          await load(false);
        }
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
  const options = panel ? prodOptions(panel) : [];
  const picked = choices.find((candidate) => String(candidate.userId) === pick) ?? null;
  const optionLabel = (candidate: ProdPanelUserView): string => {
    if (candidate.block === null) return candidate.pseudo;
    const key = candidate.block === "PROD_IS_PLAYER" ? "blockedPlayer" : "blockedCaster";
    return t(`cardActions.prodDialog.${key}`, { pseudo: candidate.pseudo });
  };
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
            {options.length === 0 ? (
              <p className={styles.muted}>{t("cardActions.prodDialog.noCandidate")}</p>
            ) : (
              <form className={styles.row} onSubmit={assign}>
                <div className={`field ${styles.control}`}>
                  <label htmlFor={pickId}>
                    {t(panel.prod ? "cardActions.prodDialog.replaceLabel" : "cardActions.prodDialog.assignLabel")}
                  </label>
                  <select id={pickId} ref={selectRef} value={pick} onChange={(event) => setPick(event.target.value)} disabled={busy}>
                    <option value="">{t("cardActions.prodDialog.assignPlaceholder")}</option>
                    {options.map((candidate) => (
                      <option key={candidate.userId} value={candidate.userId} disabled={candidate.block !== null}>
                        {optionLabel(candidate)}
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
          <button ref={closeRef} type="button" className="btn ghost" onClick={close}>
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
          onConfirm={async () => {
            const removed = await put(null, t("cardActions.prodDialog.removed"));
            if (removed) setRefocus(true);
            return removed;
          }}
        >
          <p>{t("cardActions.prodDialog.removeConfirm.body")}</p>
        </ConfirmActionDialog>
      )}
    </>
  );
}
