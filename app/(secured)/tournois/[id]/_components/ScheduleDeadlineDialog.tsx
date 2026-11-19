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
  deadlineEntryChoices,
  deadlineEntryHours,
  deadlineEntryStart,
  deadlineFromEntry,
  scheduleOpenedAt,
  suggestedScheduleDeadline,
  type OpenedAtMatch,
} from "@/lib/shared/schedule-deadline";
import { useActionsText } from "../_lib/actions-text";
import { useMapError } from "../_lib/error-map";

const FIELD_IDS = { day: "schedule-deadline-day", hour: "schedule-deadline-hour" } as const;
/** Option « aucune date butoir » du jour : enregistrer l'efface. */
const NONE = "";

/** Ce que la fenêtre écrit : un match, ou tous les matchs à planifier d'un tournoi. */
export type ScheduleDeadlineTarget =
  | { kind: "match"; matchId: number; team1Name: string | null; team2Name: string | null; deadlineAt: string | null }
  | { kind: "tournament"; tournamentId: number; count: number };

/** Le toast de réussite : un match, ou le nombre de matchs d'une saisie en masse. */
function successText(t: ReturnType<typeof useActionsText>["t"], kind: ScheduleDeadlineTarget["kind"], cleared: boolean, count: number): string {
  if (kind === "tournament") return t(cleared ? "scheduleDeadline.bulkCleared" : "scheduleDeadline.bulkSaved", { count });
  return t(cleared ? "scheduleDeadline.cleared" : "scheduleDeadline.saved");
}

/** « mar. 18 nov. » : un jour de Paris (`AAAA-MM-JJ`), lu à midi UTC pour ne pas glisser d'un jour. */
function dayLabel(day: string, locale: "fr" | "en"): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

/**
 * Date butoir de planification (`docs/features/SCHEDULE_DEADLINE.md`) : un
 * jour et une heure pile, **heure de Paris**. Préremplie par la date butoir en
 * place, sinon par celle d'usage : 21:00, deux jours après l'**ouverture** de
 * la planification — la fin du dernier match joué qui alimente ce match (sinon du tournoi)
 * (`scheduleOpenedAt`), pas l'instant où la fenêtre s'ouvre. « Aucune »
 * l'efface. Portée et piège de focus : `ConfirmActionDialog`.
 */
export function ScheduleDeadlineDialog({
  target,
  matches,
  onClose,
}: Readonly<{
  target: ScheduleDeadlineTarget;
  /** Matchs du tournoi : la fin du dernier joué ouvre la planification. */
  matches: readonly OpenedAtMatch[];
  onClose: () => void;
}>) {
  const text = useActionsText();
  const { t, locale } = text;
  const mapError = useMapError();
  const { showError, showSuccess } = useToast();
  const fieldErrors = useFieldErrors(SCHEDULE_DEADLINE_FIELD_ERRORS, FIELD_IDS);
  const [now] = useState(() => Date.now());
  const current = target.kind === "match" && target.deadlineAt !== null ? Date.parse(target.deadlineAt) : null;
  const [suggested] = useState(() => suggestedScheduleDeadline(scheduleOpenedAt(matches, now, target.kind === "match" ? target.matchId : null), now));
  // Une date butoir en place déjà passée (ou à moins de 24 heures) ne se rejoue pas : on repart de la proposée.
  const initial = deadlineEntryStart(current, suggested, now);
  const days = useMemo(() => deadlineEntryChoices(now, initial.fromCurrent ? initial.day : null), [now, initial.day, initial.fromCurrent]);
  const [day, setDay] = useState<string>(days.includes(initial.day) ? initial.day : (days[0] ?? NONE));
  const hours = useMemo(() => (day === NONE ? [] : deadlineEntryHours(day, now)), [day, now]);
  const [pickedHour, setHour] = useState<number>(initial.hour);
  // Aujourd'hui, les heures trop proches ne sont pas proposées : une heure choisie plus tôt glisse vers la première permise.
  const hour = hours.includes(pickedHour) ? pickedHour : (hours[0] ?? pickedHour);

  const save = async (): Promise<boolean> => {
    const at = day === NONE ? null : deadlineFromEntry(day, hour);
    if (day !== NONE && (at === null || !hours.includes(hour))) {
      const message = mapError(at === null ? "INVALID_SCHEDULE_DEADLINE" : "SCHEDULE_DEADLINE_TOO_SOON");
      fieldErrors.flag(at === null ? "day" : "hour", message);
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
      showSuccess(successText(t, target.kind, at === null, payload.count ?? 0));
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
          {target.kind === "match"
            ? t("scheduleDeadline.matchLabel", {
                team1: target.team1Name ?? t("scheduleDeadline.tbd"),
                team2: target.team2Name ?? t("scheduleDeadline.tbd"),
              })
            : t("scheduleDeadline.bulkScope", { count: target.count })}
        </p>
        <InfoHint id="schedule-deadline-hint" subject={title}>
          <p>{t("scheduleDeadline.hint")}</p>
          {target.kind === "tournament" && <p>{t("scheduleDeadline.bulkHint")}</p>}
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
        <label htmlFor={FIELD_IDS.hour}>{t("scheduleDeadline.hour")}</label>
        <select
          id={FIELD_IDS.hour}
          value={hour}
          disabled={day === NONE}
          onChange={(event) => {
            setHour(Number.parseInt(event.target.value, 10));
            fieldErrors.clear("hour");
          }}
          {...fieldErrors.aria("hour")}
        >
          {(day === NONE ? [hour] : hours).map((each) => (
            <option key={each} value={each}>
              {`${String(each).padStart(2, "0")}:00`}
            </option>
          ))}
        </select>
        <FieldErrorText fieldId={FIELD_IDS.hour} message={fieldErrors.message("hour")} />
      </div>
    </ConfirmActionDialog>
  );
}
