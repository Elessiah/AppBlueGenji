import type { TournamentPhase, PhaseFormat, PhaseState, TournamentFormat } from "@/lib/shared/types";
import type { PillVariant } from "@/components/cyber/Pill";

export function phaseFormatLabel(format: PhaseFormat): string {
  switch (format) {
    case "SWISS":
      return "Ronde suisse";
    case "SURVIVAL":
      return "Survie par coupes";
    case "DOUBLE":
      return "Double élimination";
    case "SINGLE":
      return "Simple élimination";
  }
}

export function phaseStateLabel(state: PhaseState): string {
  switch (state) {
    case "PENDING":
      return "À venir";
    case "RUNNING":
      return "En cours";
    case "FINISHED":
      return "Terminée";
    case "SKIPPED":
      return "Ignorée";
  }
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

export function phaseSubtitle(phase: TournamentPhase, isLast: boolean): string {
  if (phase.state === "SKIPPED") {
    return "Ignorée — effectif insuffisant";
  }
  if (isLast) {
    return "Phase finale";
  }
  if (phase.entrants !== null && phase.qualifiers !== null) {
    return `${phase.entrants} équipe${phase.entrants > 1 ? "s" : ""} → ${phase.qualifiers} qualifiée${phase.qualifiers > 1 ? "s" : ""}`;
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
