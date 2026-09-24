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

/**
 * Phrases des refus d'un plan de phases, **toutes origines confondues** : le
 * contrôle local du formulaire (`validatePhases`) et le contrôle « ami » du
 * serveur (`validateRawPhases`, dont les codes arrivent par `mapError`). La table
 * est partagée avec `ERROR_MESSAGES` : deux listes auraient laissé un code
 * traduit ici et brut dans la notification de la création.
 *
 * `INVALID_SURVIVAL_ROUNDS` et `INVALID_SWISS_ROUNDS` n'y figurent pas : le
 * serveur les emploie aussi pour un tournoi sans phases, leur phrase vit donc
 * dans `ERROR_MESSAGES`, formulée pour valoir dans les deux cas.
 */
export const PHASE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  MISSING_PHASES: "Un tournoi multi-phases doit décrire ses phases.",
  INVALID_PHASE_COUNT: "Nombre de phases invalide : 2 à 8 phases attendues.",
  INVALID_PHASE_POSITIONS: "Positions des phases invalides.",
  INVALID_PHASE_FORMAT: "Format de phase invalide.",
  DOUBLE_MUST_BE_LAST_PHASE: "La double élimination ne peut être que la dernière phase.",
  INVALID_PHASE_QUALIFIER:
    "Qualification invalide : au moins une équipe en nombre fixe, ou de 1 à 99 % en pourcentage.",
  INVALID_QUALIFIER_VALUE:
    "Qualification invalide : au moins une équipe en nombre fixe, ou de 1 à 99 % en pourcentage.",
  INVALID_QUALIFIER_COUNT: "Une phase ne peut pas qualifier plus d'engagés que celle qui la précède.",
  NON_DECREASING_PHASE_QUALIFIERS:
    "Les qualifications en nombre fixe doivent décroître entre les phases.",
  INVALID_PHASE_SWISS_ROUNDS: "Nombre de manches ronde suisse invalide : 1 à 20 attendues.",
  INVALID_PHASE_SURVIVAL_ROUNDS: "Cadence de survie invalide : 1 à 50 attendues.",
};

export function phaseErrorMessage(code: string): string {
  return PHASE_ERROR_MESSAGES[code] ?? "Erreur de configuration des phases.";
}
