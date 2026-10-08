"use client";

import { useToast } from "@/components/ui/toast";
import type { TournamentDialogsText } from "@/lib/shared/tournament-actions-text";
import { FormEvent, ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { CodedError, MATCH_SCHEDULE_FIELD_ERRORS, errorCode } from "@/lib/shared/field-errors";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { requiresMatchStartAt } from "@/lib/shared/live-streams";
import {
  MATCH_ENTRY_DEFAULT_TIME,
  matchEntryDefaultMonth,
  matchEntryMonths,
  formatMatchStartEntryPreview,
  localMatchTimeIfDifferent,
  matchEntryReference,
  matchEntryTimeOptions,
  matchEntryTimeValue,
  matchStartEntryOf,
  readMatchStartEntry,
  nextValidYearShift,
  withYearShift,
  type MatchStartEntryField,
  type MatchStartEntryState,
} from "@/lib/shared/match-start-entry";
import { matchLaunchPhase } from "@/lib/shared/match-launch";
import type { BracketMatch } from "@/lib/shared/types";
import { useMapError } from "../_lib/error-map";
import { useDialogsText } from "../_lib/dialogs-text";

const FIELD_IDS = {
  day: "match-start-day",
  month: "match-start-month",
  time: "match-start-time",
} as const;
const HINT_ID = "match-start-at-hint";
const PREVIEW_ID = "match-start-at-preview";
const YEAR_FIX_ID = "match-start-year-fix";

/** Premier champ manquant, tel que l'aperçu le nomme (`schedule.missing.*`). */
const MISSING_FIELD_KEYS = {
  day: "schedule.missing.day",
  month: "schedule.missing.month",
  time: "schedule.missing.time",
} as const satisfies Readonly<Record<MatchStartEntryField, string>>;

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

/** Refus de saisie, avant tout envoi. */
function entryRefusal(text: TournamentDialogsText, state: MatchStartEntryState): string | null {
  if (state.kind === "incomplete") return text.t("schedule.refusal.incomplete");
  if (state.kind === "invalid") return text.t("schedule.refusal.invalid");
  return null;
}

/**
 * Ligne d'aperçu d'une saisie inachevée : une consigne neutre, pas un refus —
 * le refus, lui, part en notification à l'envoi.
 */
function pendingPreview(text: TournamentDialogsText, state: MatchStartEntryState): string | null {
  if (state.kind === "incomplete") return text.t("schedule.pending", { field: text.t(MISSING_FIELD_KEYS[state.field]) });
  if (state.kind === "invalid") return text.t("schedule.pendingInvalid");
  return null;
}

/** Aide sous les champs : ce que la date va produire. */
function startAtHint(text: TournamentDialogsText, refereeScheduling: boolean): string {
  return text.t(refereeScheduling ? "schedule.hintPlanning" : "schedule.hint");
}

/** Confirmation après enregistrement. */
function savedMessage(text: TournamentDialogsText, touched: boolean, planning: boolean): string {
  if (!touched) return text.t("schedule.cleared");
  return text.t(planning ? "schedule.planned" : "schedule.saved");
}

/** Libellé du bouton d'envoi. */
function submitLabel(text: TournamentDialogsText, busy: boolean, planning: boolean): string {
  if (busy) return text.t("schedule.saving");
  return text.t(planning ? "schedule.plan" : "schedule.save");
}

/**
 * Avertissement avant l'envoi. `<output>` : une région d'état native, qui se
 * lit quand elle apparaît au fil de la saisie.
 */
function ScheduleWarning({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <output
      style={{
        display: "block",
        margin: "12px 0 0",
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid rgba(var(--amber-rgb), 0.4)",
        background: "rgba(var(--amber-rgb), 0.1)",
        fontSize: 12,
        color: "var(--ink-soft, #c3ccd8)",
      }}
    >
      {children}
    </output>
  );
}

interface MatchScheduleDialogProps {
  match: BracketMatch;
  /**
   * Début du tournoi et son achèvement : de quoi choisir la référence de la
   * déduction de l'année (`matchEntryReference`).
   */
  tournamentStartAt: string | null;
  tournamentFinished: boolean;
  /**
   * Le tournoi fait planifier ses matchs par l'arbitrage : effacer la date
   * renvoie le match « À planifier » (`lib/shared/match-planning.ts`).
   */
  refereeScheduling: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Date de début d'un match, pour la permission `tournaments`.
 *
 * Saisie en **jour, mois et heure de Paris**, sans année : elle se déduit de
 * la date du tournoi (`resolveMatchStartEntry`), et la date complète s'affiche
 * avant l'envoi pour que l'organisateur la vérifie. Le serveur reçoit, comme
 * avant, un instant ISO complet.
 *
 * La date ne verrouille rien, mais elle rythme le match : à l'heure dite il
 * entre en **lancement** (`lib/shared/match-launch.ts`), et elle sert de
 * frontière d'antenne aux matchs castés en mode « à la date de début ». Dans un
 * tournoi planifié par l'arbitrage, c'est elle qui fait sortir un match de
 * « À planifier ».
 *
 * Comportement modal complet via `useDialogBehavior` : `Échap`, piège à focus,
 * arrière-plan figé, focus rendu au déclencheur à la fermeture.
 */
export function MatchScheduleDialog({
  match,
  tournamentStartAt,
  tournamentFinished,
  refereeScheduling,
  onClose,
  onSaved,
}: Readonly<MatchScheduleDialogProps>) {
  const text = useDialogsText();
  const { t } = text;
  const mapError = useMapError();
  const { showError, showSuccess } = useToast();
  const fieldErrors = useFieldErrors(MATCH_SCHEDULE_FIELD_ERRORS, FIELD_IDS);
  const [initial] = useState(() => matchStartEntryOf(match.startAt));
  const [day, setDay] = useState(initial ? String(initial.day) : "");
  // Sans date posée, le mois courant (Paris) est présélectionné : reste le jour.
  const [month, setMonth] = useState(() =>
    initial ? String(initial.month) : String(matchEntryDefaultMonth(Date.now())),
  );
  // Une liste de quarts d'heure, 21:00 par défaut ; une heure déjà posée entre
  // deux quarts d'heure (posée par un autre chemin) y reste proposée telle quelle.
  const [time, setTime] = useState(initial ? matchEntryTimeValue(initial) : MATCH_ENTRY_DEFAULT_TIME);
  const [timeOptions] = useState(() => matchEntryTimeOptions(initial ? matchEntryTimeValue(initial) : null));
  // Figée à l'ouverture : l'année déduite ne doit pas changer pendant la saisie.
  const [reference] = useState(() =>
    matchEntryReference(
      { tournamentStartAt, tournamentFinished },
      Date.now(),
    ),
  );
  // Décalage d'année choisi à la main quand la déduction tombe à côté
  // (archive ancienne, année déjà fausse). Remis à zéro dès que le jour ou le
  // mois change : la nouvelle date se déduit à nouveau.
  const [yearShift, setYearShift] = useState(0);
  // Les boutons de décalage restent repliés tant qu'on ne les demande pas :
  // l'aperçu juste — le cas courant — n'a pas à les montrer.
  const [yearFixOpen, setYearFixOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // `locked` pendant l'envoi : Échap ne doit pas refermer une modale en train
  // d'écrire.
  const dialogRef = useDialogBehavior({ open: true, onClose, locked: busy });
  const backdrop = useBackdropDismiss(onClose, busy);

  // « Planifier » seulement pour un match réellement **à planifier**, figé à
  // l'ouverture : sur un match terminé ou sans ses deux engagés, poser une date
  // n'en lance aucun.
  const [planning] = useState(
    () => matchLaunchPhase({ ...match, refereeScheduling }, Date.now()) === "TO_PLAN",
  );
  const deduced = readMatchStartEntry({ day, month, time }, reference, match.startAt);
  const entry = withYearShift(deduced, yearShift);
  // Décalage de chaque bouton : un cran, ou quatre pour un 29 février. Libellés
  // fixes (« Année précédente ») : un libellé qui changerait au clic, sous le
  // focus, ferait reculer de deux ans au double-clic sans qu'on le voie venir.
  const shiftTarget = (direction: -1 | 1) => {
    if (deduced.kind !== "ready") return null;
    const shift = nextValidYearShift(deduced.instant, yearShift, direction);
    return shift === null ? null : { shift };
  };
  const previousYear = shiftTarget(-1);
  const nextYear = shiftTarget(1);
  const cleared = entry.kind === "empty";
  // Les cartes de match affichent l'heure du navigateur : hors du fuseau de
  // Paris, l'aperçu donne aussi celle-là, pour que les deux se recoupent.
  const localTime = entry.kind === "ready" ? localMatchTimeIfDifferent(entry.instant, undefined, text.locale) : null;
  // Effacer la date d'un match casté « à la date de début » ne casse rien, mais
  // le laisse programmé sans jamais passer à l'antenne : on le dit plutôt que
  // de refuser l'effacement — le calendrier ne dépend pas de la diffusion.
  // Une saisie seulement incomplète n'est pas un effacement : on n'avertit pas
  // encore, l'utilisateur est en train de taper.
  const clearsLiveTrigger = cleared && requiresMatchStartAt(match.liveTrigger);
  // Effacer la date d'un match non lancé d'un tournoi planifié le renvoie à
  // l'arbitrage : on le dit avant l'envoi. Un match lancé ou joué n'est pas
  // concerné (sa phase ne dépend plus de la date).
  const returnsToPlanning =
    refereeScheduling &&
    cleared &&
    match.startAt !== null &&
    match.launchedAt === null &&
    match.status === "READY" &&
    // Déjà noté, il est tenu pour lancé par le serveur, pas renvoyé.
    match.team1Score === null &&
    match.team2Score === null;

  const clearAll = () => {
    setDay("");
    setMonth("");
    setTime(MATCH_ENTRY_DEFAULT_TIME);
    setYearShift(0);
    fieldErrors.clear();
    // Le bouton « Vider la date » disparaît avec la date : le focus, qu'il
    // portait, revient au premier champ plutôt que de tomber sur la page.
    document.getElementById(FIELD_IDS.day)?.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (entry.kind === "incomplete" || entry.kind === "invalid") {
      const message = entryRefusal(text, entry) ?? t("schedule.refusal.unknown");
      fieldErrors.flag(entry.field, message);
      showError(message);
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/admin/matches/${match.id}/schedule`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startAt: entry.kind === "ready" ? new Date(entry.instant).toISOString() : null,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        const code = payload.error || "MATCH_SCHEDULE_UPDATE_FAILED";
        throw new CodedError(code, mapError(code));
      }
      showSuccess(savedMessage(text, entry.kind === "ready", planning));
      onSaved();
      onClose();
    } catch (error) {
      const message = error instanceof CodedError ? error.message : mapError((error as Error).message);
      fieldErrors.report(errorCode(error), message);
      showError(message);
    } finally {
      setBusy(false);
    }
  };

  const fieldStyle = { flex: "1 1 96px", margin: 0, minWidth: 0 } as const;

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */
      role="presentation"
      {...backdrop}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(6, 8, 12, 0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="dialog-bounded"
        aria-labelledby="match-schedule-title"
        tabIndex={-1}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--cyber-bg-2, #14181f)",
          border: "1px solid var(--line-strong-cy, var(--line-soft))",
          borderRadius: "var(--r-cy-md, 12px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: 22,
        }}
      >
        <form onSubmit={submit} noValidate>
          <h3 id="match-schedule-title" style={{ margin: 0, fontSize: 18, color: "var(--ink)" }}>
            {planning ? t("schedule.titlePlanning") : t("schedule.title")}
          </h3>
          <p style={{ marginTop: 6, fontSize: 13, color: "var(--ink-quiet, #9aa4b2)" }}>
            {match.team1Name ?? "TBD"} vs {match.team2Name ?? "TBD"}
          </p>

          {/* L'aide est rattachée au premier champ (lue une fois, et non à
              chacun des trois) ; l'aperçu au dernier, pour qu'on entende la
              date retenue en finissant la saisie. La description d'un
              `fieldset` n'est pas lue par tous les lecteurs d'écran. */}
          <fieldset style={{ margin: "18px 0 0", padding: 0, border: 0, minWidth: 0 }}>
            <legend style={{ padding: 0, marginBottom: 8, fontSize: 13, color: "var(--ink)" }}>
              {t("schedule.legend")}
            </legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <div className="field" style={fieldStyle}>
                <label htmlFor={FIELD_IDS.day}>{t("schedule.day")}</label>
                <select
                  id={FIELD_IDS.day}
                  value={day}
                  disabled={busy}
                  onChange={(e) => {
                    setDay(e.target.value);
                    setYearShift(0);
                    fieldErrors.clear();
                  }}
                  {...fieldErrors.aria("day", HINT_ID)}
                >
                  <option value="">—</option>
                  {DAYS.map((value) => (
                    <option key={value} value={String(value)}>
                      {value}
                    </option>
                  ))}
                </select>
                <FieldErrorText fieldId={FIELD_IDS.day} message={fieldErrors.message("day")} />
              </div>
              <div className="field" style={{ ...fieldStyle, flexGrow: 2 }}>
                <label htmlFor={FIELD_IDS.month}>{t("schedule.month")}</label>
                <select
                  id={FIELD_IDS.month}
                  value={month}
                  disabled={busy}
                  onChange={(e) => {
                    setMonth(e.target.value);
                    setYearShift(0);
                    fieldErrors.clear();
                  }}
                  {...fieldErrors.aria("month")}
                >
                  <option value="">—</option>
                  {matchEntryMonths(text.locale).map((name, index) => (
                    <option key={name} value={String(index + 1)}>
                      {name}
                    </option>
                  ))}
                </select>
                <FieldErrorText fieldId={FIELD_IDS.month} message={fieldErrors.message("month")} />
              </div>
              <div className="field" style={fieldStyle}>
                <label htmlFor={FIELD_IDS.time}>{t("schedule.time")}</label>
                <select
                  id={FIELD_IDS.time}
                  value={time}
                  disabled={busy}
                  onChange={(e) => {
                    setTime(e.target.value);
                    fieldErrors.clear();
                  }}
                  {...fieldErrors.aria("time", PREVIEW_ID)}
                >
                  {timeOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <FieldErrorText fieldId={FIELD_IDS.time} message={fieldErrors.message("time")} />
              </div>
            </div>
          </fieldset>

          <output
            id={PREVIEW_ID}
            style={{ display: "block", margin: "10px 0 0", fontSize: 13, color: "var(--ink)" }}
          >
            {entry.kind === "ready" && (
              <>
                {t("schedule.preview")} <strong>{formatMatchStartEntryPreview(entry.instant, text.locale)}</strong>
                {localTime && ` ${t("schedule.localTime", { time: localTime })}`}
              </>
            )}
            {cleared && t("schedule.none")}
            {pendingPreview(text, entry)}
          </output>
          {entry.kind === "ready" && (previousYear !== null || nextYear !== null) && (
            // Le bouton reste en place une fois déplié : il garde le focus.
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => setYearFixOpen((open) => !open)}
              aria-expanded={yearFixOpen}
              aria-controls={YEAR_FIX_ID}
              style={{ padding: "4px 10px", fontSize: 12, marginTop: 6 }}
            >
              {t("schedule.wrongYear")}
            </button>
          )}
          {entry.kind === "ready" && yearFixOpen && (previousYear !== null || nextYear !== null) && (
            <fieldset
              id={YEAR_FIX_ID}
              style={{ margin: "6px 0 0", padding: 0, border: 0, minWidth: 0 }}
            >
              <legend className="sr-only">{t("schedule.fixYear")}</legend>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {previousYear !== null && (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => setYearShift(previousYear.shift)}
                  aria-controls={PREVIEW_ID}
                  style={{ padding: "4px 10px", fontSize: 12 }}
                >
                  {t("schedule.previousYear")}
                </button>
              )}
              {nextYear !== null && (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => setYearShift(nextYear.shift)}
                  aria-controls={PREVIEW_ID}
                  style={{ padding: "4px 10px", fontSize: 12 }}
                >
                  {t("schedule.nextYear")}
                </button>
              )}
              </div>
            </fieldset>
          )}
          <p
            id={HINT_ID}
            style={{ margin: "6px 0 0", fontSize: 12, color: "var(--ink-quiet, #9aa4b2)" }}
          >
            {startAtHint(text, refereeScheduling)}
          </p>

          {clearsLiveTrigger && (
            <ScheduleWarning>
              {t("schedule.warnLive")}
            </ScheduleWarning>
          )}

          {returnsToPlanning && (
            <ScheduleWarning>
              {t("schedule.warnPlanning")}
            </ScheduleWarning>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
            {!cleared && (
              <button
                type="button"
                className="btn ghost"
                onClick={clearAll}
                disabled={busy}
                style={{ padding: "8px 14px", fontSize: 13, marginRight: "auto" }}
              >
                {t("schedule.clear")}
              </button>
            )}
            <button
              type="button"
              className="btn ghost"
              onClick={onClose}
              disabled={busy}
              style={{ padding: "8px 18px", fontSize: 13 }}
            >
              {t("score.cancel")}
            </button>
            <button
              type="submit"
              className="btn"
              disabled={busy}
              style={{ padding: "8px 20px", fontSize: 13 }}
            >
              {submitLabel(text, busy, planning)}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
