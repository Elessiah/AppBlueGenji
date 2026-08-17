/**
 * Logique pure de conception des tournois multi-mode (multi-phase).
 *
 * Les phases se font suite : chaque phase qualifie un certain nombre d'équipes
 * à la phase suivante. Le mode de qualification peut être un nombre fixe (COUNT)
 * ou un pourcentage (PERCENT). La dernière phase toujours couronne 1 championne.
 *
 * Ce module ne dépend d'aucune base de données : il est entièrement testable.
 */

import type { PhaseFormat, PhaseQualifierMode } from "./types";

export const MIN_PHASES = 2;
export const MAX_PHASES = 8;

/**
 * Forme d'entrée pour créer une phase. Contient la configuration de base,
 * sans les champs déduits (entrants, qualifiants, état).
 */
export type PhaseConfig = {
  position: number;
  format: PhaseFormat;
  name: string | null;
  qualifierMode: PhaseQualifierMode;
  qualifierValue: number;
  hasThirdPlaceMatch: boolean;
  swissTotalRounds: number | null;
  survivalRoundsBeforeFirstCut: number | null;
  survivalRoundsPerCut: number | null;
};

/**
 * Phase résolue après déduction des effectifs et des qualifications.
 * Contient tous les champs de {@link PhaseConfig} plus les champs d'exécution.
 */
export type ResolvedPhase = PhaseConfig & {
  /** Nombre d'équipes entrant dans la phase. */
  entrants: number;
  /** Nombre d'équipes qualifiées pour la phase suivante (ou championnes si c'est la dernière). */
  qualifiers: number;
  /** Vrai si la phase doit être ignorée (pas assez d'équipes ou pas de cut effectif). */
  skipped: boolean;
  /** Raison du saut : "TOO_FEW_TEAMS" (≤1 équipes) ou "NO_CUT" (cut supérieur aux entrants). */
  skipReason: "TOO_FEW_TEAMS" | "NO_CUT" | null;
  /**
   * Nombre de rounds pour éliminer jusqu'aux qualifiants, en élimination simple.
   * Null pour format non-SINGLE, pour la dernière phase, ou si la phase est sautée.
   */
  maxRounds: number | null;
};

/**
 * Calcule la plus grande puissance de deux strictement inférieure ou égale à n.
 *
 * Exemples :
 * - previousPowerOfTwo(128) = 128
 * - previousPowerOfTwo(100) = 64
 * - previousPowerOfTwo(1) = 1
 * - previousPowerOfTwo(0) = 1
 *
 * Utilisé pour ajuster les qualifiants des phases d'élimination simple : un bracket
 * tronqué ne peut laisser qu'une puissance de deux survivantes.
 */
export function previousPowerOfTwo(n: number): number {
  if (n <= 0) return 1;
  let power = 1;
  while (power * 2 <= n) {
    power *= 2;
  }
  return power;
}

/**
 * Calcule la plus petite puissance de deux strictement supérieure ou égale à n.
 * Utilisée en interne pour calculer le nombre de rounds maximal d'une phase.
 */
function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  let power = 1;
  while (power < n) {
    power *= 2;
  }
  return power;
}

/**
 * Déduit le nombre d'équipes qualifiées d'une phase, selon son mode de qualification.
 *
 * Règles :
 * - Dernière phase : toujours 1 (couronne la championne).
 * - COUNT : renvoie {@link PhaseConfig.qualifierValue}, clamé en [1, entrants].
 * - PERCENT : renvoie ⌈entrants × qualifierValue / 100⌉, clamé en [1, entrants].
 * - SINGLE (non-dernière) : le nombre est ensuite ajusté à la baisse jusqu'à une
 *   puissance de deux (un bracket tronqué ne laisse qu'une puissance de deux).
 *   Jamais en dessous de 1.
 *
 * @param entrants Nombre d'équipes dans la phase.
 * @param phase Configuration de la phase.
 * @param isLast Vrai si c'est la dernière phase du tournoi.
 * @returns Nombre d'équipes qualifiées.
 */
export function resolvePhaseQualifiers(
  entrants: number,
  phase: PhaseConfig,
  isLast: boolean,
): number {
  if (isLast) return 1;

  const target = rawQualifierTarget(entrants, phase);

  // Le snap est une contrainte du **format**, pas du mode de qualification : un
  // bracket tronqué ne peut laisser qu'une puissance de deux, que la cible ait
  // été exprimée en nombre ou en pourcentage. On ne l'applique pas quand aucune
  // équipe n'est éliminée (cible = entrants) : la phase laisse alors tout passer.
  if (phase.format === "SINGLE" && target < entrants) {
    return Math.max(1, previousPowerOfTwo(target));
  }

  return Math.max(1, target);
}

/**
 * Cible **demandée** par l'organisateur, clamée en [1, entrants] mais sans
 * l'ajustement puissance de deux.
 *
 * C'est cette valeur — et non la cible ajustée — qui décide du saut d'une phase :
 * si l'organisateur réclame 100 qualifiées et que 50 équipes se présentent, la
 * phase n'élimine personne et doit être sautée. Décider après l'ajustement
 * rendrait une phase d'élimination simple insautable (64 → 32 « coupe »
 * toujours quelque chose).
 */
function rawQualifierTarget(entrants: number, phase: PhaseConfig): number {
  if (phase.qualifierMode === "COUNT") {
    return Math.max(1, Math.min(phase.qualifierValue, entrants));
  }
  return Math.max(1, Math.min(Math.ceil((entrants * phase.qualifierValue) / 100), entrants));
}

/**
 * Parcourt les phases et déduit les effectifs et qualifications pour chacune.
 *
 * Algorithme :
 * - Effectifs : la phase 1 reçoit {@link participantCount} équipes, la phase i > 1
 *   reçoit les qualifiants de la phase i-1.
 * - Saut : une phase est ignorée si elle n'a ≤1 équipe ou pas de cut effectif
 *   (qualifiants ≥ entrants).
 * - maxRounds : calculé uniquement pour une phase SINGLE, non-sautée, non-dernière.
 *
 * @param participantCount Nombre total d'équipes au départ.
 * @param phases Configurations des phases dans l'ordre (triées par position).
 * @returns Phases résolues avec leurs effectifs et qualifications déduits.
 */
export function resolvePhasePlan(
  participantCount: number,
  phases: PhaseConfig[],
): ResolvedPhase[] {
  const resolved: ResolvedPhase[] = [];
  let currentEntrants = participantCount;

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const isLast = i === phases.length - 1;

    let skipped = false;
    let skipReason: "TOO_FEW_TEAMS" | "NO_CUT" | null = null;
    let qualifiers = currentEntrants;
    let maxRounds: number | null = null;

    // Pas assez d'équipes.
    if (currentEntrants <= 1) {
      skipped = true;
      skipReason = "TOO_FEW_TEAMS";
      qualifiers = currentEntrants;
    } else if (!isLast) {
      // Phase non-finale. Le saut se décide sur la cible **demandée**, avant tout
      // ajustement puissance de deux (cf. rawQualifierTarget).
      const requested = rawQualifierTarget(currentEntrants, phase);

      if (requested >= currentEntrants) {
        // La phase n'éliminerait personne.
        //
        // En mode COUNT, c'est le comportement attendu par l'organisateur : la
        // cible fixe est un seuil, et un tournoi sous-rempli saute purement et
        // simplement le mode. En mode PERCENT au contraire, la cible s'adapte
        // toujours à l'effectif réel — on ne saute pas, on laisse passer tout le
        // monde (cas limite : 100 %, que `validatePhases` refuse déjà à la
        // création).
        qualifiers = currentEntrants;
        if (phase.qualifierMode === "COUNT") {
          skipped = true;
          skipReason = "NO_CUT";
        }
      } else {
        qualifiers = resolvePhaseQualifiers(currentEntrants, phase, false);
        // maxRounds n'a de sens que pour un bracket tronqué d'élimination simple.
        if (phase.format === "SINGLE") {
          const entrantsPow = nextPowerOfTwo(currentEntrants);
          maxRounds = Math.round(Math.log2(entrantsPow / qualifiers));
        }
      }
    } else {
      // Phase finale : qualifiants = 1.
      qualifiers = 1;
    }

    resolved.push({
      ...phase,
      entrants: currentEntrants,
      qualifiers,
      skipped,
      skipReason,
      maxRounds,
    });

    // Préparer l'effectif de la phase suivante.
    currentEntrants = qualifiers;
  }

  return resolved;
}

/**
 * Complète des phases brutes (payload HTTP, jeu de test) en {@link PhaseConfig}.
 *
 * La **position** est déduite du rang dans le tableau : c'est l'ordre du tableau
 * qui porte le déroulé du tournoi, et le client n'a donc pas à la renseigner —
 * ce qui évite qu'une position erronée contredise l'ordre affiché à l'écran.
 */
export function normalizePhaseConfigs(raw: readonly Partial<PhaseConfig>[]): PhaseConfig[] {
  return raw.map((phase, index) => ({
    position: index + 1,
    format: (phase.format ?? "SINGLE") as PhaseFormat,
    name: phase.name ?? null,
    qualifierMode: (phase.qualifierMode ?? "COUNT") as PhaseQualifierMode,
    qualifierValue: Number(phase.qualifierValue ?? 0),
    hasThirdPlaceMatch: Boolean(phase.hasThirdPlaceMatch),
    swissTotalRounds: phase.swissTotalRounds ?? null,
    survivalRoundsBeforeFirstCut:
      phase.survivalRoundsBeforeFirstCut ?? phase.survivalRoundsPerCut ?? null,
    survivalRoundsPerCut: phase.survivalRoundsPerCut ?? null,
  }));
}

/**
 * Valide une liste de configurations de phases.
 *
 * Codes d'erreur (SCREAMING_SNAKE) :
 * - `INVALID_PHASE_COUNT` : < MIN_PHASES ou > MAX_PHASES.
 * - `INVALID_PHASE_POSITIONS` : positions non exactement 1..n après tri.
 * - `INVALID_PHASE_FORMAT` : format invalide.
 * - `DOUBLE_MUST_BE_LAST_PHASE` : DOUBLE n'est pas la dernière.
 * - `INVALID_PHASE_QUALIFIER` : COUNT < 1 ou PERCENT hors 1..99.
 * - `NON_DECREASING_PHASE_QUALIFIERS` : deux COUNT consécutives non-décroissantes.
 * - `INVALID_PHASE_SWISS_ROUNDS` : SWISS sans rounds en 1..20.
 * - `INVALID_PHASE_SURVIVAL_ROUNDS` : SURVIVAL avec cadence hors 1..50.
 *
 * @param phases Configurations des phases à valider.
 * @returns Message d'erreur (code en majuscules) ou null si valides.
 */
export function validatePhases(phases: PhaseConfig[]): string | null {
  // Nombre de phases.
  if (phases.length < MIN_PHASES || phases.length > MAX_PHASES) {
    return "INVALID_PHASE_COUNT";
  }

  // Positions : exactement 1..n **dans l'ordre du tableau**. On ne trie pas, car
  // l'ordre du tableau porte déjà le déroulé du tournoi (c'est lui qui décide
  // quelle phase est la dernière) : accepter un tableau désordonné laisserait
  // deux sources de vérité contradictoires.
  for (let i = 0; i < phases.length; i++) {
    if (phases[i].position !== i + 1) {
      return "INVALID_PHASE_POSITIONS";
    }
  }

  // Valider chaque phase.
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const isLast = i === phases.length - 1;

    // Format.
    if (!["SINGLE", "DOUBLE", "SWISS", "SURVIVAL"].includes(phase.format)) {
      return "INVALID_PHASE_FORMAT";
    }

    // DOUBLE doit être la dernière phase.
    if (phase.format === "DOUBLE" && !isLast) {
      return "DOUBLE_MUST_BE_LAST_PHASE";
    }

    // Qualifiants.
    if (!isLast) {
      if (phase.qualifierMode === "COUNT") {
        if (phase.qualifierValue < 1) {
          return "INVALID_PHASE_QUALIFIER";
        }
      } else if (phase.qualifierMode === "PERCENT") {
        if (phase.qualifierValue < 1 || phase.qualifierValue > 99) {
          return "INVALID_PHASE_QUALIFIER";
        }
      }
    }

    // Manches SWISS.
    if (phase.format === "SWISS") {
      if (
        phase.swissTotalRounds !== null &&
        (typeof phase.swissTotalRounds !== "number" || phase.swissTotalRounds < 1 || phase.swissTotalRounds > 20)
      ) {
        return "INVALID_PHASE_SWISS_ROUNDS";
      }
    }

    // Cadences SURVIE.
    if (phase.format === "SURVIVAL") {
      if (
        phase.survivalRoundsBeforeFirstCut !== null &&
        (typeof phase.survivalRoundsBeforeFirstCut !== "number" ||
          phase.survivalRoundsBeforeFirstCut < 1 ||
          phase.survivalRoundsBeforeFirstCut > 50)
      ) {
        return "INVALID_PHASE_SURVIVAL_ROUNDS";
      }
      if (
        phase.survivalRoundsPerCut !== null &&
        (typeof phase.survivalRoundsPerCut !== "number" ||
          phase.survivalRoundsPerCut < 1 ||
          phase.survivalRoundsPerCut > 50)
      ) {
        return "INVALID_PHASE_SURVIVAL_ROUNDS";
      }
    }
  }

  // Décroissance stricte des COUNT consécutifs. La **dernière** phase est exclue :
  // sa valeur de qualification n'est jamais lue (elle couronne toujours une seule
  // championne), donc la comparer produirait un refus sur un plan parfaitement
  // valide comme « 64 qualifiées puis finale ».
  for (let i = 0; i + 2 < phases.length; i++) {
    const current = phases[i];
    const next = phases[i + 1];
    if (
      current.qualifierMode === "COUNT" &&
      next.qualifierMode === "COUNT" &&
      current.qualifierValue <= next.qualifierValue
    ) {
      return "NON_DECREASING_PHASE_QUALIFIERS";
    }
  }

  return null;
}

/**
 * Génère des descriptions FRANÇAIS lisibles d'un plan de phases.
 *
 * Exemples :
 * - "Phase 1 — Ronde suisse : 128 équipes → 64 qualifiées"
 * - "Phase 2 — Survie : ignorée (effectif déjà ≤ 1)"
 * - "Phase 3 — Finale — Double : 8 équipes"
 *
 * @param plan Phases résolues (résultat de {@link resolvePhasePlan}).
 * @returns Tableau de descriptions, une par phase.
 */
export function describePhasePlan(plan: ResolvedPhase[]): string[] {
  const formatName = (format: PhaseFormat): string => {
    switch (format) {
      case "SINGLE":
        return "Élimination simple";
      case "DOUBLE":
        return "Double élimination";
      case "SWISS":
        return "Ronde suisse";
      case "SURVIVAL":
        return "Survie";
    }
  };

  return plan.map((phase, idx) => {
    const phaseLabel = `Phase ${phase.position}`;

    if (phase.skipped) {
      let reason = "";
      if (phase.skipReason === "TOO_FEW_TEAMS") {
        reason = "effectif insuffisant";
      } else if (phase.skipReason === "NO_CUT") {
        reason = "pas d'élimination";
      }
      const teams = `${phase.entrants} équipe${phase.entrants > 1 ? "s" : ""}`;
      return `${phaseLabel} — ${formatName(phase.format)} : ${teams} — ignorée (${reason})`;
    }

    const isLast = idx === plan.length - 1;
    const phaseTitle = isLast ? "Finale" : null;
    const formatStr = formatName(phase.format);
    const titlePart = phaseTitle ? ` — ${phaseTitle}` : "";

    if (isLast) {
      return `${phaseLabel}${titlePart} — ${formatStr} : ${phase.entrants} équipe${phase.entrants > 1 ? "s" : ""}`;
    }

    return `${phaseLabel} — ${formatStr} : ${phase.entrants} équipe${phase.entrants > 1 ? "s" : ""} → ${phase.qualifiers} qualifiée${phase.qualifiers > 1 ? "s" : ""}`;
  });
}
