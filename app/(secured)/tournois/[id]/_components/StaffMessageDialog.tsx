"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { useToast } from "@/components/ui/toast";
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
  staffMessageRequestCategories,
  STAFF_MESSAGE_COUNT_DEBOUNCE_MS,
  toggleStaffMessageCategory,
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

async function postStaffMessage(tournamentId: number, body: Record<string, unknown>): Promise<StaffMessageResponse> {
  const response = await fetch(`/api/tournaments/${tournamentId}/staff-message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as StaffMessageResponse;
  if (!response.ok) throw new Error(payload.error || "STAFF_MESSAGE_FAILED");
  return payload;
}

/**
 * « Message aux participants » : la commande Discord `/message-tournoi`
 * depuis la fiche (`docs/features/TOURNAMENT_STAFF_MESSAGE.md` § Depuis le
 * site). Le staff coche des catégories — le décompte se relit à chaque case,
 * en nombres seulement —, écrit son texte, puis confirme l'envoi
 * (`ConfirmActionDialog`) : le message part sans retour possible. Même route
 * de service que le bot : destinataires, plafond et journal sont les siens.
 * Refus et bilan en notification (`useToast`), jamais en ligne.
 */
export function StaffMessageDialog({ tournamentId, tournamentName, onClose }: Readonly<StaffMessageDialogProps>) {
  const { showError, showSuccess } = useToast();
  const mapError = useMapError();
  const { t } = useDialogsText();
  const ids = useId();
  const [message, setMessage] = useState("");
  const [categories, setCategories] = useState<Set<StaffMessageCategory>>(initialStaffMessageCategories);
  // Dernier décompte reçu, avec les cases qu'il compte : il ne vaut que pour
  // les cases **actuelles** — une case changée le périme, et l'envoi attend
  // le bon chiffre.
  const [counted, setCounted] = useState<{ key: string; counts: StaffMessageRecipientCounts } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const countSeq = useRef(0);

  const requested = staffMessageRequestCategories(categories);
  const requestKey = requested.join(",");
  const counts = counted?.key === requestKey ? counted.counts : null;

  useEffect(() => {
    if (requestKey === "") return;
    const seq = ++countSeq.current;
    const timer = setTimeout(() => {
      postStaffMessage(tournamentId, { mode: "count", categories: requestKey.split(",") })
        .then((payload) => {
          if (seq === countSeq.current && payload.recipients) setCounted({ key: requestKey, counts: payload.recipients });
        })
        .catch((error: unknown) => {
          if (seq === countSeq.current) showError(mapError((error as Error).message));
        });
    }, STAFF_MESSAGE_COUNT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [tournamentId, requestKey, showError, mapError]);

  const blocker = staffMessageBlocker({ message, categories, counts });
  const length = staffMessageLength(message);

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
      if (delivery?.botUnreachable) showSuccess(t("staffMessage.sentBotUnreachable", { pushed: delivery.pushed }));
      else showSuccess(t("staffMessage.sent", { sent: delivery?.sent ?? 0, pushed: delivery?.pushed ?? 0 }));
      onClose();
      return true;
    } catch (error) {
      showError(mapError((error as Error).message));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const titleId = `${ids}-title`;
  const messageId = `${ids}-message`;
  const counterId = `${ids}-counter`;
  const countsId = `${ids}-counts`;

  let countsText: string;
  if (categories.size === 0) countsText = t("staffMessage.noCategory");
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
          <p id={countsId} className={s.counts} aria-live="polite">
            {countsText}
          </p>

          <div className="field">
            <label htmlFor={messageId}>{t("staffMessage.label")}</label>
            <textarea
              id={messageId}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={6}
              readOnly={busy}
              maxLength={STAFF_MESSAGE_MAX_LENGTH * 2}
              aria-invalid={blocker === "tooLong"}
              aria-describedby={`${counterId} ${countsId}`}
              placeholder={t("staffMessage.placeholder")}
              className={s.message}
            />
            <p id={counterId} className={blocker === "tooLong" ? `${s.counter} ${s.counterOver}` : s.counter}>
              {t(blocker === "tooLong" ? "staffMessage.tooLong" : "staffMessage.counter", {
                length,
                max: STAFF_MESSAGE_MAX_LENGTH,
              })}
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
