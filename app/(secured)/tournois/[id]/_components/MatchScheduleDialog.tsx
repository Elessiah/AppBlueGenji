"use client";

import { useToast } from "@/components/ui/toast";
import type { TournamentDialogsText } from "@/lib/shared/tournament-actions-text";
import { FormEvent, ReactNode, useRef, useState } from "react";
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
  isUnreadConfirmationClick,
  pastStartWarning,
  shouldHoldSubmit,
  withYearShift,
  type MatchStartEntryField,
  type MatchStartEntryState,
} from "@/lib/shared/match-start-entry";
import { isMatchOver } from "@/lib/shared/match-schedule";
import { matchLaunchPhase } from "@/lib/shared/match-launch";
import type { BracketMatch } from "@/lib/shared/types";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { useMapError } from "../_lib/error-map";
import { useDialogsText } from "../_lib/dialogs-text";
import { richNodes } from "@/components/i18n/shell-text";
import { EntrantName } from "./EntrantName";

const FIELD_IDS = {
  day: "match-start-day",
  month: "match-start-month",
  time: "match-start-time",
} as const;
const HINT_ID = "match-start-at-hint";
const NOTICE_ID = "match-start-at-notice";
const PREVIEW_ID = "match-start-at-preview";
const PAST_WARNING_ID = "match-start-past-warning";
const YEAR_FIX_ID = "match-start-year-fix";
const SUBMIT_ID = "match-start-submit";

/** Premier champ manquant, tel que l'aperçu le nomme (`schedule.missing.*`). */
const MISSING_FIELD_KEYS = {
  day: "schedule.missing.day",
  month: "schedule.missing.month",
  time: "schedule.missing.time",
} as const satisfies Readonly<Record<MatchStartEntryField, string>>;

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

/**
 * Nom d'un côté pour le sous-titre : « TBD » seulement quand la place est
 * vide ; un engagé connu au nom absent passe vide, `EntrantName` posant alors
 * son repli « Engagé #id ».
 */
function versusName(name: string | null, teamId: number | null, tbd: string): string {
  if (name !== null) return name;
  return teamId === null ? tbd : "";
}

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

/**
 * Aide sous les champs : ce que la date va produire. L'avis aux joueurs
 * (`startAtNotice`) vit derrière un « i » : les deux formaient un paragraphe
 * permanent de trois phrases ou plus, qui repoussait boutons et avertissements
 * sous le pli à 375 px.
 */
export function startAtHint(
  text: TournamentDialogsText,
  refereeScheduling: boolean,
  entrantsKnown: boolean,
  played: boolean,
  launchPhase = true,
  launched = false,
): string {
  // Déjà lancé : option allumée, une date posée ensuite ne le fait pas
  // attendre. Option éteinte, le départ ne tient qu'à l'horaire : sans score,
  // une heure à venir (ou une date vidée, planification par l'arbitrage) le
  // fait quitter le lancement (`leavesLaunch`, serveur).
  if (launched && !played) {
    const directLaunchedKey = refereeScheduling
      ? "schedule.hintLaunchedPlanningDirect"
      : "schedule.hintLaunchedDirect";
    return text.t(launchPhase ? "schedule.hintLaunched" : directLaunchedKey);
  }
  const planningKey = launchPhase ? "schedule.hintPlanning" : "schedule.hintPlanningDirect";
  // Option éteinte, un match sans date part d'emblée — mais seulement une fois
  // ses deux adversaires connus.
  const directKey = entrantsKnown ? "schedule.hintDirect" : "schedule.hintDirectTbd";
  const plainKey = launchPhase ? "schedule.hint" : directKey;
  return text.t(refereeScheduling ? planningKey : plainKey);
}

/**
 * Avis aux joueurs que l'horaire déclenche, ou `null` : un match joué (ou d'un
 * tournoi clos) n'annonce rien, la date n'est qu'une correction d'archive.
 */
export function startAtNotice(
  text: TournamentDialogsText,
  refereeScheduling: boolean,
  entrantsKnown: boolean,
  played: boolean,
): string | null {
  return played ? null : scheduleNotice(text, refereeScheduling, entrantsKnown);
}

/**
 * Qui l'horaire prévient (`lib/server/tournaments/schedule-notices.ts`) : les
 * joueurs des deux engagées, tout de suite — un retrait seulement en tournoi
 * planifié par l'arbitrage. Une place encore vide : l'annonce attend le
 * balayage des rappels, une fois les deux engagées connues.
 */
function scheduleNotice(text: TournamentDialogsText, refereeScheduling: boolean, entrantsKnown: boolean): string {
  if (!entrantsKnown) return text.t("schedule.noticeTbd");
  return text.t(refereeScheduling ? "schedule.noticePlanning" : "schedule.notice");
}

/**
 * Confirmation après enregistrement — neutre : elle ne reprend pas le titre
 * de l'avis aux joueurs (« Horaire du match retiré »), qui ne part pas
 * toujours. Vider une date qui n'existait pas ne retire rien.
 */
function savedMessage(text: TournamentDialogsText, touched: boolean, planning: boolean, hadTime: boolean): string {
  if (!touched) return text.t(hadTime ? "schedule.cleared" : "schedule.noTime");
  return text.t(planning ? "schedule.planned" : "schedule.saved");
}

/** Libellé du bouton d'envoi. */
function submitLabel(text: TournamentDialogsText, busy: boolean, planning: boolean): string {
  if (busy) return text.t("schedule.saving");
  return text.t(planning ? "schedule.plan" : "schedule.save");
}

const WARNING_STYLE = {
  display: "block",
  margin: "12px 0 0",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(var(--amber-rgb), 0.4)",
  background: "rgba(var(--amber-rgb), 0.1)",
  fontSize: 12,
  color: "var(--ink-soft, #c3ccd8)",
} as const;

/**
 * Avertissement avant l'envoi. `<output>` : une région d'état native, qui se
 * lit quand elle apparaît au fil de la saisie.
 */
function ScheduleWarning({ children }: Readonly<{ children: ReactNode }>) {
  return <output style={WARNING_STYLE}>{children}</output>;
}

/**
 * Avertissement de date passée : région **toujours montée** dont seul le texte
 * change — une région insérée avec son texte déjà dedans n'est pas annoncée
 * par tous les lecteurs d'écran (NVDA, JAWS, VoiceOver iOS) au choix du jour.
 * Vide, elle n'occupe aucune place.
 */
function PastDateWarning({ message }: Readonly<{ message: string | null }>) {
  return (
    <output id={PAST_WARNING_ID} style={message ? WARNING_STYLE : { display: "block" }}>
      {message ?? ""}
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
  /**
   * Option « phase de lancement » du tournoi : éteinte, le match est lancé
   * directement à son heure, sans « Prêt » — l'aide le dit. Absente = allumée.
   */
  launchPhase?: boolean;
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
  launchPhase = true,
  onClose,
  onSaved,
}: Readonly<MatchScheduleDialogProps>) {
  const text = useDialogsText();
  const { t } = text;
  const mapError = useMapError();
  const { showError, showSuccess } = useToast();
  const fieldErrors = useFieldErrors(MATCH_SCHEDULE_FIELD_ERRORS, FIELD_IDS);
  // Une seule horloge pour le dialogue : mois présélectionné, référence de
  // l'année, planification et date passée lisent le même instant (quatre
  // lectures pouvaient tomber de part et d'autre de minuit). Relue à l'envoi.
  const [clock, setClock] = useState(Date.now);
  const [initial] = useState(() => matchStartEntryOf(match.startAt));
  const [day, setDay] = useState(initial ? String(initial.day) : "");
  // Sans date posée, le mois courant (Paris) est présélectionné : reste le jour.
  const [month, setMonth] = useState(() =>
    initial ? String(initial.month) : String(matchEntryDefaultMonth(clock)),
  );
  // Le mois présélectionné ne compte pas tant qu'aucun jour n'est choisi : la
  // saisie reste « aucun horaire » (pas de « Vider la date » sans date à vider,
  // pas de refus « jour manquant » pour confirmer qu'il n'y a pas d'horaire).
  const [monthPreset, setMonthPreset] = useState(initial === null);
  const enteredMonth = monthPreset && day === "" ? "" : month;
  // Une liste de quarts d'heure, 21:00 par défaut ; une heure déjà posée entre
  // deux quarts d'heure (posée par un autre chemin) y reste proposée telle quelle.
  const [time, setTime] = useState(initial ? matchEntryTimeValue(initial) : MATCH_ENTRY_DEFAULT_TIME);
  const [timeOptions] = useState(() => matchEntryTimeOptions(initial ? matchEntryTimeValue(initial) : null));
  // Figée à l'ouverture : l'année déduite ne doit pas changer pendant la saisie.
  const [reference] = useState(() =>
    matchEntryReference(
      { tournamentStartAt, tournamentFinished },
      clock,
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
  // Le dernier envoi a été retenu (date devenue passée) : le clic suivant, s'il
  // prolonge un double-clic, ne le confirme pas (`isUnreadConfirmationClick`).
  const justHeld = useRef(false);
  // `locked` pendant l'envoi : Échap ne doit pas refermer une modale en train
  // d'écrire.
  const dialogRef = useDialogBehavior({ open: true, onClose, locked: busy });
  const backdrop = useBackdropDismiss(onClose, busy);

  // « Planifier » seulement pour un match réellement **à planifier**, figé à
  // l'ouverture : sur un match terminé ou sans ses deux engagés, poser une date
  // n'en lance aucun.
  const [planning] = useState(
    () => matchLaunchPhase({ ...match, refereeScheduling }, clock) === "TO_PLAN",
  );
  const deduced = readMatchStartEntry({ day, month: enteredMonth, time }, reference, match.startAt);
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
  // Un match qui n'a pas de date n'a rien à effacer : le mois présélectionné
  // tenu pour vide ne doit pas faire paraître l'avertissement dès l'ouverture.
  const clearsLiveTrigger = cleared && match.startAt !== null && requiresMatchStartAt(match.liveTrigger);
  // Une date déjà passée qui ferait partir un match en attente de son heure :
  // on le dit avant l'envoi (le mois présélectionné rend l'erreur facile).
  const entrantsKnown = match.team1Id !== null && match.team2Id !== null;
  const pastWarningAt = (now: number) =>
    entry.kind === "ready"
      ? pastStartWarning({ ...match, refereeScheduling }, entry.instant, now, { launchPhase, tournamentFinished })
      : null;
  const pastWarning = pastWarningAt(clock);
  const notice = startAtNotice(text, refereeScheduling, entrantsKnown, isMatchOver(match.status, tournamentFinished));
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
    setMonthPreset(false);
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
    // L'horloge a pu avancer depuis l'ouverture (fenêtre laissée ouverte) : une
    // date devenue passée entre-temps s'avertit d'abord, l'envoi suivant part.
    // L'avertissement défile dans la vue (à 375 px il pouvait être sous le pli,
    // et le clic semblait sans effet) ; sa région d'état le fait lire. Le focus
    // reste sur « Enregistrer » : un second envoi confirme, comme pour une date
    // passée dès la saisie — une notification `role="alert"` l'aurait coupé.
    // Défilement vers l'avertissement puis vers « Enregistrer », juste dessous :
    // l'avertissement qui grandit repousse le bouton, qui garde le focus.
    const now = Date.now();
    if (shouldHoldSubmit(pastWarning !== null, pastWarningAt(now) !== null)) {
      justHeld.current = true;
      setClock(now);
      requestAnimationFrame(() => {
        document.getElementById(PAST_WARNING_ID)?.scrollIntoView({ block: "nearest" });
        document.getElementById(SUBMIT_ID)?.scrollIntoView({ block: "nearest" });
      });
      return;
    }

    justHeld.current = false;
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
      showSuccess(savedMessage(text, entry.kind === "ready", planning, match.startAt !== null));
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
            {richNodes(
              text.rich(
                "schedule.versus",
                {
                  team1: versusName(match.team1Name, match.team1Id, t("schedule.tbd")),
                  team2: versusName(match.team2Name, match.team2Id, t("schedule.tbd")),
                },
                {
                  first: (chunks) => <EntrantName plain teamId={match.team1Id} name={chunks.join("")} />,
                  second: (chunks) => <EntrantName plain teamId={match.team2Id} name={chunks.join("")} />,
                },
              ),
            )}
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
                {/* Focus d'ouverture sur la saisie, pas sur le lien du premier
                    engagé du sous-titre (`useDialogBehavior`). */}
                <select
                  data-autofocus
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
                    setMonthPreset(false);
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
          <InfoHintRow>
            <p
              id={HINT_ID}
              style={{ margin: "6px 0 0", fontSize: 12, color: "var(--ink-quiet, #9aa4b2)" }}
            >
              {startAtHint(
                text,
                refereeScheduling,
                match.team1Id !== null && match.team2Id !== null,
                // Tournoi clos : ses manches comptent pour jouées, rien n'est annoncé.
                isMatchOver(match.status, tournamentFinished),
                launchPhase,
                match.launchedAt !== null,
              )}
            </p>
            {notice !== null && (
              <InfoHint id={NOTICE_ID} subject={t("schedule.noticeSubject")}>
                <p>{notice}</p>
              </InfoHint>
            )}
          </InfoHintRow>

          {clearsLiveTrigger && (
            <ScheduleWarning>
              {t("schedule.warnLive")}
            </ScheduleWarning>
          )}

          <PastDateWarning message={pastWarning === null ? null : t(pastWarning)} />

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
                onClick={(event) => {
                  if (event.detail <= 1) clearAll();
                }}
                disabled={busy}
                style={{ padding: "8px 14px", fontSize: 13, marginRight: "auto" }}
              >
                {t("schedule.clear")}
              </button>
            )}
            <button
              type="button"
              className="btn ghost"
              onClick={(event) => {
                if (event.detail <= 1) onClose();
              }}
              disabled={busy}
              style={{ padding: "8px 18px", fontSize: 13 }}
            >
              {t("score.cancel")}
            </button>
            {/* Le clic qui prolonge un double-clic (`detail`, au réglage du
                système) juste après un envoi retenu (date devenue passée), et
                la répétition d'« Entrée » tenue, n'envoient pas : ils
                confirmeraient sans laisser lire l'avertissement. Le clic
                suivant part (`isUnreadConfirmationClick`). Même garde sur « Vider la date »
                et « Annuler » : l'avertissement qui apparaît repousse la
                rangée, et le second clic tombait sur eux (date perdue). */}
            <button
              id={SUBMIT_ID}
              type="submit"
              onClick={(event) => {
                if (isUnreadConfirmationClick(event.detail, justHeld.current)) event.preventDefault();
                justHeld.current = false;
              }}
              onKeyDown={(event) => {
                if (event.repeat && event.key === "Enter") event.preventDefault();
              }}
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
