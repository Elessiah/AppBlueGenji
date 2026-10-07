import type { TournamentPhase, PhaseFormat, PhaseState, TournamentFormat } from "@/lib/shared/types";
import type { PillVariant } from "@/components/cyber/Pill";
import { FR_TOURNAMENT_PAGE_TEXT, type TournamentPageText } from "@/lib/shared/tournament-page-text";

export function phaseFormatLabel(format: PhaseFormat, text: TournamentPageText = FR_TOURNAMENT_PAGE_TEXT): string {
  return text.t(`phases.formats.${format}`);
}

export function phaseStateLabel(state: PhaseState, text: TournamentPageText = FR_TOURNAMENT_PAGE_TEXT): string {
  return text.t(`phases.states.${state}`);
}

/** Variante de pastille d'une phase de la frise (`PhaseTimeline`). */
export type PhaseStateVariant = Extract<PillVariant, "info" | "accent" | "success" | "neutral">;

/**
 * Teinte de l'état d'une phase, alignée sur celle des tournois
 * (`STATE_META`) : une phase terminée est `success` — même courante, la
 * dernière phase d'un tournoi fini le restant —, la phase courante ou en cours
 * `info`, une phase à venir `accent` ; seule une phase ignorée reste `neutral`.
 * Jamais `live` : une phase en cours n'est pas une diffusion.
 */
export function phaseStateVariant(state: PhaseState, isCurrent: boolean): PhaseStateVariant {
  if (state === "SKIPPED") return "neutral";
  if (state === "FINISHED") return "success";
  return isCurrent || state === "RUNNING" ? "info" : "accent";
}

export function phaseSubtitle(
  phase: TournamentPhase,
  isLast: boolean,
  text: TournamentPageText = FR_TOURNAMENT_PAGE_TEXT,
): string {
  if (phase.state === "SKIPPED") return text.t("phases.skipped");
  if (isLast) return text.t("phases.final");
  if (phase.entrants !== null && phase.qualifiers !== null) {
    return text.t("phases.flow", { entrants: phase.entrants, qualifiers: phase.qualifiers });
  }
  return "";
}

export function defaultSelectedPhaseId(
  phases: TournamentPhase[] | null | undefined,
  currentPhaseId: number | null,
): number | null {
  if (!phases || phases.length === 0) return null;

  if (currentPhaseId !== null) {
    const running = phases.find((p) => p.id === currentPhaseId);
    if (running) return running.id;
  }

  const finished = [...phases].reverse().find((p) => p.state === "FINISHED" && p.id !== currentPhaseId);
  if (finished) return finished.id;

  const nonSkipped = phases.find((p) => p.state !== "SKIPPED");
  if (nonSkipped) return nonSkipped.id;

  return phases[0]?.id ?? null;
}

export function visibleRulesFormat(
  card: { format: TournamentFormat },
  selectedPhase: TournamentPhase | null,
): TournamentFormat {
  if (card.format === "MULTI" && selectedPhase) {
    return selectedPhase.format;
  }
  return card.format;
}
