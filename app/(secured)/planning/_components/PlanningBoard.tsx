"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Star, X } from "lucide-react";
import { Pill } from "@/components/cyber/Pill";
import { PlayerLink, TeamLink } from "@/components/entity-link";
import { BusyButton } from "@/components/ui/busy-button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { NumberInput } from "@/components/ui/number-input";
import { useToast } from "@/components/ui/toast";
import type { Messages } from "@/lib/shared/i18n-messages";
import type { Locale } from "@/lib/shared/locales";
import { AVAILABILITY_STATUSES, type AvailabilityStatus, type PlanningRole } from "@/lib/shared/planning";
import { PLANNING_DURATION_BOUNDS, type PlanningDurationSettings } from "@/lib/shared/planning-durations";
import type {
  AutoAssignReport,
  ConfirmReport,
  PlanningEntrant,
  PlanningEntryView,
  PlanningView,
} from "@/lib/shared/planning-view";
import { scopedText } from "@/lib/shared/scoped-text";
import {
  COVERAGE_PILL,
  candidatesFor,
  errorKey,
  groupByWeek,
  hasProvisional,
  leadUntil,
  weekWindow,
} from "../_lib/planning-board";
import styles from "../planning.module.css";

type PlanningMessages = Messages["planning"];
type Text = ReturnType<typeof scopedText<PlanningMessages>>;

const TIME_ZONE = "Europe/Paris";

function formatters(locale: Locale) {
  const tag = locale === "fr" ? "fr-FR" : "en-GB";
  return {
    slot: new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE }),
    time: new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE }),
    day: new Intl.DateTimeFormat(tag, { day: "numeric", month: "long", timeZone: "UTC" }),
  };
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new Error("NETWORK_ERROR");
  }
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "generic");
  return payload;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/**
 * L'écran « Planning » (permission `planning`) : chaque créneau à venir, sa
 * couverture et qui le tient ; sa disponibilité par rôle tenu ; pour le staff
 * des tournois, la désignation à la main, le calcul par semaine, la
 * confirmation et les durées estimées.
 */
export function PlanningBoard({ locale, messages }: Readonly<{ locale: Locale; messages: PlanningMessages }>) {
  const text = useMemo(() => scopedText(locale, messages), [locale, messages]);
  const { t } = text;
  const format = useMemo(() => formatters(locale), [locale]);
  const { showError, showSuccess } = useToast();
  const [view, setView] = useState<PlanningView | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [runWeek, setRunWeek] = useState<number | null>(null);

  const fail = useCallback(
    (error: unknown) => showError(t(`errors.${errorKey((error as Error).message, messages.errors)}` as never)),
    [showError, t, messages.errors],
  );

  const load = useCallback(async () => {
    try {
      const body = await call<{ planning: PlanningView }>("/api/planning");
      setView(body.planning);
    } catch (error) {
      fail(error);
    }
  }, [fail]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Un geste à la fois ; la page se relit après chacun, réussi ou non. */
  const act = useCallback(
    async <T,>(gesture: string, task: () => Promise<T>, success: (result: T) => string): Promise<boolean> => {
      if (pending !== null) return false;
      setPending(gesture);
      try {
        const result = await task();
        showSuccess(success(result));
        return true;
      } catch (error) {
        fail(error);
        return false;
      } finally {
        await load();
        setPending(null);
      }
    },
    [pending, showSuccess, fail, load],
  );

  const refresh = async () => {
    if (pending !== null) return;
    setPending("refresh");
    await load();
    setPending(null);
  };

  const names = useMemo(() => new Map((view?.members ?? []).map((member) => [member.userId, member.pseudo])), [view]);
  const weeks = useMemo(() => groupByWeek(view?.entries ?? []), [view]);

  if (!view) {
    return (
      <p className={styles.empty} aria-busy="true">
        {t("loading")}
      </p>
    );
  }

  const isCaster = view.myRoles.includes("CASTER");
  const meSolo = view.members.find((member) => member.userId === view.me)?.soloCaster ?? false;

  return (
    <div className={styles.board}>
      <div className={styles.toolbar}>
        {isCaster && (
          <InfoHintRow>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={meSolo}
                aria-disabled={pending !== null || undefined}
                onChange={() =>
                  void act("solo:me", () => call("/api/planning/solo-caster", json("PUT", { solo: !meSolo })), () => t("saved.solo"))
                }
              />
              {t("solo.label")}
            </label>
            <InfoHint id="planning-solo-hint" subject={t("solo.label")}>
              {t("solo.hint")}
            </InfoHint>
          </InfoHintRow>
        )}
        <BusyButton busy={pending === "refresh"} blocked={pending !== null} className={styles.button} onClick={() => void refresh()}>
          {t("refresh")}
        </BusyButton>
      </div>

      {view.canManage && <StaffPanel text={text} view={view} pending={pending} act={act} />}

      {weeks.length === 0 ? (
        <p className={styles.empty}>{t("empty")}</p>
      ) : (
        weeks.map((week) => (
          <section key={week.weekStart} className={styles.week} aria-labelledby={`planning-week-${week.weekStart}`}>
            <header className={styles.weekHead}>
              <h2 id={`planning-week-${week.weekStart}`} className={styles.weekTitle}>
                {t("week", { date: format.day.format(week.weekStart) })}
              </h2>
              {view.canManage && week.entries.some((entry) => entry.open) && (
                <BusyButton
                  busy={pending === `run:${week.weekStart}`}
                  blocked={pending !== null}
                  className={styles.button}
                  onClick={() => setRunWeek(week.weekStart)}
                >
                  {t("staff.runWeek")}
                </BusyButton>
              )}
            </header>
            <ul className={styles.entries}>
              {week.entries.map((entry) => (
                <EntryCard
                  key={entry.key}
                  entry={entry}
                  view={view}
                  text={text}
                  names={names}
                  slot={format.slot.format(Date.parse(entry.startAt))}
                  until={format.time.format(Date.parse(entry.endAt))}
                  pending={pending}
                  act={act}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {runWeek !== null && (
        <ConfirmActionDialog
          title={t("staff.runTitle", { date: format.day.format(runWeek) })}
          confirmLabel={t("staff.runConfirm")}
          pendingLabel={t("staff.running")}
          tone="primary"
          onClose={() => setRunWeek(null)}
          onConfirm={() =>
            act(
              `run:${runWeek}`,
              () => call<{ report: AutoAssignReport }>("/api/admin/planning/auto-assign", json("POST", weekWindow(runWeek))),
              ({ report }) => t("staff.runDone", { proposed: report.proposed, entries: report.entries }),
            )
          }
        >
          <p>{t("staff.runBody")}</p>
        </ConfirmActionDialog>
      )}
    </div>
  );
}

type Act = <T>(gesture: string, task: () => Promise<T>, success: (result: T) => string) => Promise<boolean>;

function Entrant({ entrant, text }: Readonly<{ entrant: PlanningEntrant | null; text: Text }>) {
  if (!entrant) return <span className={styles.muted}>{text.t("tbd")}</span>;
  return entrant.soloUserId === null ? (
    <TeamLink teamId={entrant.teamId}>{entrant.name}</TeamLink>
  ) : (
    <PlayerLink userId={entrant.soloUserId}>{entrant.name}</PlayerLink>
  );
}

function EntryCard({
  entry,
  view,
  text,
  names,
  slot,
  until,
  pending,
  act,
}: Readonly<{
  entry: PlanningEntryView;
  view: PlanningView;
  text: Text;
  names: ReadonlyMap<number, string>;
  slot: string;
  until: string;
  pending: string | null;
  act: Act;
}>) {
  const { t } = text;
  const coverage = entry.coverage;
  let title = "";
  if (entry.kind === "TOURNAMENT") title = t("event");
  else if (entry.roundNumber !== null) title = t("round", { round: entry.roundNumber });
  const label = `${entry.tournamentName} · ${slot}`;
  return (
    <li className={styles.entry} data-tap-zone>
      <div className={styles.entryHead}>
        <div className={styles.entryWhen}>
          <span className={styles.slot}>{slot}</span>
          <span className={styles.muted}>{t("until", { time: until })}</span>
        </div>
        <div className={styles.pills}>
          <Pill variant={COVERAGE_PILL[coverage.level]}>{t(`coverage.${coverage.level}`)}</Pill>
          {coverage.refereePriority && <Pill variant="warning">{t("coverage.priority")}</Pill>}
          {coverage.casterNeedsProd && <Pill variant="neutral">{t("coverage.needsProd")}</Pill>}
          {coverage.idleProds > 0 && <Pill variant="neutral">{t("coverage.idleProds")}</Pill>}
          {hasProvisional(entry) && <Pill variant="waiting">{t("assignment.provisional")}</Pill>}
          {entry.hidden && <Pill variant="neutral">{t("hidden")}</Pill>}
        </div>
      </div>
      <p className={styles.entryWhat}>
        <span className={styles.tournament}>{entry.tournamentName}</span>
        {title && <span className={styles.muted}> · {title}</span>}
      </p>
      {entry.kind === "MATCH" && (
        <p className={styles.teams}>
          <Entrant entrant={entry.team1} text={text} /> <span className={styles.muted}>{t("versus")}</span>{" "}
          <Entrant entrant={entry.team2} text={text} />
        </p>
      )}

      <dl className={styles.roles}>
        {(["REFEREE", "CASTER", "PROD"] as const).map((role) => (
          <RoleRow key={role} role={role} entry={entry} view={view} text={text} names={names} pending={pending} act={act} />
        ))}
      </dl>

      {view.myRoles.length > 0 && <MyAvailability entry={entry} view={view} text={text} pending={pending} act={act} />}

      {view.canManage && entry.open && hasProvisional(entry) && (
        <BusyButton
          busy={pending === `confirm:${entry.key}`}
          blocked={pending !== null}
          className={styles.button}
          aria-label={t("staff.confirmEntryLabel", { slot: label })}
          onClick={() =>
            void act(
              `confirm:${entry.key}`,
              () => call<{ report: ConfirmReport }>("/api/admin/planning/confirm", json("POST", { entryKeys: [entry.key] })),
              ({ report }) => t("staff.confirmDone", { confirmed: report.confirmed, refused: report.refused }),
            )
          }
        >
          {t("staff.confirmEntry")}
        </BusyButton>
      )}
    </li>
  );
}

function RoleRow({
  role,
  entry,
  view,
  text,
  names,
  pending,
  act,
}: Readonly<{
  role: PlanningRole;
  entry: PlanningEntryView;
  view: PlanningView;
  text: Text;
  names: ReadonlyMap<number, string>;
  pending: string | null;
  act: Act;
}>) {
  const { t } = text;
  const rows = entry.assignments.filter((row) => row.role === role);
  const selectId = useId();
  const roleName = t(`roles.${role}`);
  const manage = view.canManage && entry.editable;
  const candidates = manage ? candidatesFor(entry, role, view.members) : [];
  const assign = (userId: number, assigned: boolean) =>
    act(
      `assign:${entry.key}:${role}:${userId}`,
      () => call("/api/admin/planning/assignment", json("PUT", { entryKey: entry.key, role, userId, assigned })),
      () => t(assigned ? "saved.assigned" : "saved.removed"),
    );
  return (
    <div className={styles.roleRow}>
      <dt className={styles.roleName}>{roleName}</dt>
      <dd className={styles.roleWho}>
        {rows.length === 0 && <span className={styles.muted}>{t("assignment.nobody")}</span>}
        {rows.map((row) => {
          const name = names.get(row.userId) ?? `#${row.userId}`;
          return (
            <span key={row.userId} className={styles.person} data-provisional={row.provisional || undefined}>
              <PlayerLink userId={row.userId}>{name}</PlayerLink>
              <span className={`cy-tag ${row.provisional ? "cy-tag-accent" : "cy-tag-info"} ${styles.reason}`}>
                {t(`assignment.reason.${row.reason}`)}
                {row.provisional ? ` · ${t("assignment.provisional")}` : ""}
              </span>
              {manage && row.source !== "CAST" && (
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={t("assignment.remove", { name, role: roleName })}
                  aria-disabled={pending !== null || undefined}
                  onClick={() => pending === null && void assign(row.userId, false)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </span>
          );
        })}
        {manage && candidates.length > 0 && (
          <>
            <label htmlFor={selectId} className="sr-only">
              {t("assignment.add", { role: roleName })}
            </label>
            <select
              id={selectId}
              className={styles.select}
              value=""
              aria-disabled={pending !== null || undefined}
              onChange={(event) => {
                const userId = Number.parseInt(event.target.value, 10);
                if (pending === null && Number.isSafeInteger(userId) && userId > 0) void assign(userId, true);
              }}
            >
              <option value="">{t("assignment.add", { role: roleName })}</option>
              {candidates.map(({ member, status, preferred }) => (
                <option key={member.userId} value={member.userId}>
                  {t(preferred ? "assignment.optionPreferred" : "assignment.option", {
                    name: member.pseudo,
                    status: status ? t(`status.${status}`) : t("assignment.unknown"),
                  })}
                </option>
              ))}
            </select>
          </>
        )}
      </dd>
    </div>
  );
}

function MyAvailability({
  entry,
  view,
  text,
  pending,
  act,
}: Readonly<{ entry: PlanningEntryView; view: PlanningView; text: Text; pending: string | null; act: Act }>) {
  const { t } = text;
  if (!entry.open) return <p className={styles.muted}>{t("mine.closed")}</p>;
  const save = (role: PlanningRole, status: AvailabilityStatus, preferred: boolean) =>
    act(
      `mine:${entry.key}:${role}`,
      () => call("/api/planning/availability", json("PUT", { entryKey: entry.key, role, status, preferred })),
      () => t("saved.availability"),
    );
  return (
    <div className={styles.mine}>
      {view.myRoles.map((role) => {
        const roleName = t(`roles.${role}`);
        const current = entry.mine.find((row) => row.role === role);
        const preferred = current?.preferred ?? false;
        return (
          <fieldset key={role} className={`native-group ${styles.segmented}`} data-tap-zone>
            <legend className={styles.legend}>{t("mine.legend", { role: roleName })}</legend>
            {AVAILABILITY_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                className={styles.segment}
                aria-pressed={current?.status === status}
                aria-disabled={pending !== null || undefined}
                onClick={() => pending === null && void save(role, status, status === "AVAILABLE" ? preferred : false)}
              >
                {t(`status.${status}`)}
              </button>
            ))}
            <button
              type="button"
              className={styles.star}
              aria-pressed={preferred}
              aria-label={t(preferred ? "mine.preferOn" : "mine.preferOff", { role: roleName })}
              aria-disabled={pending !== null || undefined}
              onClick={() => pending === null && void save(role, preferred ? (current?.status ?? "AVAILABLE") : "AVAILABLE", !preferred)}
            >
              <Star size={15} aria-hidden="true" fill={preferred ? "currentColor" : "none"} />
            </button>
          </fieldset>
        );
      })}
    </div>
  );
}

function StaffPanel({
  text,
  view,
  pending,
  act,
}: Readonly<{ text: Text; view: PlanningView; pending: string | null; act: Act }>) {
  const { t } = text;
  const [hours, setHours] = useState(48);
  const [durations, setDurations] = useState<PlanningDurationSettings>(view.durations);
  const casters = view.members.filter((member) => member.roles.includes("CASTER"));
  const b = PLANNING_DURATION_BOUNDS;
  const field = (
    id: string,
    label: string,
    value: number,
    [min, max]: readonly [number, number],
    change: (value: number) => PlanningDurationSettings,
  ) => (
    <label className={styles.field} htmlFor={id}>
      <span>{label}</span>
      <NumberInput id={id} className={styles.number} min={min} max={max} step={1} value={value} onValueChange={(next) => setDurations(change(next))} />
    </label>
  );
  return (
    <section className={styles.staff} aria-labelledby="planning-staff-title">
      <InfoHintRow>
        <h2 id="planning-staff-title" className={styles.weekTitle}>
          {t("staff.title")}
        </h2>
        <InfoHint id="planning-staff-hint" subject={t("staff.title")}>
          {t("staff.hint")}
        </InfoHint>
        <InfoHint id="planning-reason-hint" subject={t("assignment.reasonSubject")}>
          {t("assignment.reasonHint")}
        </InfoHint>
        <InfoHint id="planning-coverage-hint" subject={t("coverage.label")}>
          {t("coverage.hint")}
        </InfoHint>
      </InfoHintRow>

      <div className={styles.staffRow}>
        <label className={styles.field} htmlFor="planning-lead-hours">
          <span>{t("staff.leadLabel")}</span>
          <NumberInput id="planning-lead-hours" className={styles.number} min={1} max={744} step={1} value={hours} onValueChange={setHours} />
        </label>
        <BusyButton
          busy={pending === "confirm:lead"}
          blocked={pending !== null || hours < 1 || hours > 744}
          className={styles.button}
          onClick={() =>
            void act(
              "confirm:lead",
              () => call<{ report: ConfirmReport }>("/api/admin/planning/confirm", json("POST", { until: leadUntil(Date.now(), hours) })),
              ({ report }) => t("staff.confirmDone", { confirmed: report.confirmed, refused: report.refused }),
            )
          }
        >
          {t("staff.confirmLead")}
        </BusyButton>
      </div>

      {casters.length > 0 && (
        <fieldset className={styles.solo}>
          <legend className={styles.legend}>{t("solo.staffTitle")}</legend>
          {casters.map((member) => (
            <label key={member.userId} className={styles.check}>
              <input
                type="checkbox"
                checked={member.soloCaster}
                aria-disabled={pending !== null || undefined}
                onChange={() =>
                  pending === null &&
                  void act(
                    `solo:${member.userId}`,
                    () => call("/api/planning/solo-caster", json("PUT", { solo: !member.soloCaster, userId: member.userId })),
                    () => t("saved.solo"),
                  )
                }
              />
              {member.pseudo}
            </label>
          ))}
        </fieldset>
      )}

      <details className={styles.settings}>
        <summary>{t("settings.title")}</summary>
        <InfoHintRow>
          <span className={styles.muted}>{t("settings.title")}</span>
          <InfoHint id="planning-durations-hint" subject={t("settings.title")}>
            {t("settings.hint")}
          </InfoHint>
        </InfoHintRow>
        <div className={styles.fields}>
          {field("planning-map-ow", t("settings.mapOW"), durations.mapMinutes.OW, b.mapMinutes, (v) => ({ ...durations, mapMinutes: { ...durations.mapMinutes, OW: v } }))}
          {field("planning-map-mr", t("settings.mapMR"), durations.mapMinutes.MR, b.mapMinutes, (v) => ({ ...durations, mapMinutes: { ...durations.mapMinutes, MR: v } }))}
          {field("planning-buffer", t("settings.buffer"), durations.bufferMinutes, b.bufferMinutes, (v) => ({ ...durations, bufferMinutes: v }))}
          {field("planning-maps", t("settings.defaultMaps"), durations.defaultMaps, b.defaultMaps, (v) => ({ ...durations, defaultMaps: v }))}
          {field("planning-event", t("settings.eventHours"), durations.eventHours, b.eventHours, (v) => ({ ...durations, eventHours: v }))}
        </div>
        <BusyButton
          busy={pending === "settings"}
          blocked={pending !== null}
          className={styles.button}
          onClick={() =>
            void act("settings", () => call("/api/admin/planning/settings", json("PUT", durations)), () => t("settings.saved"))
          }
        >
          {t("settings.save")}
        </BusyButton>
      </details>
    </section>
  );
}
