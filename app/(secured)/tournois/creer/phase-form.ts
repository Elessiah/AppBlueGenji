import { PHASE_ERROR_MESSAGES, type PhaseConfig } from "@/lib/shared/tournament-phases";
import type { PhaseFormat } from "@/lib/shared/types";

export function createDefaultPhase(position: number, format: PhaseFormat): PhaseConfig {
  return {
    position,
    format,
    name: null,
    qualifierMode: "PERCENT",
    qualifierValue: format === "SURVIVAL" ? 100 : 50,
    hasThirdPlaceMatch: false,
    swissTotalRounds: null,
    survivalRoundsBeforeFirstCut: 3,
    survivalRoundsPerCut: 3,
  };
}

export function movePhase(
  phases: PhaseConfig[],
  index: number,
  direction: -1 | 1,
): PhaseConfig[] {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= phases.length) return phases;

  const moved = [...phases];
  [moved[index], moved[newIndex]] = [moved[newIndex], moved[index]];

  // Renumber positions
  return moved.map((p, i) => ({ ...p, position: i + 1 }));
}

export function removePhase(phases: PhaseConfig[], index: number): PhaseConfig[] {
  const removed = phases.filter((_, i) => i !== index);
  return removed.map((p, i) => ({ ...p, position: i + 1 }));
}

export function addPhase(phases: PhaseConfig[], format: PhaseFormat): PhaseConfig[] {
  const nextPosition = phases.length + 1;
  return [...phases, createDefaultPhase(nextPosition, format)];
}

export function phaseFormatLabel(format: PhaseFormat): string {
  switch (format) {
    case "SINGLE":
      return "Élimination simple";
    case "DOUBLE":
      return "Double élimination";
    case "SWISS":
      return "Ronde suisse";
    case "SURVIVAL":
      return "Survie";
    default:
      const _: never = format;
      return _;
  }
}

export function phaseSummary(phase: PhaseConfig, isLast: boolean): string {
  const formatLabel = phaseFormatLabel(phase.format);

  if (isLast) {
    return `${formatLabel} — phase finale`;
  }

  if (phase.qualifierMode === "COUNT") {
    return `${formatLabel} — ${phase.qualifierValue} équipe${phase.qualifierValue > 1 ? "s" : ""}`;
  }

  return `${formatLabel} — ${phase.qualifierValue} % qualifiées`;
}

/**
 * Phrase d'un refus du plan de phases. La table est partagée avec la
 * notification des refus serveur (`PHASE_ERROR_MESSAGES`).
 */
export function phaseErrorMessage(code: string): string {
  return PHASE_ERROR_MESSAGES[code] ?? "Erreur de configuration des phases.";
}
