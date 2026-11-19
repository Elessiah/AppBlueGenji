"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Star, X } from "lucide-react";
import { Pill } from "@/components/cyber/Pill";
import { PlayerLink, TeamLink } from "@/components/entity-link";
import { BusyButton } from "@/components/ui/busy-button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { NumberInput } from "@/components/ui/number-input";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { useToast } from "@/components/ui/toast";
import { useClock } from "@/lib/shared/hooks/useClock";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import type { Messages } from "@/lib/shared/i18n-messages";
import type { Locale } from "@/lib/shared/locales";
import {
  AVAILABILITY_STATUSES,
  LATE_WITHDRAWAL_MS,
  WITHDRAWAL_FIELD_ERRORS,
  WITHDRAWAL_REASON_MAX,
  type AvailabilityStatus,
  type PlanningRole,
} from "@/lib/shared/planning";
import { PLANNING_DURATION_BOUNDS, type PlanningDurationSettings } from "@/lib/shared/planning-durations";
import type {
  AutoAssignReport,
  ConfirmReport,
  PlanningEntrant,
  PlanningEntryView,
  PlanningView,
  WithdrawalResponse,
} from "@/lib/shared/planning-view";
import { scopedText } from "@/lib/shared/scoped-text";
import {
  COVERAGE_PILL,
  NO_FILTERS,
  applyAvailability,
  castersFullKind,
  roleChoices,
  canWithdraw,
  errorKey,
  filterEntries,
  filtersActive,
  groupByWeek,
  hasProvisional,
  heldBy,
  isThrottled,
  leadUntil,
  mergeView,
  tournamentChoices,
  weekWindow,
  withdrawBodyKey,
  withdrawDoneKey,
  type PlanningFilters,
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
    day: new Intl.DateTimeFormat(tag, { day: "numeric", month: "long", timeZone: TIME_ZONE }),
    dayLong: new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", timeZone: TIME_ZONE }),
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
  const [confirming, setConfirming] = useState<ConfirmTarget | null>(null);
  const [filters, setFilters] = useState<PlanningFilters>(NO_FILTERS);
  const [withdrawing, setWithdrawing] = useState<WithdrawTarget | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const reasonErrors = useFieldErrors(WITHDRAWAL_FIELD_ERRORS, WITHDRAWAL_FIELD_IDS);

  const fail = useCallback(
    (error: unknown) => showError(t(`errors.${errorKey((error as Error).message, messages.errors)}` as never)),
    [showError, t, messages.errors],
  );

  const load = useCallback(async () => {
    try {
      const body = await call<{ planning: PlanningView }>("/api/planning");
      setView((previous) => mergeView(previous, body.planning));
    } catch (error) {
      fail(error);
    }
  }, [fail]);

  useEffect(() => {
    void load();
  }, [load]);

  // Le geste en cours se lit dans une référence : `act` garde ainsi la même
  // identité d'un geste à l'autre, et les cartes mémoïsées ne se redessinent pas.
  const pendingRef = useRef<string | null>(null);

  /**
   * Un geste à la fois ; la page se relit après chacun, réussi ou non — sauf
   * si `patch` dit comment le poser à la main sur la page (la disponibilité :
   * le geste le plus fréquent), le geste réussi ne coûte alors aucune relecture,
   * et sauf un geste refusé pour excès (`TOO_MANY_REQUESTS`) : rien n'a changé,
   * et relire userait le quota des lectures.
   */
  const act = useCallback(
    async <T,>(gesture: string, task: () => Promise<T>, success: (result: T) => string, patch?: () => void): Promise<boolean> => {
      if (pendingRef.current !== null) return false;
      pendingRef.current = gesture;
      setPending(gesture);
      let skipReload = false;
      try {
        const result = await task();
        showSuccess(success(result));
        if (patch) {
          patch();
          skipReload = true;
        }
        return true;
      } catch (error) {
        skipReload = isThrottled(error);
        fail(error);
        return false;
      } finally {
        if (!skipReload) await load();
        pendingRef.current = null;
        setPending(null);
      }
    },
    [showSuccess, fail, load],
  );

  const refresh = async () => {
    if (pendingRef.current !== null) return;
    pendingRef.current = "refresh";
    setPending("refresh");
    await load();
    pendingRef.current = null;
    setPending(null);
  };

  const confirmEntry = useCallback((key: string, slot: string) => setConfirming({ kind: "entry", key, slot }), []);
  const clearReasonError = reasonErrors.clear;
  const askWithdraw = useCallback(
    (target: WithdrawTarget) => {
      setWithdrawReason("");
      clearReasonError();
      setWithdrawing(target);
    },
    [clearReasonError],
  );
  const saveAvailability = useCallback(
    (change: Parameters<typeof applyAvailability>[1]) => setView((current) => (current ? applyAvailability(current, change) : current)),
    [],
  );

  const members = view?.members;
  const names = useMemo(() => new Map((members ?? []).map((member) => [member.userId, member.pseudo])), [members]);
  // Ce que les cartes lisent du lecteur : stable tant que ces quatre valeurs le sont.
  const me = view?.me;
  const myRoles = view?.myRoles;
  const canManage = view?.canManage;
  const context = useMemo(
    () => (me === undefined || !myRoles || canManage === undefined || !members ? null : { me, myRoles, canManage, members }),
    [me, myRoles, canManage, members],
  );
  const shown = useMemo(() => filterEntries(view?.entries ?? [], filters, view?.me ?? 0), [view, filters]);
  const weeks = useMemo(() => groupByWeek(shown), [shown]);
  const tournaments = useMemo(() => tournamentChoices(view?.entries ?? []), [view]);
  // Un tournoi choisi qui n'a plus de créneau (relecture) : le filtre retombe sur « tous ».
  const tournamentId = tournaments.some((choice) => choice.id === filters.tournamentId) ? filters.tournamentId : null;
  // …et l'oublie : il ne se réappliquerait pas seul quand ce tournoi revient, alors que la liste disait « tous ».
  const staleTournament = view !== null && filters.tournamentId !== null && tournamentId === null;
  useEffect(() => {
    if (staleTournament) setFilters((current) => ({ ...current, tournamentId: null }));
  }, [staleTournament]);

  if (!view || !context) {
    return (
      <p className={styles.empty} aria-busy="true">
        {t("loading")}
      </p>
    );
  }

  const isCaster = view.myRoles.includes("CASTER");
  const meSolo = view.members.find((member) => member.userId === view.me)?.soloCaster ?? false;

  const active = filtersActive({ ...filters, tournamentId });
  const patch = (change: Partial<PlanningFilters>) => setFilters({ ...filters, tournamentId, ...change });
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

      <section className={styles.filters} aria-label={t("filters.label")}>
        <div className={styles.filterRow} data-tap-zone>
          <button type="button" className={styles.chip} aria-pressed={filters.mine} onClick={() => patch({ mine: !filters.mine })}>
            {t("filters.mine")}
          </button>
          <button
            type="button"
            className={styles.chip}
            aria-pressed={filters.uncovered}
            onClick={() => patch({ uncovered: !filters.uncovered })}
          >
            {t("filters.uncovered")}
          </button>
          <label className={styles.tournamentFilter}>
            <span className="sr-only">{t("filters.tournament")}</span>
            <select
              className={styles.select}
              value={tournamentId ?? ""}
              onChange={(event) => {
                const id = Number.parseInt(event.target.value, 10);
                patch({ tournamentId: Number.isSafeInteger(id) && id > 0 ? id : null });
              }}
            >
              <option value="">{t("filters.allTournaments")}</option>
              {tournaments.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
            </select>
          </label>
          {active && (
            <button type="button" className={styles.linkButton} onClick={() => setFilters(NO_FILTERS)}>
              {t("filters.reset")}
            </button>
          )}
        </div>
        <div className={styles.hints}>
          <InfoHintRow>
            <span className={styles.muted}>{t("filters.label")}</span>
            <InfoHint id="planning-filters-hint" subject={t("filters.label")}>
              {t("filters.hint")}
            </InfoHint>
          </InfoHintRow>
          <InfoHintRow>
            <span className={styles.muted}>{t("coverage.label")}</span>
            <InfoHint id="planning-coverage-hint" subject={t("coverage.label")}>
              {t("coverage.hint")}
            </InfoHint>
          </InfoHintRow>
          <InfoHintRow>
            <span className={styles.muted}>{t("assignment.reasonSubject")}</span>
            <InfoHint id="planning-reason-hint" subject={t("assignment.reasonSubject")}>
              {t("assignment.reasonHint")}
            </InfoHint>
          </InfoHintRow>
        </div>
        <output className={styles.count}>{t("filters.count", { shown: shown.length, total: view.entries.length })}</output>
      </section>

      {view.canManage && (
        <StaffPanel text={text} view={view} pending={pending} act={act} onConfirmLead={(hours) => setConfirming({ kind: "lead", hours })} />
      )}

      {weeks.length === 0 ? (
        <p className={styles.empty}>{t(view.entries.length === 0 ? "empty" : "filters.empty")}</p>
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
            {week.days.map((day) => (
              <div key={day.dayStart} className={styles.day}>
                <h3 className={styles.dayTitle}>{format.dayLong.format(day.dayStart)}</h3>
                <ul className={styles.entries}>
                  {day.entries.map((entry) => {
                    const slot = format.slot.format(Date.parse(entry.startAt));
                    return (
                      <EntryCard
                        key={entry.key}
                        entry={entry}
                        view={context}
                        text={text}
                        names={names}
                        slot={slot}
                        until={format.time.format(Date.parse(entry.endAt))}
                        confirmAt={entry.confirmAt === null ? null : format.slot.format(Date.parse(entry.confirmAt))}
                        deadline={entry.deadlineAt === null ? null : format.slot.format(Date.parse(entry.deadlineAt))}
                        pending={pendingFor(pending, entry.key)}
                        act={act}
                        onConfirm={confirmEntry}
                        onAvailability={saveAvailability}
                        onWithdraw={askWithdraw}
                      />
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        ))
      )}

      {confirming !== null && (
        <ConfirmActionDialog
          title={confirming.kind === "entry" ? t("staffConfirm.entryTitle") : t("staffConfirm.leadTitle", { hours: confirming.hours })}
          confirmLabel={t("staffConfirm.confirm")}
          pendingLabel={t("staffConfirm.pending")}
          tone="primary"
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            const body = confirming.kind === "entry" ? { entryKeys: [confirming.key] } : { until: leadUntil(Date.now(), confirming.hours) };
            return act(
              confirming.kind === "entry" ? `confirm:${confirming.key}` : "confirm:lead",
              () => call<{ report: ConfirmReport }>("/api/admin/planning/confirm", json("POST", body)),
              ({ report }) => t("staff.confirmDone", { confirmed: report.confirmed, refused: report.refused }),
            );
          }}
        >
          {confirming.kind === "entry" && <p>{confirming.slot}</p>}
          <p>{t(confirming.kind === "entry" ? "staffConfirm.entryBody" : "staffConfirm.leadBody")}</p>
        </ConfirmActionDialog>
      )}

      {withdrawing !== null && (
        <ConfirmActionDialog
          title={t("withdraw.title")}
          confirmLabel={t("withdraw.confirm")}
          pendingLabel={t("withdraw.pending")}
          focusContent
          onClose={() => setWithdrawing(null)}
          onConfirm={() =>
            act(
              `withdraw:${withdrawing.key}:${withdrawing.role}`,
              async () => {
                try {
                  return await call<WithdrawalResponse>(
                    "/api/planning/withdrawal",
                    json("POST", { entryKey: withdrawing.key, role: withdrawing.role, reason: withdrawReason.trim() || null }),
                  );
                } catch (error) {
                  // Un refus qui désigne le motif s'y rattache aussi (la notification part de `act`).
                  const code = (error as Error).message;
                  reasonErrors.report(code, t(`errors.${errorKey(code, messages.errors)}` as never));
                  throw error;
                }
              },
              (result) => t(withdrawDoneKey(result)),
            )
          }
        >
          <p>
            {withdrawing.slot} · {t(`roles.${withdrawing.role}`)}
          </p>
          <p>{t(withdrawBodyKey(withdrawing.role))}</p>
          {withdrawing.late && (
            <p className={styles.lateWarning}>
              <Pill variant="warning">{t("withdrawals.late")}</Pill> {t("withdraw.late")}
            </p>
          )}
          <div className="field">
            <label htmlFor={WITHDRAWAL_FIELD_IDS.reason}>{t("withdraw.reasonLabel")}</label>
            <textarea
              id={WITHDRAWAL_FIELD_IDS.reason}
              maxLength={WITHDRAWAL_REASON_MAX}
              value={withdrawReason}
              onChange={(event) => {
                setWithdrawReason(event.target.value);
                reasonErrors.clear("reason");
              }}
              {...reasonErrors.aria("reason")}
            />
            <span className={styles.muted} aria-hidden="true">
              {withdrawReason.length}/{WITHDRAWAL_REASON_MAX}
            </span>
            <FieldErrorText fieldId={WITHDRAWAL_FIELD_IDS.reason} message={reasonErrors.message("reason")} />
          </div>
        </ConfirmActionDialog>
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

/** Le désistement en attente de l'accord du membre : l'entrée, le rôle, s'il est tardif (moins de 24 h). */
type WithdrawTarget = { key: string; role: PlanningRole; slot: string; late: boolean };

/** Le champ du motif d'un désistement (refus rattaché, `useFieldErrors`). */
const WITHDRAWAL_FIELD_IDS = { reason: "planning-withdraw-reason" } as const;

/** Relue chaque minute : le bouton disparaît quand l'entrée commence, sans attendre une relecture de la page. */
const WITHDRAW_CLOCK_MS = 60_000;

function WithdrawButton({
  entry,
  role,
  slot,
  roleName,
  pending,
  onWithdraw,
  text,
}: Readonly<{
  entry: PlanningEntryView;
  role: PlanningRole;
  slot: string;
  roleName: string;
  pending: boolean;
  onWithdraw: (target: WithdrawTarget) => void;
  text: Text;
}>) {
  const { t } = text;
  // Plus d'horloge pour une entrée déjà commencée ou close : le bouton n'y reviendra pas.
  const now = useClock(WITHDRAW_CLOCK_MS, entry.editable && Date.parse(entry.startAt) > Date.now());
  if (now === null || !canWithdraw(entry, now)) return null;
  return (
    <button
      type="button"
      className={styles.linkButton}
      aria-label={t("withdraw.actionLabel", { role: roleName, slot })}
      aria-disabled={pending || undefined}
      onClick={() =>
        !pending && onWithdraw({ key: entry.key, role, slot, late: Date.parse(entry.startAt) - Date.now() < LATE_WITHDRAWAL_MS })
      }
    >
      {t("withdraw.action")}
    </button>
  );
}

/** Le geste de confirmation en attente de l'accord du staff : une entrée, ou ce qui commence dans `hours` heures. */
type ConfirmTarget = { kind: "entry"; key: string; slot: string } | { kind: "lead"; hours: number };

type Act = <T>(gesture: string, task: () => Promise<T>, success: (result: T) => string, patch?: () => void) => Promise<boolean>;

/** Ce que les cartes lisent du lecteur (et non toute la page : une relecture sans effet sur elles ne les redessine pas). */
type Reader = Pick<PlanningView, "me" | "myRoles" | "canManage" | "members">;

/**
 * Le geste en cours, vu d'une carte : le sien, ou `"other"` pour celui d'une
 * autre — la carte ne change de propriétés que si le geste la concerne.
 */
function pendingFor(pending: string | null, entryKey: string): string | null {
  if (pending === null) return null;
  return pending.endsWith(`:${entryKey}`) || pending.includes(`:${entryKey}:`) ? pending : "other";
}

function Entrant({ entrant, text }: Readonly<{ entrant: PlanningEntrant | null; text: Text }>) {
  if (!entrant) return <span className={styles.muted}>{text.t("tbd")}</span>;
  return entrant.soloUserId === null ? (
    <TeamLink teamId={entrant.teamId}>{entrant.name}</TeamLink>
  ) : (
    <PlayerLink userId={entrant.soloUserId}>{entrant.name}</PlayerLink>
  );
}

/** La ligne de confirmation d'office à venir (avec la date butoir qui la fixe, s'il y en a une). */
function confirmText(t: Text["t"], time: string, deadline: string | null): string {
  return deadline === null ? t("autoConfirm.at", { time }) : t("autoConfirm.atWithDeadline", { time, deadline });
}

const EntryCard = memo(function EntryCard({
  entry,
  view,
  text,
  names,
  slot,
  until,
  confirmAt,
  deadline,
  pending,
  act,
  onConfirm,
  onAvailability,
  onWithdraw,
}: Readonly<{
  entry: PlanningEntryView;
  view: Reader;
  text: Text;
  names: ReadonlyMap<number, string>;
  slot: string;
  until: string;
  /** Confirmation d'office (date déjà mise en forme), `null` : entrée close. */
  confirmAt: string | null;
  /** Date butoir de planification du match (mise en forme), `null` : aucune. */
  deadline: string | null;
  pending: string | null;
  act: Act;
  onConfirm: (key: string, slot: string) => void;
  onAvailability: (change: Parameters<typeof applyAvailability>[1]) => void;
  onWithdraw: (target: WithdrawTarget) => void;
}>) {
  const { t } = text;
  const coverage = entry.coverage;
  let title = "";
  if (entry.kind === "TOURNAMENT") title = t("event");
  else if (entry.roundNumber !== null) title = t("round", { round: entry.roundNumber });
  const label = `${entry.tournamentName} · ${slot}`;
  const mine = heldBy(entry, view.me);
  return (
    <li className={styles.entry} data-tap-zone data-mine={mine || undefined}>
      <div className={styles.entryHead}>
        <div className={styles.entryWhen}>
          <span className={styles.slot}>{slot}</span>
          <span className={styles.muted}>{t("until", { time: until })}</span>
        </div>
        <div className={styles.pills}>
          {mine && <Pill variant="highlight">{t("mineBadge")}</Pill>}
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
      {confirmAt !== null && !entry.confirmPending && (
        <p className={styles.confirmAt} data-testid="planning-confirm-at">
          {confirmText(t, confirmAt, deadline)}
        </p>
      )}
      {confirmAt !== null && entry.confirmPending && (
        <div className={styles.confirmPending} data-testid="planning-confirm-at">
          <InfoHintRow inline>
            <Pill variant="waiting">{t("autoConfirm.pending")}</Pill>
            <span className={styles.confirmAt}>{t("autoConfirm.pendingAt", { time: confirmAt })}</span>
            <InfoHint id={`planning-confirm-pending-${entry.key}`} subject={t("autoConfirm.pending")}>
              <p>{t("autoConfirm.pendingHint")}</p>
            </InfoHint>
          </InfoHintRow>
        </div>
      )}

      <dl className={styles.roles}>
        {(["REFEREE", "CASTER", "PROD"] as const).map((role) => (
          <RoleRow
            key={role}
            role={role}
            entry={entry}
            view={view}
            text={text}
            names={names}
            slot={label}
            pending={pending}
            act={act}
            onWithdraw={onWithdraw}
          />
        ))}
      </dl>

      {entry.withdrawals.length > 0 && <Withdrawals entry={entry} text={text} names={names} />}

      {view.myRoles.length > 0 && (
        <MyAvailability entry={entry} view={view} text={text} pending={pending} act={act} onSaved={onAvailability} />
      )}

      {view.canManage && entry.open && hasProvisional(entry) && (
        <BusyButton
          busy={pending === `confirm:${entry.key}`}
          blocked={pending !== null}
          className={styles.button}
          aria-label={t("staff.confirmEntryLabel", { slot: label })}
          onClick={() => onConfirm(entry.key, label)}
        >
          {t("staff.confirmEntry")}
        </BusyButton>
      )}
    </li>
  );
});

/**
 * Zone d'état du plafond de casters, montée dès un premier caster. Le texte
 * s'y pose après le montage : une zone qui naît déjà pleine (deux casters
 * posés d'un coup) ne serait pas annoncée.
 */
function CapStatus({ text }: { text: string | null }) {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => setShown(text), [text]);
  return (
    <span /* NOSONAR S6819 — région live d'état : l'apparition du plafond est annoncée */ role="status" className={styles.muted}>
      {shown}
    </span>
  );
}

const RoleRow = memo(function RoleRow({
  role,
  entry,
  view,
  text,
  names,
  slot,
  pending,
  act,
  onWithdraw,
}: Readonly<{
  role: PlanningRole;
  entry: PlanningEntryView;
  view: Reader;
  text: Text;
  names: ReadonlyMap<number, string>;
  slot: string;
  pending: string | null;
  act: Act;
  onWithdraw: (target: WithdrawTarget) => void;
}>) {
  const { t } = text;
  const rows = entry.assignments.filter((row) => row.role === role);
  const selectId = useId();
  const roleName = t(`roles.${role}`);
  // Plafond de casters atteint : plus de liste de choix (le serveur refuse aussi, `PLANNING_CASTERS_FULL`).
  const { manage, full, candidates } = useMemo(
    () => roleChoices(entry, role, view.members, view.canManage),
    [entry, role, view.members, view.canManage],
  );
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
        {entry.unfilled.includes(role) && <Pill variant="warning">{t("unfilled")}</Pill>}
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
              {row.userId === view.me && row.source !== "CAST" && (
                <WithdrawButton entry={entry} role={role} slot={slot} roleName={roleName} pending={pending !== null} onWithdraw={onWithdraw} text={text} />
              )}
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
        {role === "CASTER" && manage && rows.length > 0 && <CapStatus text={full ? t(`assignment.${castersFullKind(entry)}`) : null} />}
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
        {role === "CASTER" && manage && (
          <InfoHintRow>
            <InfoHint id={`${selectId}-casters`} subject={t("assignment.castersHintSubject")}>
              {t("assignment.castersHint")}
            </InfoHint>
          </InfoHintRow>
        )}
      </dd>
    </div>
  );
});

/** Les désistements d'une entrée, au staff des tournois seul (la route ne les rend qu'à lui). */
function Withdrawals({ entry, text, names }: Readonly<{ entry: PlanningEntryView; text: Text; names: ReadonlyMap<number, string> }>) {
  const { t } = text;
  const hintId = `planning-withdrawals-${entry.key.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`;
  return (
    <div className={styles.withdrawals}>
      <InfoHintRow>
        <span className={styles.withdrawalsTitle}>{t("withdrawals.title")}</span>
        <InfoHint id={hintId} subject={t("withdrawals.title")}>
          {t("withdrawals.hint")}
        </InfoHint>
      </InfoHintRow>
      <ul className={styles.withdrawalList}>
        {entry.withdrawals.map((row) => {
          const name = names.get(row.userId) ?? `#${row.userId}`;
          return (
            <li key={`${row.userId}:${row.role}:${row.createdAt}`} className={styles.withdrawal}>
              <span>
                <PlayerLink userId={row.userId}>{name}</PlayerLink> · {t(`roles.${row.role}`)}
              </span>
              {row.late && <Pill variant="warning">{t("withdrawals.late")}</Pill>}
              {!row.confirmed && <span className="cy-tag cy-tag-accent">{t("withdrawals.provisional")}</span>}
              {row.reason && <q className={styles.withdrawalReason}>{row.reason}</q>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MyAvailability({
  entry,
  view,
  text,
  pending,
  act,
  onSaved,
}: Readonly<{
  entry: PlanningEntryView;
  view: Reader;
  text: Text;
  pending: string | null;
  act: Act;
  onSaved: (change: Parameters<typeof applyAvailability>[1]) => void;
}>) {
  const { t } = text;
  if (!entry.open) return <p className={styles.muted}>{t("mine.closed")}</p>;
  const save = (role: PlanningRole, status: AvailabilityStatus, preferred: boolean) =>
    act(
      `mine:${entry.key}:${role}`,
      () => call("/api/planning/availability", json("PUT", { entryKey: entry.key, role, status, preferred })),
      () => t("saved.availability"),
      () => onSaved({ entryKey: entry.key, role, status, preferred }),
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
  onConfirmLead,
}: Readonly<{ text: Text; view: PlanningView; pending: string | null; act: Act; onConfirmLead: (hours: number) => void }>) {
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
    <label className={`field ${styles.field}`} htmlFor={id}>
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
      </InfoHintRow>

      <div className={styles.staffRow}>
        <label className={`field ${styles.field}`} htmlFor="planning-lead-hours">
          <span>{t("staff.leadLabel")}</span>
          <NumberInput id="planning-lead-hours" className={styles.number} min={1} max={744} step={1} value={hours} onValueChange={setHours} />
        </label>
        <BusyButton
          busy={pending === "confirm:lead"}
          blocked={pending !== null || hours < 1 || hours > 744}
          className={styles.button}
          onClick={() => onConfirmLead(hours)}
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
          {field("planning-confirm-lead", t("settings.confirmLeadHours"), durations.confirmLeadHours, b.confirmLeadHours, (v) => ({ ...durations, confirmLeadHours: v }))}
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
