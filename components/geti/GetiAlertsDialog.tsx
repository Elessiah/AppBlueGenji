"use client";

import { useEffect, useId, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { CyberButton, ScrollArea } from "@/components/cyber";
import { useAppLocale } from "@/components/i18n/locale-context";
import { LocaleLink, useLocaleHref } from "@/components/i18n/locale-navigation";
import { BusyButton } from "@/components/ui/busy-button";
import { BusyLabel } from "@/components/ui/busy-label";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { useToast } from "@/components/ui/toast";
import {
  GETI_ALERT_ERRORS,
  GETI_ALERT_MAX_PER_USER,
  GETI_ALERT_NAME_MAX,
  getiAlertQuery,
  type GetiAlert,
} from "@/lib/shared/geti/alerts";
import { getiActiveFilterCount, getiCategoryPath } from "@/lib/shared/geti/page";
import { getiText, type GetiMessages } from "@/lib/shared/geti/page-text";
import type { GetiCategory } from "@/lib/shared/geti/types";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useBusyGuard } from "@/lib/shared/hooks/useBusyGuard";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import styles from "./geti.module.css";

type AlertsText = GetiMessages["alerts"];

export type GetiAlertsProps = Readonly<{
  text: AlertsText;
  /** Catégorie affichée et sa recherche, telles que l'alerte les garderait. */
  category: GetiCategory;
  search: string;
  /** Titres des catégories (« Je cherche un joueur ») : le nom d'une alerte sans nom. */
  categoryTitles: Readonly<Record<GetiCategory, string>>;
  /** Un compte est connecté. */
  signedIn: boolean;
  /** Ses alertes, lues par le serveur au rendu de la page. */
  initialAlerts: readonly GetiAlert[];
}>;

const NAME_ERRORS = { [GETI_ALERT_ERRORS.nameTooLong]: "name" } as const;

/** Le code de refus d'une réponse, ou `null` si elle a abouti. */
async function refusalOf(response: Response): Promise<string | null> {
  if (response.ok) return null;
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : "";
  } catch {
    return "";
  }
}

/** L'alerte d'une réponse réussie, ou `null` si son corps n'est pas celui attendu (relais, page d'erreur en 200). */
async function alertOf(response: Response): Promise<GetiAlert | null> {
  try {
    const body = (await response.json()) as { alert?: GetiAlert };
    return body.alert ?? null;
  } catch {
    return null;
  }
}

async function send(url: string, method: "POST" | "PATCH" | "DELETE", body?: object): Promise<Response | null> {
  try {
    return await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return null;
  }
}

/** Le message d'un code de refus, dans la langue de la page. */
function useRefusalText(text: AlertsText): (code: string | null) => string {
  const locale = useAppLocale();
  return (code) => {
    const errors: Readonly<Record<string, string>> = text.errors;
    const source = code !== null && Object.hasOwn(errors, code) ? errors[code] : text.errors.generic;
    return getiText(locale, source, { max: GETI_ALERT_MAX_PER_USER, nameMax: GETI_ALERT_NAME_MAX });
  };
}

type RowProps = Readonly<{
  alert: GetiAlert;
  label: string;
  /** Titre de sa catégorie (« Je cherche un joueur »). */
  categoryTitle: string;
  text: AlertsText;
  onChanged: (alert: GetiAlert) => void;
  onDeleted: (id: number) => void;
  /** Le serveur ne reconnaît plus la session : la fenêtre repasse à l'invite de connexion. */
  onSessionLost: () => void;
}>;

/** Une alerte de la liste : son nom, ses filtres, pause, renommage, suppression. */
function AlertRow({ alert, label, categoryTitle, text, onChanged, onDeleted, onSessionLost }: RowProps) {
  const locale = useAppLocale();
  const { showSuccess, showError } = useToast();
  const refusalText = useRefusalText(text);
  const { busy, run } = useBusyGuard();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(alert.name ?? "");
  const [confirming, setConfirming] = useState(false);
  const renameId = useId();
  const renameInput = useRef<HTMLInputElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  // Le focus suit le geste : le champ à l'ouverture du renommage, le bouton
  // « Renommer » à sa fermeture (le bouton ou le champ qui l'avait y est démonté).
  useEffect(() => {
    if (renaming) renameInput.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      renameButton.current?.focus();
    }
  }, [renaming]);
  const fieldErrors = useFieldErrors<"name">(NAME_ERRORS, { name: renameId });
  const filters = getiActiveFilterCount(getiAlertQuery(alert.category, alert.search));

  const patch = async (body: { name?: string | null; paused?: boolean }, done: string): Promise<boolean> => {
    const response = await send(`/api/geti/alerts/${alert.id}`, "PATCH", body);
    let refusal = response ? await refusalOf(response) : "";
    if (response && refusal === null) {
      const updated = await alertOf(response);
      if (updated) {
        onChanged(updated);
        showSuccess(done);
        return true;
      }
      refusal = "";
    }
    const message = refusalText(refusal);
    fieldErrors.report(refusal, message);
    showError(message);
    if (refusal === GETI_ALERT_ERRORS.notFound) onDeleted(alert.id);
    if (refusal === GETI_ALERT_ERRORS.unauthorized) onSessionLost();
    return false;
  };

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    await run(async () => {
      if (await patch({ name: draft }, text.renamed)) {
        returnFocus.current = true;
        setRenaming(false);
      }
    });
  };

  const remove = async (): Promise<boolean> => {
    const response = await send(`/api/geti/alerts/${alert.id}`, "DELETE");
    const refusal = response ? await refusalOf(response) : "";
    if (refusal === null || refusal === GETI_ALERT_ERRORS.notFound) {
      onDeleted(alert.id);
      showSuccess(text.deleted);
      return true;
    }
    showError(refusalText(refusal));
    if (refusal === GETI_ALERT_ERRORS.unauthorized) onSessionLost();
    return false;
  };

  return (
    <li className={styles.alertRow} data-testid="geti-alert">
      <div className={styles.alertHead}>
        <span className={styles.alertName}>{label}</span>
        <span className={alert.paused ? "pill pill-neutral" : "pill pill-success"}>
          {alert.paused ? text.paused : text.active}
        </span>
      </div>
      <p className={styles.alertMeta}>
        {getiText(locale, text.summary, { category: categoryTitle, count: filters })}
        {" · "}
        <LocaleLink href={`${getiCategoryPath(alert.category)}${alert.search}`} className={styles.modalLink}>
          {text.view}
          <span className="sr-only"> — {label}</span>
        </LocaleLink>
      </p>
      {renaming ? (
        <form className={styles.alertRename} onSubmit={(event) => void rename(event)}>
          <label htmlFor={renameId} className={styles.alertLabel}>
            {text.renameLabel}
            <span className="sr-only"> — {label}</span>
          </label>
          <input
            id={renameId}
            type="text"
            className={styles.alertInput}
            value={draft}
            maxLength={GETI_ALERT_NAME_MAX}
            autoComplete="off"
            ref={renameInput}
            onChange={(event) => {
              setDraft(event.target.value);
              fieldErrors.clear("name");
            }}
            {...fieldErrors.aria("name")}
          />
          <FieldErrorText fieldId={renameId} message={fieldErrors.message("name")} />
          <div className={styles.alertActions} data-tap-zone="">
            <BusyButton type="submit" className={styles.alertButton} busy={busy}>
              {text.save}
            </BusyButton>
            <button
              type="button"
              className={styles.alertButton}
              onClick={() => {
                returnFocus.current = true;
                setRenaming(false);
                setDraft(alert.name ?? "");
              }}
            >
              {text.cancel}
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.alertActions} data-tap-zone="">
          <BusyButton
            className={styles.alertButton}
            busy={busy}
            onClick={() =>
              void run(() => patch({ paused: !alert.paused }, alert.paused ? text.resumedDone : text.pausedDone))
            }
          >
            {alert.paused ? text.resume : text.pause}
            <span className="sr-only"> — {label}</span>
          </BusyButton>
          <BusyButton ref={renameButton} className={styles.alertButton} busy={busy} onClick={() => setRenaming(true)}>
            {text.rename}
            <span className="sr-only"> — {label}</span>
          </BusyButton>
          <BusyButton
            className={`${styles.alertButton} ${styles.alertDanger}`}
            busy={busy}
            onClick={() => setConfirming(true)}
          >
            {text.delete}
            <span className="sr-only"> — {label}</span>
          </BusyButton>
        </div>
      )}
      {confirming ? (
        <ConfirmActionDialog
          title={text.deleteTitle}
          confirmLabel={text.deleteConfirm}
          pendingLabel={text.deletePending}
          layer="overBlocking"
          onClose={() => setConfirming(false)}
          onConfirm={remove}
        >
          <p>{getiText(locale, text.deleteText, { alert: label })}</p>
        </ConfirmActionDialog>
      ) : null}
    </li>
  );
}

/** Ce que la fenêtre reçoit : les props du bouton, la liste du moment et sa fermeture. */
export type GetiAlertsDialogProps = GetiAlertsProps &
  Readonly<{
    alerts: readonly GetiAlert[];
    /** Setter d'état : chaque réponse s'applique à la liste du moment (deux gestes en vol ne s'écrasent pas). */
    setAlerts: Dispatch<SetStateAction<readonly GetiAlert[]>>;
    onClose: () => void;
  }>;

export function GetiAlertsDialog({ text, category, search, categoryTitles, signedIn, alerts, setAlerts, onClose }: GetiAlertsDialogProps) {
  const locale = useAppLocale();
  const localized = useLocaleHref();
  const { showSuccess, showError } = useToast();
  const refusalText = useRefusalText(text);
  const dialogRef = useDialogBehavior({ open: true, onClose });
  const backdrop = useBackdropDismiss(onClose);
  const titleId = useId();
  const nameId = useId();
  const [name, setName] = useState("");
  const [sessionLost, setSessionLost] = useState(false);
  const noteId = useId();
  const returnTo = localized(getiCategoryPath(category) + search);
  const loginHref = `/connexion?redirect=${encodeURIComponent(returnTo)}`;
  const { busy, run } = useBusyGuard();
  const fieldErrors = useFieldErrors<"name">(NAME_ERRORS, { name: nameId });
  const filters = getiActiveFilterCount(getiAlertQuery(category, search));
  const full = alerts.length >= GETI_ALERT_MAX_PER_USER;
  const labelOf = (alert: GetiAlert) => alert.name ?? categoryTitles[alert.category];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (full) return;
    void run(create);
  };

  const create = async () => {
    const response = await send("/api/geti/alerts", "POST", { category, search, name });
    let refusal = response ? await refusalOf(response) : "";
    if (response && refusal === null) {
      const created = await alertOf(response);
      if (created) {
        setAlerts((current) => [...current, created]);
        setName("");
        showSuccess(text.created);
        return;
      }
      refusal = "";
    }
    const message = refusalText(refusal);
    fieldErrors.report(refusal, message);
    showError(message);
    if (refusal === GETI_ALERT_ERRORS.unauthorized) setSessionLost(true);
  };

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ className={styles.overlay} role="presentation" {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) */
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={styles.modalHead}>
          <h2 id={titleId} className={styles.modalTitle}>
            {text.title}
          </h2>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label={text.closeLabel}>
            ✕
          </button>
        </header>
        <ScrollArea orientation="y" className={styles.modalScroll} ariaLabel={text.title}>
          {signedIn && !sessionLost ? (
            <div className={styles.alertBody}>
              <form className={styles.alertForm} onSubmit={submit}>
                <h3 className={styles.alertSection}>{text.createTitle}</h3>
                <p className={styles.modalText} data-testid="geti-alert-summary">
                  {getiText(locale, text.summary, { category: categoryTitles[category], count: filters })}
                </p>
                <p className={styles.modalNote}>
                  {text.channels}{" "}
                  <LocaleLink href="/profil#notifications" className={styles.modalLink}>
                    {text.channelsLink}
                  </LocaleLink>
                </p>
                <label htmlFor={nameId} className={styles.alertLabel}>
                  {text.nameLabel}
                </label>
                <input
                  id={nameId}
                  type="text"
                  className={styles.alertInput}
                  value={name}
                  maxLength={GETI_ALERT_NAME_MAX}
                  autoComplete="off"
                  onChange={(event) => {
                    setName(event.target.value);
                    fieldErrors.clear("name");
                  }}
                  {...fieldErrors.aria("name")}
                />
                <FieldErrorText fieldId={nameId} message={fieldErrors.message("name")} />
                {full ? (
                  <p id={noteId} className={styles.modalNote}>
                    {getiText(locale, text.errors.GETI_ALERT_LIMIT, { max: GETI_ALERT_MAX_PER_USER })}
                  </p>
                ) : null}
                <div>
                  <CyberButton variant="primary" asChild>
                    <BusyButton type="submit" busy={busy} blocked={full} aria-describedby={full ? noteId : undefined}>
                      <BusyLabel busy={busy} idle={text.create} pending={text.creating} />
                    </BusyButton>
                  </CyberButton>
                </div>
              </form>
              <h3 className={styles.alertSection}>
                {getiText(locale, text.listTitle, { count: alerts.length, max: GETI_ALERT_MAX_PER_USER })}
              </h3>
              {alerts.length === 0 ? (
                <p className={styles.modalNote}>{text.empty}</p>
              ) : (
                <ul className={styles.alertList}>
                  {alerts.map((alert) => (
                    <AlertRow
                      key={alert.id}
                      alert={alert}
                      label={labelOf(alert)}
                      categoryTitle={categoryTitles[alert.category]}
                      text={text}
                      onChanged={(updated) =>
                        setAlerts((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)))
                      }
                      // Le focus d'une ligne supprimée passe à sa voisine (`useDialogBehavior`).
                      onDeleted={(id) => setAlerts((current) => current.filter((entry) => entry.id !== id))}
                      onSessionLost={() => setSessionLost(true)}
                    />
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              <p className={styles.modalText}>{text.loginText}</p>
              <div>
                <CyberButton variant="primary" asChild>
                  <LocaleLink href={loginHref} onClick={onClose}>
                    {text.loginLink}
                  </LocaleLink>
                </CyberButton>
              </div>
            </>
          )}
        </ScrollArea>
        <div className={styles.modalActions}>
          <CyberButton variant="ghost" onClick={onClose}>
            {text.close}
          </CyberButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
