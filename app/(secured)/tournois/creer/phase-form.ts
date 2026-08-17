import type { PhaseConfig } from "@/lib/shared/tournament-phases";
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

export function phaseErrorMessage(code: string): string {
  switch (code) {
    case "INVALID_PHASE_COUNT":
      return "Nombre de phases invalide : 2 à 8 phases attendues.";
    case "INVALID_PHASE_POSITIONS":
      return "Positions des phases invalides.";
    case "INVALID_PHASE_FORMAT":
      return "Format de phase invalide.";
    case "DOUBLE_MUST_BE_LAST_PHASE":
      return "La double élimination ne peut être que la dernière phase.";
    case "INVALID_PHASE_QUALIFIER":
      return "Qualification invalide : COUNT ≥ 1 ou PERCENT ∈ 1..99.";
    case "NON_DECREASING_PHASE_QUALIFIERS":
      return "Les qualifications en nombre fixe doivent décroître entre les phases.";
    case "INVALID_PHASE_SWISS_ROUNDS":
      return "Nombre de manches ronde suisse invalide : 1 à 20 attendues.";
    case "INVALID_PHASE_SURVIVAL_ROUNDS":
      return "Cadence de survie invalide : 1 à 50 attendues.";
    default:
      return "Erreur de configuration des phases.";
  }
}
