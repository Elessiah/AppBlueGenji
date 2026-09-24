/**
 * Aperçu de la manche suivante d'un tournoi « BlueGenji Survie » — les
 * rencontres **acquises quel que soit le résultat des matchs encore à jouer**.
 *
 * Le moteur ne pose une manche qu'une fois la précédente close : jusque-là,
 * l'arbitrage ne sait pas qui jouera contre qui, alors que la plupart des
 * couples sont souvent déjà écrits — une équipe dont le match est joué ne bouge
 * plus, et celles qui jouent encore ne peuvent déplacer leur capital que d'une
 * amplitude bornée par le format de match. Ce module dit lesquels, pour que le
 * staff prépare la manche (salons, horaires, cast) sans attendre le dernier
 * score.
 *
 * **Une rencontre annoncée est sûre**, jamais probable. La méthode :
 *
 * 1. L'état de départ de la manche courante est **rejoué** (`replayEnduranceDetailed`,
 *    le même rejeu que le moteur) : capital, statut et ordre précédent — celui
 *    qui départage deux capitaux égaux.
 * 2. Chaque match restant est remplacé par la liste de **tous** ses résultats
 *    enregistrables (`checkMatchScores`, la règle de saisie elle-même, plus le
 *    forfait au score plein) ; les équipes dont le match est joué, ou qui
 *    chôment, ont un capital déjà écrit.
 * 3. Pour chaque équipe, on borne sa **place** au classement de fin de manche.
 *    Le calcul est exact et pourtant polynomial : une fois fixé le résultat du
 *    match de l'équipe, les autres matchs sont **indépendants** entre eux, et le
 *    nombre d'équipes classées devant elle se borne match par match.
 * 4. Un couple est acquis quand ses deux équipes, présentes quoi qu'il arrive,
 *    ne peuvent occuper **que** les deux places qui s'affrontent (1-2, 3-4…).
 *
 * Trois limites, toutes du côté de la prudence — une rencontre peut être
 * acquise sans être annoncée, jamais l'inverse :
 *
 * - les **décisions d'arbitrage** ne se prévoient pas : abandon, pénalité et
 *   double forfait restent hors du calcul, et l'interface le dit ;
 * - sous **plafond de manches**, la coupe mathématique de fin de manche est une
 *   règle d'ensemble : une équipe qu'elle *pourrait* écarter est tenue pour
 *   possiblement absente, sans chercher si elle l'est vraiment ;
 * - un couple que les résultats feraient glisser **en bloc** d'une paire de
 *   places à une autre n'est pas reconnu — le cas demande un nombre pair
 *   d'équipes passant toujours ensemble au-dessus d'eux, ce que le barème à
 *   somme nulle rend exceptionnel.
 *
 * En **saisie libre** (aucun format de match), un match restant peut déplacer
 * un capital sans limite : rien n'est acquis avant la fin de la manche, et le
 * module le dit plutôt que d'annoncer un tirage.
 *
 * Pendant les **play-offs**, le tour suivant ne dépend plus d'aucun capital :
 * une rencontre y est acquise dès que ses deux rencontres d'origine sont
 * jouées, et c'est le tirage du moteur (`planNextPlayoffRound`) qui le dit.
 *
 * Module pur : aucune dépendance base de données ni interface.
 */

import {
  enduranceMatchOutcome,
  enduranceRoundSwing,
  PLAYOFF_ROUND_OFFSET,
  planNextPlayoffRound,
  planPlayoffFirstRound,
  replayEnduranceDetailed,
  type EnduranceConfig,
  type EnduranceForfeit,
  type EnduranceMatchRecord,
  type EndurancePenalty,
} from "./bg-survie";
import {
  checkMatchScores,
  forfeitMapCount,
  matchWinsRequired,
  type MatchFormat,
} from "./match-format";

/** Un match du tournoi, tel que l'aperçu le lit. */
export type EnduranceNextRoundMatchRecord = EnduranceMatchRecord & {
  /** `UPPER` pour la qualification et l'arbre, `THIRD_PLACE` pour la petite finale. */
  bracket: string;
  /** Ordre du match dans sa manche — celui des appariements du moteur. */
  matchNumber: number;
};

export type EnduranceNextRoundInput = {
  config: EnduranceConfig;
  /** Format de la **qualification** (`null` = saisie libre). */
  format: MatchFormat | null;
  /** Dernière manche qualificative posée. */
  currentRound: number;
  playoffsStarted: boolean;
  teams: { teamId: number; seed: number }[];
  forfeits: EnduranceForfeit[];
  penalties: EndurancePenalty[];
  matches: EnduranceNextRoundMatchRecord[];
};

/** Une rencontre de la manche suivante, acquise quoi qu'il arrive. */
export type EnduranceNextRoundMatch = {
  /** Équipe de gauche (la mieux classée) quand `sidesKnown`. */
  teamAId: number;
  /** `null` = l'équipe ne joue pas cette manche (effectif impair, exemption). */
  teamBId: number | null;
  /**
   * Les côtés sont-ils acquis eux aussi ? Deux équipes certaines de s'affronter
   * peuvent encore se disputer la meilleure des deux places — celle qui part à
   * gauche, et qui accueille la partie par défaut.
   */
  sidesKnown: boolean;
  bracket: "UPPER" | "THIRD_PLACE";
};

export type EnduranceNextRoundPreview = {
  /** Ce qui suit la manche en cours : une manche qualificative ou un tour d'arbre. */
  stage: "QUALIFICATION" | "PLAYOFFS";
  /** Numéro de la manche à venir (≥ `PLAYOFF_ROUND_OFFSET` pour l'arbre). */
  round: number;
  /**
   * L'étape elle-même est-elle acquise ? Faux quand la phase qualificative peut
   * encore s'achever sur la manche en cours — les rencontres annoncées ne se
   * joueront alors que si elle continue.
   */
  stageCertain: boolean;
  /** Saisie libre : rien ne se prévoit avant la fin de la manche. */
  freeScore: boolean;
  /** Rencontres de la manche courante encore à trancher. */
  pendingMatches: number;
  /**
   * Nombre de rencontres (exemptions exclues) que comptera l'étape suivante,
   * `null` tant que l'effectif n'est pas acquis.
   */
  expectedMatches: number | null;
  /**
   * Play-offs : rencontres **décisives** du tour à venir, exemptions comprises
   * — ce qui le nomme (4 → quarts, 2 → demies, 1 → finale). `null` en
   * qualification, ou tant que l'effectif n'est pas acquis.
   */
  decisiveSlots: number | null;
  matches: EnduranceNextRoundMatch[];
};

/** Place possible d'une équipe au classement de fin de manche. */
export type EnduranceRoundPosition = {
  teamId: number;
  /** Présente quoi qu'il arrive, ou seulement dans certains déroulés. */
  presence: "ALWAYS" | "SOMETIMES";
  /** Meilleure et pire place, 1 = tête, sur les déroulés où elle est présente. */
  best: number;
  worst: number;
};

export type EnduranceRoundAnalysis = {
  positions: Map<number, EnduranceRoundPosition>;
  /** Bornes du nombre d'équipes encore en lice à la fin de la manche. */
  minActive: number;
  maxActive: number;
};

/**
 * Capitaux possibles à l'issue de la manche : `null` = sortie (capital vidé,
 * abandon, coupe). Un « groupe » est un match restant (deux équipes liées) ou
 * une équipe dont la manche est déjà écrite.
 */
type Unit = { teamIds: number[]; outcomes: (number | null)[][] };

/**
 * Variations de capital (side 1, side 2) de **tous** les résultats qu'un match
 * restant peut enregistrer.
 *
 * La liste descend de `checkMatchScores`, la règle même qui valide une saisie :
 * un résultat que le serveur refuserait n'a pas à entrer dans le calcul, et un
 * résultat qu'il accepte ne doit pas en être absent. S'y ajoute le forfait,
 * compté au score plein du format, que l'arbitrage pose sans passer par cette
 * règle. Le double forfait n'y figure pas : c'est une décision d'arbitrage,
 * comme l'abandon.
 */
export function pendingMatchDeltas(
  format: MatchFormat,
  config: EnduranceConfig,
): [number, number][] {
  const wins = matchWinsRequired(format);
  const forfeitMaps = forfeitMapCount(format);
  const deltas = new Map<string, [number, number]>();

  const add = (maps1: number, maps2: number) => {
    const delta1 = config.winDelta * maps1 - config.lossDelta * maps2;
    const delta2 = config.winDelta * maps2 - config.lossDelta * maps1;
    deltas.set(`${delta1}:${delta2}`, [delta1, delta2]);
  };

  for (let score1 = 0; score1 <= wins; score1 += 1) {
    for (let score2 = 0; score2 <= wins; score2 += 1) {
      if (checkMatchScores(format, score1, score2, { decisive: true }) === null) add(score1, score2);
    }
  }
  add(forfeitMaps, 0);
  add(0, forfeitMaps);

  return [...deltas.values()];
}

/** Retire les doublons d'une liste de déroulés (même capital pour chacun). */
function uniqueOutcomes(outcomes: (number | null)[][]): (number | null)[][] {
  const seen = new Map<string, (number | null)[]>();
  for (const outcome of outcomes) seen.set(outcome.map(String).join(":"), outcome);
  return [...seen.values()];
}

/**
 * Nombre d'équipes d'un groupe classées devant un seuil, au mieux et au pire,
 * selon l'intervalle où tombe le seuil entre les clés du groupe.
 */
type Step = { breaks: number[]; low: number[]; high: number[] };

/** Nombre d'éléments de `sorted` strictement inférieurs à `value`. */
function countBelow(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Place possible de chaque équipe à la fin de la manche.
 *
 * Exact sur les groupes fournis : fixer le déroulé du groupe de l'équipe rend
 * les autres groupes indépendants, et le nombre d'équipes devant elle se borne
 * alors groupe par groupe.
 *
 * L'ordre de classement — capital décroissant, puis ordre précédent
 * (`compareEndurance`) — devient une **clé** numérique unique par équipe :
 * `capital × échelle − ordre précédent`. « Devant » s'écrit alors « clé plus
 * grande », et chaque groupe se résume à une fonction en escalier du seuil : au
 * mieux et au pire, combien de ses équipes dépassent-il ? Ces fonctions sont
 * sommées une fois pour tout le plateau, si bien qu'une équipe se situe par une
 * recherche dichotomique, dont on retire la part de son propre groupe. Sans ce
 * détour, cent vingt-huit équipes en BO15 coûtaient près d'une seconde au fil
 * principal, à chaque score reçu.
 */
function analysePositions(units: Unit[], previous: Map<number, number>): EnduranceRoundAnalysis {
  // Deux équipes n'ont jamais le même ordre précédent : la clé est unique, et un
  // seuil (la clé d'une équipe) ne tombe jamais sur la clé d'une autre.
  const scale = Math.max(0, ...previous.values()) + 1;
  const keyOf = (teamId: number, points: number | null): number | null =>
    points === null ? null : points * scale - (previous.get(teamId) ?? 0);

  const keyed = units.map((unit) =>
    unit.outcomes.map((outcome) => outcome.map((points, index) => keyOf(unit.teamIds[index], points))),
  );

  const steps: Step[] = keyed.map((outcomes) => {
    const breaks = [
      ...new Set(outcomes.flat().filter((key): key is number => key !== null)),
    ].sort((x, y) => x - y);
    const low: number[] = [];
    const high: number[] = [];
    // Intervalle i : seuil entre breaks[i − 1] et breaks[i], donc les clés
    // qui le dépassent sont celles ≥ breaks[i].
    for (let i = 0; i <= breaks.length; i += 1) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const outcome of outcomes) {
        const count =
          i === breaks.length ? 0 : outcome.filter((key) => key !== null && key >= breaks[i]).length;
        min = Math.min(min, count);
        max = Math.max(max, count);
      }
      low.push(min);
      high.push(max);
    }
    return { breaks, low, high };
  });

  // Somme des escaliers sur les intervalles de toutes les clés du plateau, par
  // différences : chaque palier d'un groupe couvre une plage d'intervalles.
  const all = [...new Set(steps.flatMap((step) => step.breaks))].sort((x, y) => x - y);
  const lowDiff = new Array<number>(all.length + 2).fill(0);
  const highDiff = new Array<number>(all.length + 2).fill(0);
  for (const step of steps) {
    for (let i = 0; i <= step.breaks.length; i += 1) {
      const start = i === 0 ? 0 : countBelow(all, step.breaks[i - 1]) + 1;
      const end = i === step.breaks.length ? all.length : countBelow(all, step.breaks[i]);
      lowDiff[start] += step.low[i];
      lowDiff[end + 1] -= step.low[i];
      highDiff[start] += step.high[i];
      highDiff[end + 1] -= step.high[i];
    }
  }
  const lowSum: number[] = [];
  const highSum: number[] = [];
  let lowRun = 0;
  let highRun = 0;
  for (let g = 0; g <= all.length; g += 1) {
    lowRun += lowDiff[g];
    highRun += highDiff[g];
    lowSum.push(lowRun);
    highSum.push(highRun);
  }

  const positions = new Map<number, EnduranceRoundPosition>();

  units.forEach((unit, unitIndex) => {
    const own = steps[unitIndex];
    const outcomes = keyed[unitIndex];

    unit.teamIds.forEach((teamId, index) => {
      let best = Number.POSITIVE_INFINITY;
      let worst = Number.NEGATIVE_INFINITY;
      let present = 0;

      for (const outcome of outcomes) {
        const key = outcome[index];
        if (key === null) continue;
        present += 1;

        // Le reste du plateau : la somme de tous les groupes, moins le sien.
        const global = countBelow(all, key);
        const local = countBelow(own.breaks, key);
        const restLow = lowSum[global] - own.low[local];
        const restHigh = highSum[global] - own.high[local];
        // Son propre groupe, dans **ce** déroulé.
        const partners = outcome.filter(
          (other, otherIndex) => otherIndex !== index && other !== null && other > key,
        ).length;

        best = Math.min(best, 1 + partners + restLow);
        worst = Math.max(worst, 1 + partners + restHigh);
      }

      if (present === 0) return;
      positions.set(teamId, {
        teamId,
        presence: present === outcomes.length ? "ALWAYS" : "SOMETIMES",
        best,
        worst,
      });
    });
  });

  let minActive = 0;
  let maxActive = 0;
  for (const unit of units) {
    const counts = unit.outcomes.map((outcome) => outcome.filter((points) => points !== null).length);
    minActive += Math.min(...counts);
    maxActive += Math.max(...counts);
  }

  return { positions, minActive, maxActive };
}

/**
 * Déroulés possibles de la manche qualificative en cours, et ordre précédent.
 *
 * `null` quand il n'y a rien à prévoir : pas de manche posée, ou plus aucun
 * match à jouer — le moteur pose alors lui-même la suivante.
 */
function qualificationUnits(input: EnduranceNextRoundInput): {
  units: Unit[];
  previous: Map<number, number>;
  pendingMatches: number;
} | null {
  const { config, format, currentRound: round, teams } = input;
  if (round < 1 || !format) return null;

  const records = input.matches.filter((match) => match.round < PLAYOFF_ROUND_OFFSET);
  const outcomes = records.map(enduranceMatchOutcome);
  const pending = records.filter(
    (match) => match.round === round && match.status !== "COMPLETED",
  );
  if (pending.length === 0) return null;

  // Départ de la manche : capital, statut, et ordre qui départagera les égalités.
  const before = replayEnduranceDetailed({
    teams,
    matches: outcomes.filter((outcome) => outcome.round < round),
    forfeits: input.forfeits.filter((forfeit) => forfeit.round < round),
    penalties: input.penalties.filter((penalty) => penalty.round < round),
    config,
    lastRound: round - 1,
    matchFormat: format,
  }).standings;

  // Les matchs déjà joués de la manche, et eux seuls : la manche n'étant pas
  // close, le rejeu n'y applique aucune coupe. Pénalités et abandons de la
  // manche sont écartés ici — ils s'appliquent **après** les matchs, sur le
  // capital final, et l'ordre compte : une pénalité qui viderait le capital
  // avant une victoire ne le vide plus après.
  const afterPlayed = replayEnduranceDetailed({
    teams,
    matches: outcomes.filter((outcome) => outcome.round <= round),
    forfeits: input.forfeits.filter((forfeit) => forfeit.round < round),
    penalties: input.penalties.filter((penalty) => penalty.round < round),
    config,
    lastRound: round,
    matchFormat: format,
  }).standings;

  const active = before.filter((standing) => standing.status === "ACTIVE");
  const activeIds = new Set(active.map((standing) => standing.teamId));
  const previous = new Map(active.map((standing) => [standing.teamId, standing.previousRank]));
  const afterById = new Map(afterPlayed.map((standing) => [standing.teamId, standing]));

  const penaltyNow = new Map<number, number>();
  for (const penalty of input.penalties) {
    if (penalty.round !== round) continue;
    penaltyNow.set(penalty.teamId, (penaltyNow.get(penalty.teamId) ?? 0) + penalty.points);
  }
  const forfeitNow = new Set(
    input.forfeits.filter((forfeit) => forfeit.round === round).map((forfeit) => forfeit.teamId),
  );

  // Capital de fin de manche, à partir du capital après match : pénalité de la
  // manche, puis abandon. Une sanction ne frappe qu'une équipe encore en lice,
  // et une sortie reste une sortie.
  const settle = (teamId: number, afterMatch: number | null): number | null => {
    if (afterMatch === null || afterMatch <= 0 || forfeitNow.has(teamId)) return null;
    const points = afterMatch - (penaltyNow.get(teamId) ?? 0);
    return points > 0 ? points : null;
  };

  const deltas = pendingMatchDeltas(format, config);
  const units: Unit[] = [];
  const grouped = new Set<number>();

  for (const match of pending) {
    // Un match dont une équipe n'était plus en lice ne compte pour personne
    // (règle du rejeu) : ses équipes restent seules, capital inchangé.
    if (
      match.team1Id === null ||
      match.team2Id === null ||
      !activeIds.has(match.team1Id) ||
      !activeIds.has(match.team2Id)
    ) {
      continue;
    }
    const team1 = match.team1Id;
    const team2 = match.team2Id;
    const base1 = afterById.get(team1)?.points ?? 0;
    const base2 = afterById.get(team2)?.points ?? 0;
    units.push({
      teamIds: [team1, team2],
      outcomes: uniqueOutcomes(
        deltas.map(([delta1, delta2]) => [
          settle(team1, base1 + delta1),
          settle(team2, base2 + delta2),
        ]),
      ),
    });
    grouped.add(team1);
    grouped.add(team2);
  }

  for (const standing of active) {
    if (grouped.has(standing.teamId)) continue;
    const after = afterById.get(standing.teamId);
    const afterMatch = after && after.status === "ACTIVE" ? after.points : null;
    units.push({ teamIds: [standing.teamId], outcomes: [[settle(standing.teamId, afterMatch)]] });
  }

  return {
    units: withEliminationCut(units, input, round),
    previous,
    pendingMatches: pending.length,
  };
}

/**
 * Sous plafond de manches, la fin de la manche peut **écarter** des équipes
 * (`enduranceEliminationCut`). La règle regarde tout le plateau à la fois —
 * elle ne se découpe pas match par match —, si bien qu'elle est ici approchée
 * par le haut : toute équipe qu'un déroulé *pourrait* écarter reçoit un déroulé
 * de plus, où elle est absente. Le calcul y perd des rencontres qu'il aurait pu
 * annoncer, jamais il n'en annonce une de trop.
 *
 * La dernière manche n'est pas concernée : la coupe y est un simple trait sous
 * la cible, que l'ordre des équipes suffit à décrire.
 */
function withEliminationCut(
  units: Unit[],
  input: EnduranceNextRoundInput,
  round: number,
): Unit[] {
  const { config, format } = input;
  if (config.maxRounds === null) return units;
  const remaining = config.maxRounds - round;
  if (remaining <= 0) return units;

  const swing = enduranceRoundSwing(config, format);
  if (!swing) return units;
  const gain = swing.gain * remaining;
  const loss = swing.loss * remaining;

  const range = new Map<number, { low: number; high: number }>();
  for (const unit of units) {
    unit.teamIds.forEach((teamId, index) => {
      for (const outcome of unit.outcomes) {
        const points = outcome[index];
        if (points === null) continue;
        const current = range.get(teamId);
        range.set(teamId, {
          low: Math.min(current?.low ?? points, points),
          high: Math.max(current?.high ?? points, points),
        });
      }
    });
  }

  const mayBeCut = new Set<number>();
  for (const [teamId, own] of range) {
    let ahead = 0;
    for (const [otherId, other] of range) {
      if (otherId !== teamId && other.high - loss > own.low + gain) ahead += 1;
    }
    if (ahead >= config.playoffSize) mayBeCut.add(teamId);
  }
  if (mayBeCut.size === 0) return units;

  return units.map((unit) => {
    let outcomes = unit.outcomes;
    unit.teamIds.forEach((teamId, index) => {
      if (!mayBeCut.has(teamId)) return;
      outcomes = outcomes.flatMap((outcome) =>
        outcome[index] === null
          ? [outcome]
          : [outcome, outcome.map((points, i) => (i === index ? null : points))],
      );
    });
    return { teamIds: unit.teamIds, outcomes: uniqueOutcomes(outcomes) };
  });
}

/**
 * Place possible de chaque équipe en lice à la fin de la manche qualificative
 * en cours. `null` hors d'une manche qualificative ouverte, ou en saisie libre.
 *
 * Exposée pour les tests : c'est elle qui porte la preuve, l'aperçu n'en tire
 * que les couples.
 */
export function analyseEnduranceRound(input: EnduranceNextRoundInput): EnduranceRoundAnalysis | null {
  if (input.playoffsStarted) return null;
  const prepared = qualificationUnits(input);
  if (!prepared) return null;
  return analysePositions(prepared.units, prepared.previous);
}

/** Équipe présente quoi qu'il arrive, à une place et une seule. */
function fixedAtPositions(analysis: EnduranceRoundAnalysis): Map<number, number> {
  const fixed = new Map<number, number>();
  for (const position of analysis.positions.values()) {
    if (position.presence === "ALWAYS" && position.best === position.worst) {
      fixed.set(position.best, position.teamId);
    }
  }
  return fixed;
}

/**
 * Couples de la manche qualificative suivante : places 1-2, 3-4… du classement
 * (`planEnduranceRound`). Un couple est acquis quand deux équipes présentes
 * quoi qu'il arrive ne peuvent occuper que ses deux places.
 */
function qualificationMatches(
  analysis: EnduranceRoundAnalysis,
  previous: Map<number, number>,
): EnduranceNextRoundMatch[] {
  const slots = new Map<number, EnduranceRoundPosition[]>();
  for (const position of analysis.positions.values()) {
    if (position.presence !== "ALWAYS") continue;
    const slot = Math.ceil(position.best / 2);
    if (Math.ceil(position.worst / 2) !== slot) continue;
    slots.set(slot, [...(slots.get(slot) ?? []), position]);
  }

  const matches: { slot: number; match: EnduranceNextRoundMatch }[] = [];
  for (const [slot, members] of slots) {
    // Deux équipes enfermées dans les deux mêmes places les occupent forcément
    // toutes les deux. Une troisième ne peut pas s'y trouver ; le garde-fou
    // ne coûte rien.
    if (members.length !== 2) continue;
    const [a, b] = [...members].sort(
      (x, y) =>
        x.best - y.best ||
        x.worst - y.worst ||
        (previous.get(x.teamId) ?? 0) - (previous.get(y.teamId) ?? 0),
    );
    matches.push({
      slot,
      match: {
        teamAId: a.teamId,
        teamBId: b.teamId,
        sidesKnown: a.best === a.worst && b.best === b.worst,
        bracket: "UPPER",
      },
    });
  }

  // Effectif impair et acquis : la dernière ne joue pas. Elle n'est annoncée
  // que si elle est connue — sinon, c'est une place et non une équipe.
  if (analysis.minActive === analysis.maxActive && analysis.minActive % 2 === 1) {
    const last = fixedAtPositions(analysis).get(analysis.minActive);
    if (last !== undefined) {
      matches.push({
        slot: Math.ceil(analysis.minActive / 2),
        match: { teamAId: last, teamBId: null, sidesKnown: true, bracket: "UPPER" },
      });
    }
  }

  return matches.sort((x, y) => x.slot - y.slot).map((entry) => entry.match);
}

/**
 * Premier tour de l'arbre final, quand la qualification s'achève sur la manche
 * en cours. Le tableau dépend de l'effectif qualifié : tant qu'il n'est pas
 * acquis, rien ne l'est. Le tirage est celui du moteur, `planPlayoffFirstRound`,
 * appliqué aux **places** plutôt qu'aux équipes.
 */
function firstPlayoffMatches(
  analysis: EnduranceRoundAnalysis,
  config: EnduranceConfig,
): {
  matches: EnduranceNextRoundMatch[];
  expectedMatches: number | null;
  decisiveSlots: number | null;
} {
  const qualified =
    analysis.minActive >= config.playoffSize
      ? config.playoffSize
      : analysis.minActive === analysis.maxActive
        ? analysis.minActive
        : null;

  if (qualified === null) return { matches: [], expectedMatches: null, decisiveSlots: null };
  // Une qualifiée ou moins : le tournoi se clôt sans arbre.
  if (qualified <= 1) return { matches: [], expectedMatches: 0, decisiveSlots: 0 };

  const places = Array.from({ length: qualified }, (_, index) => index + 1);
  const plan = planPlayoffFirstRound(places, config);
  const fixed = fixedAtPositions(analysis);

  const matches: EnduranceNextRoundMatch[] = [];
  for (const { pairing } of plan) {
    const teamA = fixed.get(pairing.teamAId);
    const teamB = pairing.teamBId === null ? null : fixed.get(pairing.teamBId);
    if (teamA === undefined || teamB === undefined) continue;
    matches.push({ teamAId: teamA, teamBId: teamB, sidesKnown: true, bracket: "UPPER" });
  }

  return {
    matches,
    expectedMatches: plan.filter((entry) => entry.pairing.teamBId !== null).length,
    decisiveSlots: plan.length,
  };
}

/**
 * Tour suivant d'un arbre final en cours : le tirage du moteur, joué sur les
 * rencontres tranchées, un vainqueur **fictif** tenant la place de chaque
 * rencontre encore ouverte. Toute rencontre planifiée sans équipe fictive est
 * acquise — elle ne dépend d'aucun match restant.
 */
function nextPlayoffPreview(input: EnduranceNextRoundInput): EnduranceNextRoundPreview | null {
  const playoff = input.matches.filter((match) => match.round >= PLAYOFF_ROUND_OFFSET);
  if (playoff.length === 0) return null;

  const round = Math.max(...playoff.map((match) => match.round));
  const decisive = playoff
    .filter((match) => match.round === round && match.bracket !== "THIRD_PLACE")
    .sort((a, b) => a.matchNumber - b.matchNumber);
  // Une finale ne mène nulle part ; un tour tout joué est déjà suivi du suivant.
  if (decisive.length < 2) return null;
  const pendingMatches = decisive.filter((match) => match.status !== "COMPLETED").length;
  if (pendingMatches === 0) return null;

  const plan = planNextPlayoffRound(
    decisive.map((match, index) =>
      match.status === "COMPLETED"
        ? {
            winnerTeamId: match.winnerTeamId,
            loserTeamId: match.loserTeamId,
            doubleForfeit: match.doubleForfeit,
          }
        : { winnerTeamId: -(2 * index + 1), loserTeamId: -(2 * index + 2) },
    ),
  );

  const isReal = (teamId: number | null) => teamId === null || teamId > 0;
  return {
    stage: "PLAYOFFS",
    round: round + 1,
    stageCertain: true,
    freeScore: false,
    pendingMatches,
    expectedMatches: plan.filter((entry) => entry.pairing.teamBId !== null).length,
    decisiveSlots: plan.filter((entry) => entry.bracket === "UPPER").length,
    matches: plan
      .filter((entry) => isReal(entry.pairing.teamAId) && isReal(entry.pairing.teamBId))
      .map((entry) => ({
        teamAId: entry.pairing.teamAId,
        teamBId: entry.pairing.teamBId,
        sidesKnown: true,
        bracket: entry.bracket,
      })),
  };
}

/**
 * Aperçu de l'étape qui suit la manche en cours. `null` quand il n'y a rien à
 * prévoir : tournoi pas commencé, manche close (le moteur a déjà posé la
 * suivante), ou finale en cours.
 */
export function previewEnduranceNextRound(
  input: EnduranceNextRoundInput,
): EnduranceNextRoundPreview | null {
  if (input.playoffsStarted) return nextPlayoffPreview(input);

  const { config, currentRound: round } = input;

  if (!input.format) {
    const pendingMatches = input.matches.filter(
      (match) => match.round === round && match.status !== "COMPLETED",
    ).length;
    if (round < 1 || pendingMatches === 0) return null;
    return {
      stage: "QUALIFICATION",
      round: round + 1,
      stageCertain: false,
      freeScore: true,
      pendingMatches,
      expectedMatches: null,
      decisiveSlots: null,
      matches: [],
    };
  }

  const prepared = qualificationUnits(input);
  if (!prepared) return null;
  const analysis = analysePositions(prepared.units, prepared.previous);

  // La qualification s'achève sur cette manche — plafond atteint, ou effectif
  // retombé à la cible quoi qu'il arrive : c'est l'arbre qui suit.
  const lastRound = config.maxRounds !== null && round >= config.maxRounds;
  if (lastRound || analysis.maxActive <= config.playoffSize) {
    return {
      stage: "PLAYOFFS",
      round: PLAYOFF_ROUND_OFFSET,
      stageCertain: true,
      freeScore: false,
      pendingMatches: prepared.pendingMatches,
      ...firstPlayoffMatches(analysis, config),
    };
  }

  const known = analysis.minActive === analysis.maxActive;
  return {
    stage: "QUALIFICATION",
    round: round + 1,
    stageCertain: analysis.minActive > config.playoffSize,
    freeScore: false,
    pendingMatches: prepared.pendingMatches,
    expectedMatches: known ? Math.floor(analysis.minActive / 2) : null,
    decisiveSlots: null,
    matches: qualificationMatches(analysis, prepared.previous),
  };
}
