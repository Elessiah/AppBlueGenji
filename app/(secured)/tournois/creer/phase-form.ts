import type { PhaseConfig, PhaseIssue, PhaseIssueField } from "@/lib/shared/tournament-phases";
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

/**
 * Préfixe de l'`id` de chaque réglage d'une phase, suffixé par sa position.
 *
 * Écrit une fois pour deux lecteurs : `PhaseCard`, qui pose les `id`, et le
 * rattachement d'un refus à son champ (`PhaseBuilder`), qui les focalise — un
 * `id` recopié à la main dériverait, et le focus partirait nulle part sans
 * erreur.
 */
const PHASE_FIELD_ID_PREFIX: Record<PhaseIssueField, string> = {
  format: "phase-format",
  qualifierValue: "phase-qualifier",
  swissTotalRounds: "phase-swiss",
  survivalRoundsBeforeFirstCut: "phase-survival-before",
  survivalRoundsPerCut: "phase-survival-per",
};

/** `id` du contrôle d'un réglage de la phase `position` (1..n). */
export function phaseFieldId(position: number, field: PhaseIssueField): string {
  return `${PHASE_FIELD_ID_PREFIX[field]}-${position}`;
}

/**
 * Phrase d'un défaut du plan, **située** : « Phase 2 — … ». La phrase seule ne
 * disait pas laquelle reprendre, sur un plan qui peut en compter huit.
 */
export function phaseIssueMessage(issue: PhaseIssue): string {
  const message = phaseErrorMessage(issue.code);
  return issue.phaseIndex === null ? message : `Phase ${issue.phaseIndex + 1} — ${message}`;
}
