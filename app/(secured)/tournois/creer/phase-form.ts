import {
  PHASE_ERROR_MESSAGES,
  type PhaseConfig,
  type PhaseIssue,
  type PhaseIssueField,
} from "@/lib/shared/tournament-phases";
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
  return Object.hasOwn(PHASE_ERROR_MESSAGES, code)
    ? PHASE_ERROR_MESSAGES[code]
    : "Erreur de configuration des phases.";
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
