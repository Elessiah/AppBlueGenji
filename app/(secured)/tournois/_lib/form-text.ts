import frTournamentForm from "@/messages/fr/tournamentForm.json";
import {
  tournamentFormText,
  type TournamentErrorsText,
  type TournamentFormText,
} from "@/lib/shared/tournament-actions-text";
import { useTournamentFormTextFrom } from "@/components/i18n/tournament-actions-text";
import {
  matchAllowsDraw,
  matchFormatNotation,
  matchMaxMaps,
  matchWinsRequired,
  naturalMaxMaps,
  type MatchFormat,
  type MatchFormatType,
} from "@/lib/shared/match-format";
import { MIN_PLAYERS_BOUNDS, type RegistrationFilters } from "@/lib/shared/registration-filters";
import type { PhaseConfig, PhaseIssue, ResolvedPhase } from "@/lib/shared/tournament-phases";
import type { PhaseFormat } from "@/lib/shared/types";
import { mapError } from "../[id]/_lib/error-map";

/**
 * Français des formulaires de création et d'édition d'un tournoi (lot 8b-2).
 * Il remplace les chaînes écrites en dur ; l'anglais vient du fournisseur,
 * sous `/en` seulement. Les tables françaises d'origine (modules partagés,
 * `phase-form.ts`, `edit-entry.ts`) restent pour leurs autres lecteurs : le
 * français de chaque message les égale (testé).
 */
export const FR_FORM_TEXT: TournamentFormText = tournamentFormText("fr", frTournamentForm);

/** Textes du formulaire, dans la langue de la page. */
export function useFormText(): TournamentFormText {
  return useTournamentFormTextFrom(FR_FORM_TEXT);
}

/** Notation d'un format de match (« BO5 », « FT3 · 4 maps », « Score libre ») — `matchFormatLabel`. */
export function formatNotationText(text: TournamentFormText, format: MatchFormat | null): string {
  if (!format) return text.t("form.notation.free");
  const base = matchFormatNotation(format);
  const maps = matchMaxMaps(format);
  return maps === naturalMaxMaps(format) ? base : text.t("form.notation.withMaps", { base, maps });
}

/** Phrase d'aide d'un format de match — `matchFormatDescription`. */
export function formatDescriptionText(text: TournamentFormText, format: MatchFormat | null): string {
  if (!format) return text.t("form.notation.noLimit");
  const values = { wins: matchWinsRequired(format), maps: String(matchMaxMaps(format)) };
  return text.t(matchAllowsDraw(format) ? "form.notation.raceWithDraw" : "form.notation.race", values);
}

/** Aide sous le type de format de match — `matchFormatHint`. */
export function formatHintText(
  text: TournamentFormText,
  type: MatchFormatType | "LIBRE",
  valid: boolean,
  format: MatchFormat | null,
): string {
  if (type === "LIBRE") return text.t("form.formatHint.free");
  if (valid) {
    return text.t("form.formatHint.valid", { label: formatNotationText(text, format), description: formatDescriptionText(text, format) });
  }
  return text.t(type === "BO" ? "form.formatHint.invalidBo" : "form.formatHint.invalidFt");
}

/** Refus d'un format de match invalide à l'envoi — `invalidMatchFormatMessage`. */
export function invalidFormatText(text: TournamentFormText, type: MatchFormatType | "LIBRE"): string {
  return text.t(type === "BO" ? "form.invalidFormat.BO" : "form.invalidFormat.other");
}

/** Conditions d'inscription telles que les liront les engagés — `registrationFiltersSummary`. */
export function conditionsText(text: TournamentFormText, filters: RegistrationFilters, soloEntry = false): string | null {
  const { t } = text;
  const parts: string[] = [];
  if (!soloEntry && filters.minPlayers > MIN_PLAYERS_BOUNDS.min) {
    parts.push(t("form.conditions.minPlayers", { count: filters.minPlayers }));
  }
  if (filters.discordRequirement === "ANY_PLAYER") {
    parts.push(t(soloEntry ? "form.conditions.discordSolo" : "form.conditions.discordAny"));
  }
  if (filters.discordRequirement === "ALL_PLAYERS") {
    parts.push(t(soloEntry ? "form.conditions.discordSolo" : "form.conditions.discordAll"));
  }
  if (filters.blizzardRequirement === "ANY_PLAYER") {
    parts.push(t(soloEntry ? "form.conditions.blizzardSolo" : "form.conditions.blizzardAny"));
  }
  if (filters.blizzardRequirement === "ALL_PLAYERS") {
    parts.push(t(soloEntry ? "form.conditions.blizzardSolo" : "form.conditions.blizzardAll"));
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

/** Nom d'un format de phase — `phaseFormatLabel`. */
export function phaseFormatText(text: TournamentFormText, format: PhaseFormat): string {
  return text.t(`phases.formats.${format}`);
}

/** Résumé d'une phase repliée — `phaseSummary`. */
export function phaseSummaryText(text: TournamentFormText, phase: PhaseConfig, isLast: boolean): string {
  const format = phaseFormatText(text, phase.format);
  if (isLast) return text.t("phases.summaryFinal", { format });
  if (phase.qualifierMode === "COUNT") return text.t("phases.summaryCount", { format, count: phase.qualifierValue });
  return text.t("phases.summaryPercent", { format, value: phase.qualifierValue });
}

/** Refus du plan de phases, phase désignée en tête — `phaseIssueMessage`. */
export function phaseIssueText(text: TournamentFormText, errors: TournamentErrorsText, issue: PhaseIssue): string {
  const codes: Readonly<Record<string, string>> = errors.messages.codes;
  const message = Object.hasOwn(codes, issue.code) ? mapError(issue.code, errors) : text.t("phases.fallbackError");
  return issue.phaseIndex === null ? message : text.t("phases.issue", { index: issue.phaseIndex + 1, message });
}

/** Aperçu ligne à ligne du plan résolu — `describePhasePlan`. */
export function phasePlanText(text: TournamentFormText, plan: ResolvedPhase[]): string[] {
  const { t } = text;
  return plan.map((phase, index) => {
    const values = {
      phase: t("phases.plan.phase", { position: phase.position }),
      format: phaseFormatText(text, phase.format),
      teams: t("phases.plan.teams", { count: phase.entrants }),
    };
    if (phase.skipped) {
      const reason = t(phase.skipReason === "NO_CUT" ? "phases.plan.reasonNoCut" : "phases.plan.reasonTooFew");
      return t("phases.plan.skipped", { ...values, reason: phase.skipReason === null ? "" : reason });
    }
    if (index === plan.length - 1) return t("phases.plan.final", values);
    return t("phases.plan.qualify", { ...values, qualifiers: t("phases.plan.qualifiers", { count: phase.qualifiers }) });
  });
}
