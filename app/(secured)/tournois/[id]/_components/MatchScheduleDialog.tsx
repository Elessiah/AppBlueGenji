"use client";

import { FormEvent, ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { useToast } from "@/components/ui/toast";
import { CodedError, MATCH_SCHEDULE_FIELD_ERRORS, errorCode } from "@/lib/shared/field-errors";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { requiresMatchStartAt } from "@/lib/shared/live-streams";
import {
  MATCH_ENTRY_MONTHS,
  formatMatchStartEntryPreview,
  localMatchTimeIfDifferent,
  matchEntryReference,
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
import { mapError } from "../_lib/error-map";

const FIELD_IDS = {
  day: "match-start-day",
  month: "match-start-month",
  time: "match-start-time",
} as const;
const HINT_ID = "match-start-at-hint";
const PREVIEW_ID = "match-start-at-preview";
const YEAR_FIX_ID = "match-start-year-fix";

/** Premier champ manquant, tel que l'aperçu le nomme. */
const MISSING_FIELD_LABELS: Readonly<Record<MatchStartEntryField, string>> = {
  day: "le jour",
  month: "le mois",
  time: "l'heure",
};

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

/** Refus de saisie, avant tout envoi. */
function entryRefusal(state: MatchStartEntryState): string | null {
  if (state.kind === "incomplete") {
    return "Date incomplète : choisis le jour, le mois et l'heure, ou vide les trois champs pour ne pas annoncer d'horaire.";
  }
  if (state.kind === "invalid") return "Ce jour n'existe pas dans ce mois.";
  return null;
}

/**
 * Ligne d'aperçu d'une saisie inachevée : une consigne neutre, pas un refus —
 * le refus, lui, part en notification à l'envoi.
 */
function pendingPreview(state: MatchStartEntryState): string | null {
  if (state.kind === "incomplete") return `À compléter : ${MISSING_FIELD_LABELS[state.field]}.`;
  if (state.kind === "invalid") return "Aucune date possible : ce jour n'existe pas dans ce mois.";
  return null;
}

/** Aide sous les champs : ce que la date va produire. */
function startAtHint(refereeScheduling: boolean): string {
  const year = "L'année se déduit automatiquement : vérifie l'aperçu.";
  if (refereeScheduling) {
    return `${year} Le match reste « En attente de départ » jusqu'à cette heure, puis entre en lancement : les deux équipes se déclarent prêtes.`;
  }
  return `${year} Vide = aucun horaire annoncé. À l'heure dite, le match entre en lancement : les deux équipes se déclarent prêtes.`;
}

/** Confirmation après enregistrement. */
function savedMessage(touched: boolean, planning: boolean): string {
  if (!touched) return "Date de début effacée.";
  return planning ? "Match planifié." : "Date de début enregistrée.";
}

/** Libellé du bouton d'envoi. */
function submitLabel(busy: boolean, planning: boolean): string {
  if (busy) return "Enregistrement…";
  return planning ? "Planifier" : "Enregistrer";
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
        border: "1px solid rgba(255,157,46,0.4)",
        background: "rgba(255,157,46,0.1)",
        fontSize: 12,
        color: "var(--text-1, #c3ccd8)",
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
  const { showError, showSuccess } = useToast();
  const fieldErrors = useFieldErrors(MATCH_SCHEDULE_FIELD_ERRORS, FIELD_IDS);
  const [initial] = useState(() => matchStartEntryOf(match.startAt));
  const [day, setDay] = useState(initial ? String(initial.day) : "");
  const [month, setMonth] = useState(initial ? String(initial.month) : "");
  const [time, setTime] = useState(initial ? matchEntryTimeValue(initial) : "");
  // Saisie d'heure commencée mais incomplète (« 20:__ ») : le champ rend alors
  // `value === ""`, indiscernable d'un champ vidé. Le navigateur n'émet pas
  // toujours d'événement pendant cette saisie (Chrome, champ parti de vide) :
  // l'état sert à l'affichage, et l'envoi relit le champ lui-même (`timeRef`).
  const [timeBadInput, setTimeBadInput] = useState(false);
  const timeRef = useRef<HTMLInputElement>(null);
  // Changer la clé remonte le champ : seul moyen d'effacer une saisie partielle,
  // que `value=""` ne touche pas (la valeur est déjà vide).
  const [timeKey, setTimeKey] = useState(0);
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
  const deduced = readMatchStartEntry({ day, month, time, timeBadInput }, reference, match.startAt);
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
  const localTime = entry.kind === "ready" ? localMatchTimeIfDifferent(entry.instant) : null;
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
    setTime("");
    setTimeBadInput(false);
    setTimeKey((key) => key + 1);
    setYearShift(0);
    fieldErrors.clear();
    // Le bouton « Vider la date » disparaît avec la date : le focus, qu'il
    // portait, revient au premier champ plutôt que de tomber sur la page.
    document.getElementById(FIELD_IDS.day)?.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const badInputNow = timeRef.current?.validity.badInput ?? timeBadInput;
    const sent =
      badInputNow === timeBadInput
        ? entry
        : withYearShift(
            readMatchStartEntry({ day, month, time, timeBadInput: badInputNow }, reference, match.startAt),
            yearShift,
          );
    if (badInputNow !== timeBadInput) setTimeBadInput(badInputNow);
    if (sent.kind === "incomplete" || sent.kind === "invalid") {
      const message = entryRefusal(sent) ?? "Date non reconnue.";
      fieldErrors.flag(sent.field, message);
      showError(message);
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/admin/matches/${match.id}/schedule`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startAt: sent.kind === "ready" ? new Date(sent.instant).toISOString() : null,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        const code = payload.error || "MATCH_SCHEDULE_UPDATE_FAILED";
        throw new CodedError(code, mapError(code));
      }
      showSuccess(savedMessage(sent.kind === "ready", planning));
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
            {planning ? "Planifier le match" : "Date de début du match"}
          </h3>
          <p style={{ marginTop: 6, fontSize: 13, color: "var(--text-2, #9aa4b2)" }}>
            {match.team1Name ?? "TBD"} vs {match.team2Name ?? "TBD"}
          </p>

          {/* L'aide est rattachée au premier champ (lue une fois, et non à
              chacun des trois) ; l'aperçu au dernier, pour qu'on entende la
              date retenue en finissant la saisie. La description d'un
              `fieldset` n'est pas lue par tous les lecteurs d'écran. */}
          <fieldset style={{ margin: "18px 0 0", padding: 0, border: 0, minWidth: 0 }}>
            <legend style={{ padding: 0, marginBottom: 8, fontSize: 13, color: "var(--ink)" }}>
              Début programmé (heure de Paris)
            </legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <div className="field" style={fieldStyle}>
                <label htmlFor={FIELD_IDS.day}>Jour</label>
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
                <label htmlFor={FIELD_IDS.month}>Mois</label>
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
                  {MATCH_ENTRY_MONTHS.map((name, index) => (
                    <option key={name} value={String(index + 1)}>
                      {name}
                    </option>
                  ))}
                </select>
                <FieldErrorText fieldId={FIELD_IDS.month} message={fieldErrors.message("month")} />
              </div>
              <div className="field" style={fieldStyle}>
                <label htmlFor={FIELD_IDS.time}>Heure</label>
                <input
                  key={timeKey}
                  ref={timeRef}
                  id={FIELD_IDS.time}
                  type="time"
                  value={time}
                  disabled={busy}
                  onChange={(e) => {
                    setTime(e.target.value);
                    setTimeBadInput(e.target.validity.badInput);
                    fieldErrors.clear();
                  }}
                  // Chrome ne signale pas une heure tapée à moitié dans un champ
                  // parti de vide (`onChange` muet) : on relit sa validité à
                  // chaque touche et à la sortie.
                  onKeyUp={(e) => setTimeBadInput(e.currentTarget.validity.badInput)}
                  onBlur={(e) => setTimeBadInput(e.target.validity.badInput)}
                  {...fieldErrors.aria("time", PREVIEW_ID)}
                />
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
                Date retenue : <strong>{formatMatchStartEntryPreview(entry.instant)}</strong>
                {localTime && ` (${localTime} à ton heure locale)`}
              </>
            )}
            {cleared && "Aucun horaire annoncé."}
            {pendingPreview(entry)}
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
              Mauvaise année ?
            </button>
          )}
          {entry.kind === "ready" && yearFixOpen && (previousYear !== null || nextYear !== null) && (
            <div
              id={YEAR_FIX_ID}
              role="group"
              aria-label="Corriger l'année"
              style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}
            >
              {previousYear !== null && (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => setYearShift(previousYear.shift)}
                  aria-controls={PREVIEW_ID}
                  style={{ padding: "4px 10px", fontSize: 12 }}
                >
                  Année précédente
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
                  Année suivante
                </button>
              )}
            </div>
          )}
          <p
            id={HINT_ID}
            style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-2, #9aa4b2)" }}
          >
            {startAtHint(refereeScheduling)}
          </p>

          {clearsLiveTrigger && (
            <ScheduleWarning>
              Ce match passe à l&apos;antenne à sa date de début : sans date, il restera
              « programmé » sans jamais démarrer.
            </ScheduleWarning>
          )}

          {returnsToPlanning && (
            <ScheduleWarning>
              Sans date, ce match repasse « À planifier » : il ne se lancera pas tant
              qu&apos;une nouvelle heure n&apos;est pas fixée.
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
                Vider la date
              </button>
            )}
            <button
              type="button"
              className="btn ghost"
              onClick={onClose}
              disabled={busy}
              style={{ padding: "8px 18px", fontSize: 13 }}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn"
              disabled={busy}
              style={{ padding: "8px 20px", fontSize: 13 }}
            >
              {submitLabel(busy, planning)}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
