"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useToast } from "@/components/ui/toast";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { InfoHint } from "@/components/ui/info-hint";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { FIRST_MAP_MAX_LENGTH } from "@/lib/shared/match-referee";
import { MATCH_LAUNCH_REFRESH_EVENT } from "@/lib/shared/match-launch";
import type { BracketMatch } from "@/lib/shared/types";
import { TournamentDialogFrame } from "./TournamentDialogFrame";
import { launchErrorText, useActionsText } from "../_lib/actions-text";
import { useErrorsText } from "../_lib/error-map";
import { refereeDialogActions, refereeFocusTarget, type RefereePanelView } from "../_lib/referee-dialog";
import styles from "./RefereeDialog.module.css";

const FIRST_MAP_FIELD_ERRORS = { INVALID_FIRST_MAP: "map" } as const;

/** Geste qui attend sa confirmation : il retire quelqu'un, ou touche toute une manche. */
type PendingConfirm = "removeReferee" | "selfOn" | "roundOn" | "roundOff" | "objection" | "liftObjection";

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
 * autogestion, fixer la première carte, retenir ou lever l'opposition d'un
 * arbitre (`PUT /api/admin/referees/[id]/objection`). Lue à l'ouverture et après chaque
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
  const objectionId = useId();
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
  const [objectionPick, setObjectionPick] = useState("");
  // Opposition à lever, confirmée d'abord : la lever n'est fait qu'à la demande de l'arbitre.
  const [liftTarget, setLiftTarget] = useState<{ userId: number; pseudo: string } | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  // Le contrôle d'un geste est désactivé le temps de l'envoi (le navigateur
  // lâche alors le focus), et un geste retire souvent son propre bouton
  // (« Arbitrer ce match » devient « Ne plus arbitrer ») : le focus tomberait
  // sur la page, la fenêtre encore ouverte. Il revient au contrôle du geste
  // s'il existe encore, sinon à la phrase d'état, qui dit le nouvel état —
  // après la fermeture de la confirmation, dont le retour au déclencheur vise
  // alors un bouton disparu (`refereeFocusTarget`).
  const statusRef = useRef<HTMLParagraphElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (busy || confirm !== null) return;
    const target = refereeFocusTarget<Element>({
      active: document.activeElement,
      body: document.body,
      trigger: triggerRef.current,
      status: statusRef.current,
    });
    triggerRef.current = null;
    if (target instanceof HTMLElement) target.focus();
  }, [busy, confirm, panel]);
  const fieldErrors = useFieldErrors(FIRST_MAP_FIELD_ERRORS, { map: mapId });
  const errorText = (code: string) => launchErrorText(actionText, errorsText, code);

  // `resetMap` : la carte saisie et pas encore enregistrée survit aux autres
  // gestes ; seules l'ouverture et l'enregistrement de la carte la relisent.
  const load = useCallback(
    async (initial = false, resetMap = initial) => {
      try {
        const payload = (await send(`/api/admin/matches/${match.id}/referee`, "GET")) as { panel: RefereePanelView };
        setPanel(payload.panel);
        if (resetMap) setMap(payload.panel.firstMap ?? "");
      } catch {
        loadFailedRef.current(initial);
      }
    },
    [match.id],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  // `success` : le texte du toast, ou sa forme lue sur la réponse (nombre de matchs retirés).
  const run = async (
    request: () => Promise<unknown>,
    success: string | ((payload: unknown) => string),
    resetMap = false,
  ): Promise<boolean> => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBusy(true);
    try {
      const payload = await request();
      showSuccess(typeof success === "string" ? success : success(payload));
      window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
      await load(false, resetMap);
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
    void run(() => send(`${base}/first-map`, "PUT", { map: map.trim() === "" ? null : map }), t("cardActions.refereeDialog.mapSaved"), true);
  };
  const objectionPseudo = panel?.objectable.find((referee) => String(referee.userId) === objectionPick)?.pseudo ?? "";
  const objectionUrl = (userId: number | string) => `/api/admin/referees/${userId}/objection`;
  const upholdObjection = (event: FormEvent) => {
    event.preventDefault();
    if (objectionPick !== "") setConfirm("objection");
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
    objection: {
      title: t("cardActions.refereeDialog.objection.confirm.title", { pseudo: objectionPseudo }),
      body: t("cardActions.refereeDialog.objection.confirm.body"),
      confirm: t("cardActions.refereeDialog.objection.confirm.confirm"),
      action: async () => {
        const done = await run(
          () => send(objectionUrl(objectionPick), "PUT", { upheld: true }),
          (payload) =>
            t("cardActions.refereeDialog.objection.upheld", {
              count: Number((payload as { released?: unknown }).released ?? 0),
            }),
        );
        if (done) setObjectionPick("");
        return done;
      },
    },
    liftObjection: {
      title: t("cardActions.refereeDialog.objection.liftConfirm.title", { pseudo: liftTarget?.pseudo ?? "" }),
      body: t("cardActions.refereeDialog.objection.liftConfirm.body"),
      confirm: t("cardActions.refereeDialog.objection.liftConfirm.confirm"),
      action: async () => {
        if (!liftTarget) return false;
        const done = await run(
          () => send(objectionUrl(liftTarget.userId), "PUT", { upheld: false }),
          t("cardActions.refereeDialog.objection.lifted"),
        );
        if (done) setLiftTarget(null);
        return done;
      },
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
            <p ref={statusRef} tabIndex={-1} className={styles.status}>
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
              <div className={`field ${styles.control}`}>
                <label htmlFor={pickId}>{t("cardActions.refereeDialog.assignLabel")}</label>
                <select id={pickId} value={pick} onChange={(event) => setPick(event.target.value)} disabled={busy}>
                  <option value="">{t("cardActions.refereeDialog.assignPlaceholder")}</option>
                  {actions.candidates.map((candidate) => (
                    <option key={candidate.userId} value={candidate.userId}>
                      {candidate.pseudo}
                    </option>
                  ))}
                </select>
              </div>
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

            {panel.roundSlots.length > 0 ? (
              <div className={styles.body}>
                <div className={styles.titleRow}>
                  <p className={styles.status}>{t("cardActions.refereeDialog.roundMapsTitle")}</p>
                  <InfoHint id={`${mapId}-locked`} subject={t("cardActions.refereeDialog.roundMapsTitle")}>
                    {t("cardActions.refereeDialog.roundMapsLocked")}
                  </InfoHint>
                </div>
                <ol className={styles.roundMaps}>
                  {panel.roundSlots.map((candidates, index) => (
                    // L'ordre des créneaux est leur identité (carte 1, carte 2…).
                    <li key={`slot-${index + 1}`}>
                      {candidates.length === 1
                        ? t("cardActions.refereeDialog.roundMapsImposed", { number: index + 1, map: candidates[0] })
                        : t("cardActions.refereeDialog.roundMapsPool", { number: index + 1, maps: candidates.join(", ") })}
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <form className={styles.row} onSubmit={saveMap}>
                <div className={`field ${styles.control}`}>
                  <label htmlFor={mapId}>{t("cardActions.refereeDialog.mapLabel")}</label>
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
                  <FieldErrorText fieldId={mapId} message={fieldErrors.message("map")} />
                </div>
                <button type="submit" className="btn ghost" disabled={busy}>
                  {t("cardActions.refereeDialog.mapSave")}
                </button>
              </form>
            )}

            <div className={styles.body}>
              <div className={styles.titleRow}>
                <p className={styles.status}>{t("cardActions.refereeDialog.objection.title")}</p>
                <InfoHint id={`${objectionId}-hint`} subject={t("cardActions.refereeDialog.objection.title")}>
                  {t("cardActions.refereeDialog.objection.hint")}
                </InfoHint>
              </div>
              {panel.objections.length > 0 && (
                <ul className={styles.objections}>
                  {panel.objections.map((referee) => (
                    <li key={referee.userId} className={styles.objection}>
                      <span>{referee.pseudo}</span>
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={busy}
                        aria-label={t("cardActions.refereeDialog.objection.liftAria", { pseudo: referee.pseudo })}
                        onClick={() => {
                          setLiftTarget(referee);
                          setConfirm("liftObjection");
                        }}
                      >
                        {t("cardActions.refereeDialog.objection.lift")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <form className={styles.row} onSubmit={upholdObjection}>
                <div className={`field ${styles.control}`}>
                  <label htmlFor={objectionId}>{t("cardActions.refereeDialog.objection.label")}</label>
                  <select
                    id={objectionId}
                    value={objectionPick}
                    onChange={(event) => setObjectionPick(event.target.value)}
                    disabled={busy}
                  >
                    <option value="">{t("cardActions.refereeDialog.assignPlaceholder")}</option>
                    {panel.objectable.map((referee) => (
                      <option key={referee.userId} value={referee.userId}>
                        {referee.pseudo}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn ghost" disabled={busy || objectionPick === ""}>
                  {t("cardActions.refereeDialog.objection.uphold")}
                </button>
              </form>
            </div>
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
