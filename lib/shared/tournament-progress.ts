import type {
  BracketMatch,
  EnduranceStandingRow,
  MatchStatus,
  SurvivalStandingRow,
  SwissMeta,
  TournamentCard,
  TournamentPhase,
  TournamentState,
} from "@/lib/shared/types";

/**
 * Cycle de vie d'un tournoi, du moment où il n'existe pour personne jusqu'à sa
 * clôture.
 *
 * Il compte **six** étapes là où `TournamentState` n'en connaît que quatre :
 * l'état stocké en base ignore la visibilité (un tournoi masqué est déjà
 * `UPCOMING`) et confond les deux versants de `UPCOMING` — avant l'ouverture
 * des inscriptions, et après leur clôture en attendant le coup d'envoi
 * (`computeTournamentState` renvoie bien `UPCOMING` dans les deux cas).
 * Ces deux moments n'ont pourtant rien à voir pour une équipe qui regarde la
 * page : dans l'un elle peut encore se préparer à s'inscrire, dans l'autre la
 * porte est fermée.
 */
export type TournamentStageKey =
  | "HIDDEN"
  | "ANNOUNCED"
  | "REGISTRATION"
  | "LOCKED"
  | "RUNNING"
  | "FINISHED";

/** Étapes dans l'ordre chronologique — l'index vaut position sur la barre. */
export const TOURNAMENT_STAGE_ORDER: TournamentStageKey[] = [
  "HIDDEN",
  "ANNOUNCED",
  "REGISTRATION",
  "LOCKED",
  "RUNNING",
  "FINISHED",
];

export const TOURNAMENT_STAGE_META: Record<
  TournamentStageKey,
  { label: string; hint: string }
> = {
  HIDDEN: { label: "Masqué", hint: "Visible du seul organisateur" },
  ANNOUNCED: { label: "Annoncé", hint: "En attente d'ouverture des inscriptions" },
  REGISTRATION: { label: "Inscriptions", hint: "Les engagements sont ouverts" },
  LOCKED: { label: "Clôture", hint: "Inscriptions fermées, en attente du coup d'envoi" },
  RUNNING: { label: "En cours", hint: "Les matchs se jouent" },
  FINISHED: { label: "Terminé", hint: "Le classement final est figé" },
};

export type TournamentStageStatus = "DONE" | "CURRENT" | "TODO";

export type TournamentStage = {
  key: TournamentStageKey;
  label: string;
  hint: string;
  status: TournamentStageStatus;
  /**
   * Date d'entrée dans l'étape, en ISO. `null` quand elle n'est pas datable :
   * un tournoi est masqué depuis sa création (non exposée), et la fin dépend du
   * dernier match joué, pas d'un horaire annoncé.
   */
  at: string | null;
};

export type TournamentProgress = {
  stages: TournamentStage[];
  current: TournamentStageKey;
  currentIndex: number;
  /** Avancement global sur la barre, de 0 à 1. */
  ratio: number;
  /** Jalon suivant, `null` une fois le tournoi terminé. */
  next: { key: TournamentStageKey; label: string; at: string | null } | null;
};

type ProgressCard = Pick<
  TournamentCard,
  "state" | "startVisibilityAt" | "registrationOpenAt" | "registrationCloseAt" | "startAt"
>;

export type TournamentProgressOptions = {
  now?: number;
  /**
   * Avancement interne d'un tournoi en cours, de 0 à 1 (proportion de matchs
   * joués). Le déroulement n'a pas de date de fin annoncée : sans cette valeur
   * la barre stagne au seuil « En cours » jusqu'à la clôture.
   */
  playedRatio?: number;
};

/** Milliseconde d'un jalon, ou `null` si la date est illisible. */
function parseMilestone(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * Suite croissante des quatre jalons datés (visibilité, ouverture, clôture,
 * départ).
 *
 * Deux nettoyages, parce que rien ne garantit ces dates : une date illisible
 * emprunte celle du jalon voisin (l'étape se réduit alors à un point plutôt que
 * de faire disparaître la barre), et l'ordre est forcé croissant — une reprise
 * à la main peut très bien placer la clôture des inscriptions après le coup
 * d'envoi, ce qui ferait reculer la jauge.
 */
function orderedMilestones(card: ProgressCard, now: number): number[] {
  const raw = [
    parseMilestone(card.startVisibilityAt),
    parseMilestone(card.registrationOpenAt),
    parseMilestone(card.registrationCloseAt),
    parseMilestone(card.startAt),
  ];

  const firstKnown = raw.find((value) => value !== null) ?? now;

  const filled: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const value = raw[i];
    filled.push(value ?? (i === 0 ? firstKnown : filled[i - 1]));
  }

  for (let i = 1; i < filled.length; i += 1) {
    if (filled[i] < filled[i - 1]) filled[i] = filled[i - 1];
  }

  return filled;
}

/** Étape déduite des seules dates, sans tenir compte de l'état stocké. */
function stageFromDates(milestones: number[], now: number): TournamentStageKey {
  const [visibleAt, openAt, closeAt] = milestones;
  if (now < visibleAt) return "HIDDEN";
  if (now < openAt) return "ANNOUNCED";
  if (now <= closeAt) return "REGISTRATION";
  return "LOCKED";
}

/**
 * Plancher imposé par l'état stocké.
 *
 * `UPCOMING` n'en pose aucun : c'est justement l'état ambigu que les dates
 * départagent (masqué, annoncé ou clôturé). Les trois autres, eux, font
 * autorité — un tournoi peut être clos à la main avant l'heure, ou toujours en
 * cours bien après, et la barre doit suivre le tournoi, pas le calendrier.
 */
function stageFloorFromState(state: TournamentState): TournamentStageKey | null {
  if (state === "FINISHED") return "FINISHED";
  if (state === "RUNNING") return "RUNNING";
  if (state === "REGISTRATION") return "REGISTRATION";
  return null;
}

/** Part parcourue d'un segment borné par deux jalons, ramenée dans [0, 1]. */
function segmentRatio(from: number, to: number, now: number): number {
  if (!(to > from)) return 0;
  return clamp01((now - from) / (to - from));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Position d'un tournoi sur son cycle de vie, prête à peindre une barre de
 * progression : les six étapes qualifiées (faites, en cours, à venir), le
 * remplissage global et le prochain jalon.
 */
export function computeTournamentProgress(
  card: ProgressCard,
  options: TournamentProgressOptions = {},
): TournamentProgress {
  const now = options.now ?? Date.now();
  const milestones = orderedMilestones(card, now);
  const [visibleAt, openAt, closeAt, startAt] = milestones;

  const byDates = stageFromDates(milestones, now);
  const floor = stageFloorFromState(card.state);

  const currentIndex = Math.max(
    TOURNAMENT_STAGE_ORDER.indexOf(byDates),
    floor ? TOURNAMENT_STAGE_ORDER.indexOf(floor) : 0,
  );
  const current = TOURNAMENT_STAGE_ORDER[currentIndex];

  // Date d'entrée dans chaque étape : le jalon qui l'ouvre. `HIDDEN` et
  // `FINISHED` n'en ont pas (cf. `TournamentStage.at`).
  const enteredAt: Record<TournamentStageKey, string | null> = {
    HIDDEN: null,
    ANNOUNCED: card.startVisibilityAt ?? null,
    REGISTRATION: card.registrationOpenAt ?? null,
    LOCKED: card.registrationCloseAt ?? null,
    RUNNING: card.startAt ?? null,
    FINISHED: null,
  };

  const stages: TournamentStage[] = TOURNAMENT_STAGE_ORDER.map((key, index) => ({
    key,
    label: TOURNAMENT_STAGE_META[key].label,
    hint: TOURNAMENT_STAGE_META[key].hint,
    status: index < currentIndex ? "DONE" : index === currentIndex ? "CURRENT" : "TODO",
    at: enteredAt[key],
  }));

  // Avancement dans l'étape courante. `HIDDEN` n'a pas de début connu et
  // `RUNNING` pas de fin annoncée : le premier reste à zéro, le second se règle
  // sur la proportion de matchs joués quand elle est fournie.
  let inner = 0;
  if (current === "ANNOUNCED") inner = segmentRatio(visibleAt, openAt, now);
  else if (current === "REGISTRATION") inner = segmentRatio(openAt, closeAt, now);
  else if (current === "LOCKED") inner = segmentRatio(closeAt, startAt, now);
  else if (current === "RUNNING") inner = clamp01(options.playedRatio ?? 0);

  const segments = TOURNAMENT_STAGE_ORDER.length - 1;
  const ratio =
    current === "FINISHED" ? 1 : clamp01((currentIndex + inner) / segments);

  const nextKey = TOURNAMENT_STAGE_ORDER[currentIndex + 1] ?? null;

  return {
    stages,
    current,
    currentIndex,
    ratio,
    next: nextKey
      ? { key: nextKey, label: TOURNAMENT_STAGE_META[nextKey].label, at: enteredAt[nextKey] }
      : null,
  };
}

/**
 * Ce qu'il faut connaître d'un tournoi en cours pour situer son déroulement.
 *
 * Volontairement structurel plutôt que nominatif (`TournamentDetail`) : la
 * fonction reste pure et testable sans fabriquer une fiche complète.
 */
export type RunningProgressInput = {
  format: TournamentCard["format"];
  matches: Pick<BracketMatch, "status" | "roundNumber" | "phaseId">[];
  swiss?: Pick<SwissMeta, "totalRounds" | "currentRound"> | null;
  survivalStandings?: Pick<SurvivalStandingRow, "status">[] | null;
  enduranceStandings?: Pick<EnduranceStandingRow, "status">[] | null;
  phases?: Pick<TournamentPhase, "id" | "state">[] | null;
  currentPhaseId?: number | null;
};

function completedRatio(matches: { status: MatchStatus }[]): number | null {
  if (!matches.length) return null;
  const done = matches.filter((match) => match.status === "COMPLETED").length;
  return clamp01(done / matches.length);
}

/** Part d'engagés déjà sortis, sur les éliminations possibles (effectif − 1). */
function eliminationRatio(standings: { status: string }[]): number | null {
  if (standings.length < 2) return null;
  const out = standings.filter((row) => row.status !== "ACTIVE").length;
  return clamp01(out / (standings.length - 1));
}

/**
 * Avancement interne d'un tournoi en cours, de 0 à 1 — `null` quand rien ne
 * permet encore de le situer.
 *
 * Chaque famille de formats a sa propre mesure, faute d'une commune honnête :
 * l'élimination connaît tout son plateau dès le départ, donc ses matchs joués
 * suffisent ; la ronde suisse ne génère qu'une ronde à la fois mais annonce
 * leur nombre, donc on compte les rondes ; la survie ignore jusqu'au nombre de
 * manches (il dépend des coupes) mais sait qui reste en lice, donc on compte
 * les éliminations ; le multi-phases se règle sur ses phases. Compter les
 * matchs partout afficherait un tournoi de survie à 100 % dès sa première
 * manche, sa seule ronde générée étant intégralement jouée.
 */
export function computeRunningRatio(input: RunningProgressInput): number | null {
  if (input.format === "MULTI") {
    const phases = input.phases ?? [];
    if (!phases.length) return null;

    // Une phase sautée est un jalon franchi comme un autre : l'effectif était
    // déjà sous la cible, il n'y avait rien à jouer.
    const settled = phases.filter(
      (phase) => phase.state === "FINISHED" || phase.state === "SKIPPED",
    ).length;

    const currentId = input.currentPhaseId ?? null;
    const inner =
      currentId === null
        ? 0
        : completedRatio(input.matches.filter((match) => match.phaseId === currentId)) ?? 0;

    return clamp01((settled + inner) / phases.length);
  }

  if (input.format === "SWISS" && input.swiss && input.swiss.totalRounds > 0) {
    const { totalRounds, currentRound } = input.swiss;
    const inner =
      completedRatio(input.matches.filter((match) => match.roundNumber === currentRound)) ?? 0;
    return clamp01((Math.max(0, currentRound - 1) + inner) / totalRounds);
  }

  if (input.format === "SURVIVAL") {
    return eliminationRatio(input.survivalStandings ?? []);
  }

  if (input.format === "BG_SURVIE") {
    return eliminationRatio(input.enduranceStandings ?? []);
  }

  return completedRatio(input.matches);
}

/**
 * Délai restant en clair (« dans 3 j 4 h »), pour annoncer le prochain jalon
 * sans obliger à comparer deux dates de tête.
 *
 * Deux unités au plus : « dans 3 j 4 h » se lit, « dans 3 j 4 h 12 min 8 s »
 * non. Un jalon déjà passé (le serveur n'a pas encore fait basculer l'état)
 * renvoie `null` plutôt qu'un délai négatif : mieux vaut taire l'échéance que
 * l'afficher à l'envers.
 */
export function formatStageCountdown(from: number, to: number): string | null {
  const delay = to - from;
  if (!Number.isFinite(delay) || delay <= 0) return null;

  const minutes = Math.floor(delay / 60_000);
  if (minutes < 1) return "dans moins d'une minute";

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;

  if (days > 0) return hours > 0 ? `dans ${days} j ${hours} h` : `dans ${days} j`;
  if (hours > 0) return mins > 0 ? `dans ${hours} h ${mins} min` : `dans ${hours} h`;
  return `dans ${mins} min`;
}
