/**
 * Aperçu du plateau pendant les inscriptions — logique pure, partagée
 * client/serveur.
 *
 * Le staff (permission `tournaments`) et le cast (permission `casting`) ont
 * besoin de voir à quoi ressemblerait le tournoi **avant** son lancement : pour
 * réordonner le seeding en connaissance de cause, et pour se placer sur les
 * matchs à diffuser. Plutôt que d'ouvrir une phase de préparation qui rognerait
 * la fenêtre d'inscription, l'aperçu se recalcule à chaque inscription — il
 * n'écrit rien et ne crée aucun match.
 *
 * Règle d'or : l'aperçu doit produire **exactement** l'appariement que le
 * moteur produira au démarrage. Il réutilise donc les mêmes fonctions pures que
 * l'orchestration : `bracket-seeds` pour l'élimination, `planFirstRound` pour la
 * ronde suisse, `planSurvivalRound` pour la survie, `planEnduranceRound` pour la
 * BlueGenji Survie et `resolvePhasePlan` pour le multi-phases.
 */
import { nextPowerOfTwo, seedSlots } from "./bracket-seeds";
import {
  planEnduranceRound,
  resolveEnduranceConfig,
  type EnduranceStanding,
} from "./bg-survie";
import { planSurvivalRound, type SurvivalStanding } from "./survival";
import { computeRecommendedRounds } from "./swiss";
import { planFirstRound, type Participant } from "./swiss-pairing";
import {
  describePhasePlan,
  resolvePhasePlan,
  type PhaseConfig,
  type ResolvedPhase,
} from "./tournament-phases";
import type { TournamentFormat } from "./types";

/** Un engagé, à la place qu'il occupe dans l'ordre de seeding (1 = tête). */
export type PreviewEntrant = {
  teamId: number;
  teamName: string;
  seed: number;
};

/**
 * Nature d'une ligne d'aperçu :
 * - `MATCH` — affrontement ordinaire ;
 * - `BYE` — qualification d'office (plateau incomplet, ou effectif impair) ;
 * - `BARRAGE` — match d'équilibrage de la survie : seules ces deux équipes
 *   jouent le premier round, le perdant sort ;
 * - `REST` — l'équipe ne joue pas la manche et ne gagne rien (BlueGenji Survie).
 */
export type PreviewPairingKind = "MATCH" | "BYE" | "BARRAGE" | "REST";

export type PreviewPairing = {
  /** Rang d'affichage dans la manche, à partir de 1. */
  position: number;
  teamA: PreviewEntrant | null;
  teamB: PreviewEntrant | null;
  kind: PreviewPairingKind;
};

/**
 * D'où vient l'ordre affiché — la même distinction que `manual_seeding` :
 * - `MANUAL` — ordre fixé à la main par le staff, il fait autorité ;
 * - `RANKING` — classement du site (survie, suisse, multi-phases) ;
 * - `REGISTRATION` — ordre d'arrivée des inscriptions (formats à plateau).
 */
export type PreviewSeedingSource = "MANUAL" | "RANKING" | "REGISTRATION";

/** Libellés FR de la provenance de l'ordre, pour l'interface. */
export const SEEDING_SOURCE_LABELS: Record<PreviewSeedingSource, string> = {
  MANUAL: "Ordre fixé par le staff",
  RANKING: "Classement du site",
  REGISTRATION: "Ordre d'inscription",
};

export type TournamentPreviewInput = {
  format: TournamentFormat;
  /**
   * Élimination simple **tronquée** : nombre de tours réellement joués, quand
   * le plateau ne sert qu'à qualifier (phase intermédiaire d'un multi-phases).
   * `null` = plateau complet, joué jusqu'à la championne.
   */
  maxRounds?: number | null;
  /** Engagés **déjà triés** dans l'ordre de seeding effectif. */
  entrants: readonly PreviewEntrant[];
  seedingSource: PreviewSeedingSource;
  /** Ronde suisse : nombre de rondes fixé à la création (null = recommandé). */
  swissTotalRounds?: number | null;
  /** Survie : cadence des coupes. */
  survivalRoundsBeforeFirstCut?: number | null;
  survivalRoundsPerCut?: number | null;
  /** BlueGenji Survie : effectif de la phase éliminatoire. */
  endurancePlayoffSize?: number | null;
  /** Multi-phases : configuration des phases, dans l'ordre. */
  phases?: readonly PhaseConfig[] | null;
};

export type TournamentPreview = {
  /**
   * Format réellement prévisualisé. En multi-phases, c'est celui de la première
   * phase **effectivement jouée** — une phase sautée ne produit aucun match.
   */
  format: TournamentFormat;
  seedingSource: PreviewSeedingSource;
  entrants: PreviewEntrant[];
  /** Libellé de la manche prévisualisée (« 1er tour », « Ronde 1 »…). */
  roundLabel: string;
  pairings: PreviewPairing[];
  /** Élimination : taille du plateau (puissance de deux), sinon `null`. */
  bracketSize: number | null;
  /** Nombre de manches connu d'avance (élimination, suisse), sinon `null`. */
  rounds: number | null;
  /**
   * Le mot qui compte ces manches, au singulier — « tour » en élimination,
   * « ronde » en suisse. L'interface n'a ainsi pas à retrouver le vocabulaire
   * du format, ni à en contredire le libellé de manche.
   */
  roundsUnit: string;
  /** Nombre d'exemptions de premier tour. */
  byeCount: number;
  /** Remarques à afficher au staff (effectif impair, plateau incomplet…). */
  notes: string[];
  /** Multi-phases : déroulé résolu pour l'effectif courant, sinon `null`. */
  phasePlan: string[] | null;
};

const DEFAULT_SURVIVAL_ROUNDS_PER_CUT = 3;

/** Accord en nombre : « 1 équipe », « 4 équipes ». */
function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

function indexEntrants(entrants: readonly PreviewEntrant[]): Map<number, PreviewEntrant> {
  return new Map(entrants.map((entrant) => [entrant.teamId, entrant]));
}

/** Squelette commun : un aperçu sans appariement, porteur d'une remarque. */
function emptyPreview(
  input: TournamentPreviewInput,
  format: TournamentFormat,
  notes: string[],
  phasePlan: string[] | null = null,
): TournamentPreview {
  return {
    format,
    seedingSource: input.seedingSource,
    entrants: [...input.entrants],
    roundLabel: "",
    pairings: [],
    bracketSize: null,
    rounds: null,
    roundsUnit: "manche",
    byeCount: 0,
    notes,
    phasePlan,
  };
}

/**
 * Nombre de manches annoncé pour un plateau d'élimination.
 *
 * - `SINGLE` complet : la profondeur du plateau ;
 * - `SINGLE` tronqué (phase qualificative d'un multi-phases) : les tours
 *   réellement joués, tels que les a résolus `resolvePhasePlan` ;
 * - `DOUBLE` : **inconnu d'avance** — tableau principal, tableau des perdants
 *   et grande finale s'enchaînent, annoncer la seule profondeur du tableau
 *   principal reviendrait à en promettre la moitié.
 */
function eliminationRounds(
  format: "SINGLE" | "DOUBLE",
  bracketSize: number,
  maxRounds: number | null | undefined,
): number | null {
  if (format === "DOUBLE") return null;
  const fullRounds = Math.round(Math.log2(bracketSize));
  return maxRounds ? Math.min(fullRounds, maxRounds) : fullRounds;
}

/** Élimination simple ou double : placement des têtes de série au premier tour. */
function previewElimination(
  input: TournamentPreviewInput,
  format: "SINGLE" | "DOUBLE",
): TournamentPreview {
  const entrants = [...input.entrants];
  const bracketSize = nextPowerOfTwo(entrants.length);
  const slots = seedSlots(entrants, bracketSize);

  const pairings: PreviewPairing[] = [];
  for (let index = 0; index * 2 < slots.length; index += 1) {
    const teamA = slots[index * 2];
    const teamB = slots[index * 2 + 1];
    pairings.push({
      position: index + 1,
      teamA,
      teamB,
      // Un seul des deux emplacements occupé : l'engagé passe le tour d'office.
      kind: (teamA === null) !== (teamB === null) ? "BYE" : "MATCH",
    });
  }

  const byeCount = pairings.filter((pairing) => pairing.kind === "BYE").length;
  const notes: string[] = [];

  if (byeCount > 0) {
    notes.push(
      `Plateau de ${bracketSize} : ${plural(byeCount, "exemption")} de premier tour (bye).`,
    );
  }
  const rounds = eliminationRounds(format, bracketSize, input.maxRounds);
  if (rounds !== null && rounds < Math.round(Math.log2(bracketSize))) {
    notes.push(
      `Plateau tronqué : ${plural(rounds, "tour")} joué${rounds > 1 ? "s" : ""}, le reste des engagés étant qualifié pour la phase suivante.`,
    );
  }
  if (format === "DOUBLE") {
    notes.push(
      "Le tableau des perdants se remplit au fil des éliminations : il n'a pas d'appariement d'avance.",
    );
  }

  return {
    format,
    seedingSource: input.seedingSource,
    entrants,
    roundLabel: "1er tour",
    roundsUnit: "tour",
    pairings,
    bracketSize,
    rounds: eliminationRounds(format, bracketSize, input.maxRounds),
    byeCount,
    notes,
    phasePlan: null,
  };
}

/** Ronde suisse : moitié haute contre moitié basse, comme la ronde 1 du moteur. */
function previewSwiss(input: TournamentPreviewInput): TournamentPreview {
  const entrants = [...input.entrants];
  const lookup = indexEntrants(entrants);

  const participants: Participant[] = entrants.map((entrant) => ({
    teamId: entrant.teamId,
    points: 0,
    opponentIds: [],
    hasReceivedBye: false,
    seed: entrant.seed,
  }));

  const plan = planFirstRound(participants);
  const pairings: PreviewPairing[] = plan.pairings.map((pairing, index) => ({
    position: index + 1,
    teamA: lookup.get(pairing.teamAId) ?? null,
    teamB: pairing.teamBId === null ? null : lookup.get(pairing.teamBId) ?? null,
    kind: "MATCH",
  }));

  const notes: string[] = [];
  if (plan.byeTeamId !== null) {
    const bye = lookup.get(plan.byeTeamId) ?? null;
    pairings.push({ position: pairings.length + 1, teamA: bye, teamB: null, kind: "BYE" });
    notes.push(
      `Effectif impair : victoire d'office pour ${bye?.teamName ?? "la dernière du seeding"}.`,
    );
  }

  const rounds = input.swissTotalRounds ?? computeRecommendedRounds(entrants.length);
  notes.push(`${plural(rounds, "ronde")} au programme, sans élimination.`);

  return {
    format: "SWISS",
    seedingSource: input.seedingSource,
    entrants,
    roundLabel: "Ronde 1",
    roundsUnit: "ronde",
    pairings,
    bracketSize: null,
    rounds,
    byeCount: plan.byeTeamId === null ? 0 : 1,
    notes,
    phasePlan: null,
  };
}

/** Survie : couples adjacents du classement, barrage possible au premier round. */
function previewSurvival(input: TournamentPreviewInput): TournamentPreview {
  const entrants = [...input.entrants];
  const lookup = indexEntrants(entrants);

  const standings: SurvivalStanding[] = entrants.map((entrant) => ({
    teamId: entrant.teamId,
    seed: entrant.seed,
    wins: 0,
    losses: 0,
    status: "ACTIVE",
    eliminatedRound: null,
    rank: entrant.seed,
    hasBye: false,
  }));

  const plan = planSurvivalRound(standings, { allowBarrage: true });
  const pairings: PreviewPairing[] = plan.pairings.map((pairing, index) => ({
    position: index + 1,
    teamA: lookup.get(pairing.teamAId) ?? null,
    teamB: pairing.teamBId === null ? null : lookup.get(pairing.teamBId) ?? null,
    kind: plan.isBarrage ? "BARRAGE" : "MATCH",
  }));

  const notes: string[] = [];
  if (plan.isBarrage) {
    notes.push(
      "Effectif impair : le premier round est un barrage entre les deux dernières du classement. Les autres ne jouent pas, et le perdant est éliminé.",
    );
  }
  if (plan.byeTeamId !== null) {
    const bye = lookup.get(plan.byeTeamId) ?? null;
    pairings.push({ position: pairings.length + 1, teamA: bye, teamB: null, kind: "BYE" });
    notes.push(`Victoire d'office pour ${bye?.teamName ?? "la dernière du classement"}.`);
  }

  const perCut = input.survivalRoundsPerCut ?? DEFAULT_SURVIVAL_ROUNDS_PER_CUT;
  const beforeFirst = input.survivalRoundsBeforeFirstCut ?? perCut;
  notes.push(
    `Première coupe après ${plural(beforeFirst, "manche")}, puis toutes les ${plural(perCut, "manche")}.`,
  );

  return {
    format: "SURVIVAL",
    seedingSource: input.seedingSource,
    entrants,
    roundLabel: plan.isBarrage ? "Barrage (round 1)" : "Round 1",
    roundsUnit: "round",
    pairings,
    bracketSize: null,
    rounds: null,
    byeCount: plan.byeTeamId === null ? 0 : 1,
    notes,
    phasePlan: null,
  };
}

/** BlueGenji Survie : couples adjacents, la dernière se repose si l'effectif est impair. */
function previewEndurance(input: TournamentPreviewInput): TournamentPreview {
  const entrants = [...input.entrants];
  const lookup = indexEntrants(entrants);

  const standings: EnduranceStanding[] = entrants.map((entrant) => ({
    teamId: entrant.teamId,
    seed: entrant.seed,
    points: 0,
    wins: 0,
    losses: 0,
    status: "ACTIVE",
    eliminatedRound: null,
    rank: entrant.seed,
    previousRank: entrant.seed,
  }));

  const planned = planEnduranceRound(standings);
  const pairings: PreviewPairing[] = planned.map((pairing, index) => ({
    position: index + 1,
    teamA: lookup.get(pairing.teamAId) ?? null,
    teamB: pairing.teamBId === null ? null : lookup.get(pairing.teamBId) ?? null,
    kind: pairing.teamBId === null ? "REST" : "MATCH",
  }));

  const notes: string[] = [];
  const resting = pairings.find((pairing) => pairing.kind === "REST");
  if (resting) {
    notes.push(
      `Effectif impair : ${resting.teamA?.teamName ?? "la dernière du classement"} ne joue pas la première manche (ni gain ni perte d'endurance).`,
    );
  }

  // Même normalisation que `loadEnduranceMeta` : une valeur absurde en base
  // (< 2, nulle) retombe sur le défaut côté moteur, l'aperçu doit suivre.
  const { playoffSize } = resolveEnduranceConfig({
    playoffSize: input.endurancePlayoffSize ?? undefined,
  });
  notes.push(
    `La phase qualificative s'arrête à ${plural(playoffSize, "équipe")}, puis l'arbre imposé prend le relais.`,
  );

  return {
    format: "BG_SURVIE",
    seedingSource: input.seedingSource,
    entrants,
    roundLabel: "Manche 1",
    roundsUnit: "manche",
    pairings,
    bracketSize: null,
    rounds: null,
    byeCount: 0,
    notes,
    phasePlan: null,
  };
}

/**
 * Multi-phases : le plan est résolu pour l'effectif courant, puis la première
 * phase **non sautée** est prévisualisée. Une phase sautée ne joue rien et
 * transmet son effectif tel quel : l'aperçu porte donc bien sur les mêmes
 * engagés.
 */
function previewMulti(input: TournamentPreviewInput): TournamentPreview {
  const phases = input.phases ?? [];
  if (phases.length === 0) {
    return emptyPreview(input, "MULTI", ["Aucune phase configurée pour ce tournoi."]);
  }

  const plan: ResolvedPhase[] = resolvePhasePlan(input.entrants.length, [...phases]);
  const phasePlan = describePhasePlan(plan);
  const firstPlayedIndex = plan.findIndex((phase) => !phase.skipped);

  // Garde-fou : avec au moins deux engagés, la phase finale n'est jamais sautée
  // (une phase sautée transmet son effectif intact). On ne veut pour autant pas
  // indexer `plan[-1]` si cette invariante venait à bouger.
  if (firstPlayedIndex === -1) {
    return emptyPreview(
      input,
      "MULTI",
      ["Toutes les phases seraient sautées avec l'effectif actuel : aucun match à prévoir."],
      phasePlan,
    );
  }

  const first = plan[firstPlayedIndex];
  const inner = buildTournamentPreview({
    ...input,
    format: first.format,
    maxRounds: first.maxRounds,
    swissTotalRounds: first.swissTotalRounds,
    survivalRoundsBeforeFirstCut: first.survivalRoundsBeforeFirstCut,
    survivalRoundsPerCut: first.survivalRoundsPerCut,
    phases: null,
  });

  const notes = [
    `Aperçu de la phase ${first.position}${first.name ? ` — ${first.name}` : ""}.`,
    ...plan
      .slice(0, firstPlayedIndex)
      .map((phase) => `La phase ${phase.position} serait sautée avec l'effectif actuel.`),
    ...inner.notes,
  ];

  return { ...inner, notes, phasePlan };
}

/**
 * Construit l'aperçu du plateau pour l'effectif courant.
 *
 * Aucun effet de bord : rien n'est écrit, aucun match n'est créé. En dessous de
 * deux engagés il n'y a pas d'appariement à montrer — le moteur lui-même ne
 * génère aucun plateau dans ce cas.
 */
export function buildTournamentPreview(input: TournamentPreviewInput): TournamentPreview {
  if (input.entrants.length === 0) {
    return emptyPreview(input, input.format, [
      "Aucune inscription pour l'instant : l'aperçu apparaîtra dès la première.",
    ]);
  }

  if (input.entrants.length === 1) {
    return emptyPreview(input, input.format, [
      "Une seule inscription : il en faut au moins deux pour composer une manche.",
    ]);
  }

  switch (input.format) {
    case "SINGLE":
    case "DOUBLE":
      return previewElimination(input, input.format);
    case "SWISS":
      return previewSwiss(input);
    case "SURVIVAL":
      return previewSurvival(input);
    case "BG_SURVIE":
      return previewEndurance(input);
    case "MULTI":
      return previewMulti(input);
  }
}
