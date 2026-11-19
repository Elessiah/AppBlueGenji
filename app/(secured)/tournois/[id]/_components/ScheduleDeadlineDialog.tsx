"use client";

import { useMemo, useState } from "react";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { useToast } from "@/components/ui/toast";
import { SCHEDULE_DEADLINE_FIELD_ERRORS } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { INTL_LOCALE } from "@/lib/shared/locales";
import {
  deadlineEntryDays,
  deadlineEntryOf,
  deadlineFromEntry,
  defaultScheduleDeadline,
  SCHEDULE_DEADLINE_DEFAULT_HOUR,
} from "@/lib/shared/schedule-deadline";
import { useActionsText } from "../_lib/actions-text";
import { useMapError } from "../_lib/error-map";

const FIELD_IDS = { day: "schedule-deadline-day" } as const;
const HOUR_ID = "schedule-deadline-hour";
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
/** Option « aucune date butoir » du jour : enregistrer l'efface. */
const NONE = "";

/** Ce que la fenêtre écrit : un match, ou tous les matchs à planifier d'un tournoi. */
export type ScheduleDeadlineTarget =
  | { kind: "match"; matchId: number; label: string; deadlineAt: string | null }
  | { kind: "tournament"; tournamentId: number; count: number };

/** « mar. 18 nov. » : un jour de Paris (`AAAA-MM-JJ`), lu à midi UTC pour ne pas glisser d'un jour. */
function dayLabel(day: string, locale: "fr" | "en"): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

/**
 * Date butoir de planification (`docs/features/SCHEDULE_DEADLINE.md`) : un
 * jour et une heure pile, **heure de Paris**. Préremplie par la date butoir en
 * place, sinon par celle d'usage (21:00, deux jours plus tard). « Aucune »
 * l'efface. Portée et piège de focus : `ConfirmActionDialog`.
 */
export function ScheduleDeadlineDialog({
  target,
  onClose,
}: Readonly<{ target: ScheduleDeadlineTarget; onClose: () => void }>) {
  const text = useActionsText();
  const { t, locale } = text;
  const mapError = useMapError();
  const { showError, showSuccess } = useToast();
  const fieldErrors = useFieldErrors(SCHEDULE_DEADLINE_FIELD_ERRORS, FIELD_IDS);
  const [now] = useState(() => Date.now());
  const current = target.kind === "match" && target.deadlineAt !== null ? Date.parse(target.deadlineAt) : null;
  const initial = deadlineEntryOf(current ?? defaultScheduleDeadline(now));
  const [day, setDay] = useState<string>(initial.day);
  const [hour, setHour] = useState<number>(current === null ? SCHEDULE_DEADLINE_DEFAULT_HOUR : initial.hour);
  const days = useMemo(() => {
    const list = deadlineEntryDays(now);
    // Une date butoir en place hors de la liste (posée plus loin) reste choisie.
    return list.includes(initial.day) ? list : [initial.day, ...list];
  }, [now, initial.day]);

  const save = async (): Promise<boolean> => {
    const at = day === NONE ? null : deadlineFromEntry(day, hour);
    if (day !== NONE && at === null) {
      const message = mapError("INVALID_SCHEDULE_DEADLINE");
      fieldErrors.flag("day", message);
      showError(message);
      return false;
    }
    const url =
      target.kind === "match"
        ? `/api/admin/matches/${target.matchId}/schedule-deadline`
        : `/api/admin/tournaments/${target.tournamentId}/schedule-deadlines`;
    try {
      const response = await fetch(url, {
        method: target.kind === "match" ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deadlineAt: at === null ? null : new Date(at).toISOString() }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; count?: number };
      if (!response.ok) {
        const message = mapError(payload.error || "UNKNOWN");
        fieldErrors.report(payload.error, message);
        showError(message);
        return false;
      }
      fieldErrors.clear();
      if (target.kind === "tournament") {
        showSuccess(t(at === null ? "scheduleDeadline.bulkCleared" : "scheduleDeadline.bulkSaved", { count: payload.count ?? 0 }));
      } else {
        showSuccess(t(at === null ? "scheduleDeadline.cleared" : "scheduleDeadline.saved"));
      }
      return true;
    } catch {
      showError(mapError("SCHEDULE_DEADLINE_UPDATE_FAILED"));
      return false;
    }
  };

  const title = target.kind === "match" ? t("scheduleDeadline.title") : t("scheduleDeadline.bulkTitle");
  return (
    <ConfirmActionDialog
      title={title}
      confirmLabel={t("scheduleDeadline.save")}
      pendingLabel={t("scheduleDeadline.saving")}
      tone="primary"
      focusContent
      onClose={onClose}
      onConfirm={save}
    >
      <InfoHintRow>
        <p>
          {target.kind === "match" ? target.label : t("scheduleDeadline.bulkScope", { count: target.count })}
        </p>
        <InfoHint id="schedule-deadline-hint" subject={title}>
          <p>{t("scheduleDeadline.hint")}</p>
        </InfoHint>
      </InfoHintRow>
      <div className="field">
        <label htmlFor={FIELD_IDS.day}>{t("scheduleDeadline.day")}</label>
        <select
          id={FIELD_IDS.day}
          value={day}
          data-autofocus
          onChange={(event) => {
            setDay(event.target.value);
            fieldErrors.clear("day");
          }}
          {...fieldErrors.aria("day")}
        >
          <option value={NONE}>{t("scheduleDeadline.none")}</option>
          {days.map((each) => (
            <option key={each} value={each}>
              {dayLabel(each, locale)}
            </option>
          ))}
        </select>
        <FieldErrorText fieldId={FIELD_IDS.day} message={fieldErrors.message("day")} />
      </div>
      <div className="field">
        <label htmlFor={HOUR_ID}>{t("scheduleDeadline.hour")}</label>
        <select
          id={HOUR_ID}
          value={hour}
          disabled={day === NONE}
          onChange={(event) => setHour(Number.parseInt(event.target.value, 10))}
        >
          {HOURS.map((each) => (
            <option key={each} value={each}>
              {`${String(each).padStart(2, "0")}:00`}
            </option>
          ))}
        </select>
      </div>
    </ConfirmActionDialog>
  );
}
