"use client";

import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { useToast } from "@/components/ui/toast";
import { CodedError, errorCode } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import {
  STAFF_MESSAGE_CATEGORIES,
  STAFF_MESSAGE_MAX_LENGTH,
  STAFF_MESSAGE_SENDS_PER_WINDOW,
  normalizeStaffMessage,
  type StaffMessageCategory,
  type StaffMessageDelivery,
  type StaffMessageRecipientCounts,
} from "@/lib/shared/tournament-staff-message";
import { useMapError } from "../_lib/error-map";
import { useDialogsText } from "../_lib/dialogs-text";
import {
  initialStaffMessageCategories,
  staffMessageAudience,
  staffMessageBlocker,
  staffMessageLength,
  staffMessageRenderedTooLong,
  staffMessageRequestCategories,
  staffMessageSendOutcome,
  STAFF_MESSAGE_COUNT_DEBOUNCE_MS,
  STAFF_MESSAGE_FIELD_ERRORS,
  STAFF_MESSAGE_OUTCOME_UNKNOWN,
  toggleStaffMessageCategory,
  type StaffMessageBlocker,
} from "../_lib/staff-message-dialog";
import { TournamentDialogFrame } from "./TournamentDialogFrame";
import s from "./StaffMessageDialog.module.css";

interface StaffMessageDialogProps {
  tournamentId: number;
  tournamentName: string;
  onClose: () => void;
}

type StaffMessageResponse = {
  error?: string;
  recipients?: StaffMessageRecipientCounts;
  delivery?: StaffMessageDelivery;
};

/**
 * Un appel à la route. Sans réponse lisible (réseau coupé, page d'erreur
 * `502`/`504` du serveur frontal), le code {@link STAFF_MESSAGE_OUTCOME_UNKNOWN} :
 * pour un envoi, le message a pu partir.
 */
async function postStaffMessage(tournamentId: number, body: Record<string, unknown>): Promise<StaffMessageResponse> {
  let payload: StaffMessageResponse | null = null;
  let ok = false;
  try {
    const response = await fetch(`/api/tournaments/${tournamentId}/staff-message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    ok = response.ok;
    payload = (await response.json()) as StaffMessageResponse | null;
  } catch {
    payload = null;
  }
  if (!payload) throw new CodedError(STAFF_MESSAGE_OUTCOME_UNKNOWN, STAFF_MESSAGE_OUTCOME_UNKNOWN);
  if (!ok) {
    const code = payload.error || "STAFF_MESSAGE_FAILED";
    throw new CodedError(code, code);
  }
  return payload;
}

/** Texte du compteur : la longueur, et pourquoi elle retient l'envoi. */
function counterKey(
  blocker: StaffMessageBlocker | null,
  length: number,
): "staffMessage.counter" | "staffMessage.tooLong" | "staffMessage.tooLongFormatted" {
  if (blocker !== "tooLong") return "staffMessage.counter";
  return length > STAFF_MESSAGE_MAX_LENGTH ? "staffMessage.tooLong" : "staffMessage.tooLongFormatted";
}

/**
 * « Message aux participants » : la commande Discord `/message-tournoi`
 * depuis la fiche (`docs/features/TOURNAMENT_STAFF_MESSAGE.md` § Depuis le
 * site). Le staff coche des catégories — le décompte se relit à chaque case,
 * en nombres seulement —, écrit son texte, puis confirme l'envoi
 * (`ConfirmActionDialog`) : le message part sans retour possible. Même route
 * de service que le bot : destinataires, plafond et journal sont les siens.
 * Refus et bilan en notification (`useToast`), jamais en ligne ; un refus qui
 * désigne le texte y est aussi rattaché (`useFieldErrors`).
 */
export function StaffMessageDialog({ tournamentId, tournamentName, onClose }: Readonly<StaffMessageDialogProps>) {
  const { showError, showSuccess } = useToast();
  const mapError = useMapError();
  const { t } = useDialogsText();
  const ids = useId();
  const messageId = `${ids}-message`;
  const fieldErrors = useFieldErrors(STAFF_MESSAGE_FIELD_ERRORS, { message: messageId });
  const [message, setMessage] = useState("");
  const [categories, setCategories] = useState<Set<StaffMessageCategory>>(initialStaffMessageCategories);
  // Dernier décompte reçu, avec les cases qu'il compte : il ne vaut que pour
  // les cases **actuelles** — une case changée le périme, et l'envoi attend
  // le bon chiffre.
  const [counted, setCounted] = useState<{ key: string; counts: StaffMessageRecipientCounts } | null>(null);
  // Cases dont le décompte a échoué : dit, avec de quoi le relancer.
  const [countFailed, setCountFailed] = useState<string | null>(null);
  const [countRetry, setCountRetry] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const countSeq = useRef(0);

  const requested = staffMessageRequestCategories(categories);
  const requestKey = requested.join(",");
  const counts = counted?.key === requestKey ? counted.counts : null;

  useEffect(() => {
    if (requestKey === "") return;
    const seq = ++countSeq.current;
    setCountFailed(null);
    const timer = setTimeout(() => {
      postStaffMessage(tournamentId, { mode: "count", categories: requestKey.split(",") })
        .then((payload) => {
          if (seq === countSeq.current && payload.recipients) setCounted({ key: requestKey, counts: payload.recipients });
        })
        .catch((error: unknown) => {
          if (seq !== countSeq.current) return;
          setCountFailed(requestKey);
          showError(mapError(errorCode(error) ?? "STAFF_MESSAGE_FAILED"));
        });
    }, STAFF_MESSAGE_COUNT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [tournamentId, requestKey, countRetry, showError, mapError]);

  // Les liens du message privé, bâtis comme le serveur les bâtit (même site).
  const origin = useMemo(() => (typeof window === "undefined" ? "" : window.location.origin), []);
  const renderedTooLong = staffMessageRenderedTooLong(message, { id: tournamentId, name: tournamentName }, origin);
  const blocker = staffMessageBlocker({ message, categories, counts, renderedTooLong });
  const length = staffMessageLength(message);
  const countUnavailable = counts === null && countFailed !== null && countFailed === requestKey;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (blocker === null && !busy) setConfirming(true);
  };

  const send = async (): Promise<boolean> => {
    setBusy(true);
    try {
      const payload = await postStaffMessage(tournamentId, {
        mode: "send",
        categories: requested,
        message: normalizeStaffMessage(message) ?? "",
      });
      const delivery = payload.delivery;
      const outcome = delivery ? staffMessageSendOutcome(delivery) : "pending";
      if (outcome === "nothingDelivered") {
        // Rien n'est parti (le serveur rend l'envoi au plafond quand le bot était injoignable).
        showError(t("staffMessage.nothingDelivered"));
        setConfirming(false);
        return false;
      }
      if (outcome === "pending") showSuccess(t("staffMessage.sentPending"));
      else if (outcome === "botUnreachable") showSuccess(t("staffMessage.sentBotUnreachable", { pushed: delivery?.pushed ?? 0 }));
      else showSuccess(t("staffMessage.sent", { sent: delivery?.sent ?? 0, pushed: delivery?.pushed ?? 0 }));
      onClose();
      return true;
    } catch (error) {
      const code = errorCode(error) ?? "STAFF_MESSAGE_FAILED";
      if (code === STAFF_MESSAGE_OUTCOME_UNKNOWN) {
        // Peut-être parti : la fenêtre se ferme, pour qu'on ne renvoie pas d'un clic.
        showError(t("staffMessage.outcomeUnknown"));
        onClose();
        return true;
      }
      const text = mapError(code);
      showError(text);
      // Un refus qui désigne le texte : retour au champ, qui le dit aussi.
      if (fieldErrors.report(code, text)) setConfirming(false);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const titleId = `${ids}-title`;
  const counterId = `${ids}-counter`;
  const countsId = `${ids}-counts`;

  let countsText: string;
  if (categories.size === 0) countsText = t("staffMessage.noCategory");
  else if (countUnavailable) countsText = t("staffMessage.countFailed");
  else if (counts === null) countsText = t("staffMessage.counting");
  else if (staffMessageAudience(counts) === 0) countsText = t("staffMessage.nobody");
  else countsText = t("staffMessage.counts", { ...counts });

  return (
    <>
      <TournamentDialogFrame titleId={titleId} maxWidth={520} zIndex={80} busy={busy || confirming} onClose={onClose}>
        <form onSubmit={submit}>
          <h3 id={titleId} className={s.title}>
            {t("staffMessage.title")}
          </h3>
          <InfoHintRow>
            <p className={s.subtitle}>{t("staffMessage.tournament", { name: tournamentName })}</p>
            <InfoHint id={`${ids}-hint`} subject={t("staffMessage.hintSubject")}>
              <p>{t("staffMessage.hint")}</p>
            </InfoHint>
          </InfoHintRow>

          <fieldset className={s.categories} data-tap-zone>
            <legend className={s.legend}>{t("staffMessage.categoriesLegend")}</legend>
            {STAFF_MESSAGE_CATEGORIES.map((category) => (
              <label key={category} className={s.category}>
                <input
                  type="checkbox"
                  checked={categories.has(category)}
                  // Pendant l'envoi, les cases ne bougent plus — sans `disabled`, qui
                  // leur ôterait le focus (`BUSY_BUTTONS.md`).
                  aria-readonly={busy || undefined}
                  onChange={(event) => {
                    if (!busy) setCategories((current) => toggleStaffMessageCategory(current, category, event.target.checked));
                  }}
                />
                {/* NOSONAR S6772 — label en flex avec `gap` */}
                {t(`staffMessage.categories.${category}`)}
              </label>
            ))}
          </fieldset>
          <div className={s.countsRow}>
            <p id={countsId} className={s.counts} aria-live="polite">
              {countsText}
            </p>
            {countUnavailable && (
              <button type="button" className="btn ghost" onClick={() => setCountRetry((n) => n + 1)}>
                {t("staffMessage.countRetry")}
              </button>
            )}
          </div>

          <div className="field">
            <label htmlFor={messageId}>{t("staffMessage.label")}</label>
            <textarea
              id={messageId}
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                fieldErrors.clear("message");
              }}
              rows={6}
              readOnly={busy}
              maxLength={STAFF_MESSAGE_MAX_LENGTH * 2}
              {...fieldErrors.aria("message", counterId, countsId)}
              aria-invalid={blocker === "tooLong" || fieldErrors.invalidField === "message" || undefined}
              placeholder={t("staffMessage.placeholder")}
              className={s.message}
            />
            <FieldErrorText fieldId={messageId} message={fieldErrors.message("message")} />
            <p id={counterId} className={blocker === "tooLong" ? `${s.counter} ${s.counterOver}` : s.counter}>
              {t(counterKey(blocker, length), { length, max: STAFF_MESSAGE_MAX_LENGTH })}
            </p>
          </div>

          <div className={s.actions}>
            <BusyButton busy={busy} type="button" className="btn ghost" onClick={() => { if (!busy) onClose(); }}>
              {t("score.cancel")}
            </BusyButton>
            <BusyButton busy={busy} blocked={blocker !== null} type="submit" className="btn">
              {t("staffMessage.send")}
            </BusyButton>
          </div>
        </form>
      </TournamentDialogFrame>

      {confirming && counts && (
        <ConfirmActionDialog
          title={t("staffMessage.confirmTitle")}
          confirmLabel={t("staffMessage.confirm")}
          pendingLabel={t("staffMessage.pending")}
          tone="primary"
          closeOnSuccess={false}
          onClose={() => setConfirming(false)}
          onConfirm={send}
        >
          <p>
            {t("staffMessage.confirmBody", {
              count: staffMessageAudience(counts),
              name: tournamentName,
              max: STAFF_MESSAGE_SENDS_PER_WINDOW,
            })}
          </p>
        </ConfirmActionDialog>
      )}
    </>
  );
}
