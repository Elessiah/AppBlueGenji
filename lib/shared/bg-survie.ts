/**
 * Logique pure du mode « BlueGenji Survie » (endurance).
 *
 * Deux temps :
 *
 * 1. **Phase qualificative (endurance).** Chaque équipe démarre avec un capital
 *    de points d'endurance (9 par défaut). Le barème se compte **map par map** :
 *    chaque map gagnée en rapporte, chaque map perdue en retire — un 3-0 coûte
 *    donc trois points au perdant et en rapporte trois au vainqueur, là où un
 *    3-2 n'en déplace qu'un. À 0, l'équipe est éliminée sur-le-champ. Le
 *    classement se relit avant chaque manche : d'abord par endurance
 *    décroissante, puis — à égalité — dans l'**ordre du classement précédent**.
 *    Les équipes s'apparient par couples adjacents (1 vs 2, 3 vs 4, …) ; sur un
 *    effectif impair, la dernière du classement ne joue pas et son capital est
 *    inchangé. La mieux classée du couple part à gauche.
 *    La phase s'arrête dès qu'il ne reste plus que `playoffSize` équipes
 *    (8 par défaut) ou moins — ou, si le tournoi fixe un nombre maximal de
 *    manches (`maxRounds`), dès que ce nombre est atteint : les `playoffSize`
 *    premières du classement sont alors qualifiées, les autres sortent.
 *    Sous plafond, une équipe qui ne peut plus **mathématiquement** rejoindre
 *    ce plateau dans les manches restantes est écartée sans attendre la fin
 *    (`enduranceEliminationCut`).
 *
 * 2. **Phase éliminatoire.** Les qualifiées jouent un arbre à élimination
 *    directe dont les affrontements suivent un tableau fixe (8v4, 6v2, 1v5,
 *    3v7), et non le seeding classique 1v8 / 2v7. Une petite finale départage
 *    la 3ᵉ place en parallèle de la finale.
 *
 * Comme la Survie et la Ronde suisse, **tout est rejoué** depuis l'historique
 * des matchs : l'endurance, les éliminations et le classement sont dérivés, ce
 * qui rend une correction de score idempotente. Seuls le classement initial
 * (ordre fixé par l'arbitre) et les abandons sont fournis en entrée.
 *
 * Module pur : aucune dépendance base de données, entièrement testable.
 */

import { forfeitMapCount, matchWinsRequired, type MatchFormat } from "./match-format";

// Le chiffre d'un forfait appartient au format de match, pas au mode : il est
// défini une seule fois dans `match-format.ts` et réexporté ici, où l'appelaient
// déjà l'orchestration et la vue.
export { forfeitMapCount };

/**
 * Sortie d'une équipe de la phase qualificative.
 *
 * `ELIMINATED` et `OUT_OF_CONTENTION` ne se confondent pas, et c'est tout
 * l'intérêt de les nommer séparément : la première a **vidé son capital**
 * (0 point, elle est tombée), la seconde en a encore mais **ne peut plus
 * atteindre le plateau des play-offs** dans les manches qui restent. Afficher
 * « Éliminée » à côté d'un capital de 6 points ne se lit pas.
 */
export type EnduranceStatus = "ACTIVE" | "ELIMINATED" | "OUT_OF_CONTENTION" | "FORFEIT";

/** Barème d'endurance d'un tournoi. */
export type EnduranceConfig = {
  /** Capital de départ (défaut 9). */
  startPoints: number;
  /** Points gagnés par **map** gagnée (défaut 1). */
  winDelta: number;
  /** Points perdus par **map** perdue (défaut 1). */
  lossDelta: number;
  /** Effectif de la phase éliminatoire (défaut 8). */
  playoffSize: number;
  /**
   * Nombre maximal de manches qualificatives. `null` = aucune limite : la
   * phase court jusqu'à ce que l'effectif retombe à `playoffSize`, seul
   * comportement qu'aient connu les tournois d'avant ce réglage.
   *
   * Fixé, il change la nature de la phase : elle s'arrête à la manche dite, et
   * les `playoffSize` premières du classement sont qualifiées — même si elles
   * sont encore trente.
   */
  maxRounds: number | null;
};

export const DEFAULT_ENDURANCE_CONFIG: EnduranceConfig = {
  startPoints: 9,
  winDelta: 1,
  lossDelta: 1,
  playoffSize: 8,
  maxRounds: null,
};

export type EnduranceStanding = {
  teamId: number;
  /** Rang initial, fixé par l'ordre de seeding (1 = tête de classement). */
  seed: number;
  points: number;
  wins: number;
  losses: number;
  status: EnduranceStatus;
  /** Manche à laquelle l'équipe est tombée à 0 (ou a abandonné). */
  eliminatedRound: number | null;
  /** Rang courant, 1 = meilleure. Les éliminées suivent les actives. */
  rank: number;
  /**
   * Position au classement **précédent**, seul départage prévu par le règlement
   * en cas d'égalité de points. Initialisée au seed (l'ordre fixé par
   * l'arbitre), puis réécrite après chaque manche.
   */
  previousRank: number;
};

export type EndurancePairing = {
  /** Équipe la mieux classée du couple → side GAUCHE. */
  teamAId: number;
  /** Side DROITE. `null` = effectif impair, la dernière ne joue pas. */
  teamBId: number | null;
};

/** Résultat d'un match tel que rejoué. */
export type EnduranceMatchOutcome = {
  round: number;
  completed: boolean;
  winnerTeamId: number | null;
  loserTeamId: number | null;
  /** Maps gagnées par le vainqueur (`null` = non saisi). */
  winnerMaps?: number | null;
  /** Maps gagnées par le perdant (`null` = non saisi). */
  loserMaps?: number | null;
  /**
   * Match clos par forfait. Il compte comme une rencontre **pleine** : le
   * règlement traite le forfait comme le score maximal du format du tournoi
   * (FT3 → 3-0), donc trois points d'endurance au perdant et trois au
   * vainqueur. Les scores en base sont `NULL` sur un forfait déclaré par
   * l'arbitrage : le barème se dérive alors du format, jamais des colonnes.
   */
  isForfeit?: boolean;
};

/**
 * Maps à porter au compte de chaque équipe pour un match rejoué.
 *
 * Trois sources, dans l'ordre : le **format** pour un forfait (aucune map n'a
 * été jouée, mais le règlement en compte l'équivalent d'un score plein), les
 * **scores saisis** pour une rencontre disputée, et un 1-0 de repli pour un
 * match tranché sans score — un tournoi en saisie libre, ou un historique
 * antérieur au format de match. Le repli ne peut pas être 0-0 : le match a un
 * vainqueur, il doit coûter quelque chose au perdant.
 */
export function enduranceMatchMaps(
  outcome: EnduranceMatchOutcome,
  format: MatchFormat | null | undefined,
): { winnerMaps: number; loserMaps: number } {
  if (outcome.isForfeit) return { winnerMaps: forfeitMapCount(format), loserMaps: 0 };

  const winnerMaps = Number(outcome.winnerMaps);
  const loserMaps = Number(outcome.loserMaps);

  if (!Number.isFinite(winnerMaps) || !Number.isFinite(loserMaps)) {
    return { winnerMaps: 1, loserMaps: 0 };
  }
  if (winnerMaps <= 0 || loserMaps < 0) return { winnerMaps: 1, loserMaps: 0 };

  return { winnerMaps: Math.floor(winnerMaps), loserMaps: Math.floor(loserMaps) };
}

/**
 * Une case du tableau d'endurance, manche par manche — la lecture « feuille de
 * calcul » du classement.
 *
 * Trois natures, et pas une seule valeur numérique tolérant les trous : un
 * capital de 0 ne dit pas si l'équipe a été vidée par ses résultats ou déclarée
 * forfait, et une case vide ne dit pas si la manche reste à jouer ou si
 * l'équipe n'y était plus.
 *
 * - `POINTS` — capital à l'issue de la manche (0 compris : la manche qui vide
 *   le capital affiche bien ce zéro).
 * - `FORFEIT` — manche couverte par un **forfait de tournoi** : l'équipe est
 *   partie, la case porte « FF » en rouge au lieu d'un nombre, et le restera
 *   pour toutes les manches suivantes.
 * - `OUT` — l'équipe était déjà éliminée : elle n'a pas disputé cette manche et
 *   n'a donc aucun capital à y montrer.
 */
export type EnduranceRoundCell = {
  round: number;
  kind: "POINTS" | "FORFEIT" | "OUT";
  /** Capital à l'issue de la manche. `null` hors des cases `POINTS`. */
  points: number | null;
};

/** Abandon déclaré : décision humaine, non déductible des matchs. */
export type EnduranceForfeit = { teamId: number; round: number };

export type ReplayEnduranceInput = {
  teams: { teamId: number; seed: number }[];
  matches: EnduranceMatchOutcome[];
  forfeits: EnduranceForfeit[];
  config: EnduranceConfig;
  /** Dernière manche générée. */
  lastRound: number;
  /**
   * Format de match du tournoi (`null` = score libre). Il ne sert qu'à chiffrer
   * un forfait, seul cas où aucun score n'est saisi.
   */
  matchFormat?: MatchFormat | null;
};

/** Normalise un barème partiel (valeurs manquantes ou absurdes → défauts). */
export function resolveEnduranceConfig(input?: Partial<EnduranceConfig> | null): EnduranceConfig {
  const start = Number(input?.startPoints);
  const win = Number(input?.winDelta);
  const loss = Number(input?.lossDelta);
  const playoff = Number(input?.playoffSize);
  const maxRounds = Number(input?.maxRounds);

  return {
    startPoints: Number.isFinite(start) && start > 0 ? Math.floor(start) : DEFAULT_ENDURANCE_CONFIG.startPoints,
    winDelta: Number.isFinite(win) && win > 0 ? Math.floor(win) : DEFAULT_ENDURANCE_CONFIG.winDelta,
    lossDelta: Number.isFinite(loss) && loss > 0 ? Math.floor(loss) : DEFAULT_ENDURANCE_CONFIG.lossDelta,
    playoffSize:
      Number.isFinite(playoff) && playoff >= 2 ? Math.floor(playoff) : DEFAULT_ENDURANCE_CONFIG.playoffSize,
    // Une limite absurde (0, négative, absente) n'est pas une limite : le mode
    // retombe alors sur la phase à durée libre, son comportement d'origine.
    maxRounds: Number.isFinite(maxRounds) && maxRounds >= 1 ? Math.floor(maxRounds) : null,
  };
}

/**
 * Ordre de classement : endurance décroissante, puis — à égalité — l'ordre du
 * classement précédent, comme l'impose le règlement.
 *
 * Attention, ce n'est **pas** équivalent à départager par le seed initial : deux
 * équipes qui se croisent en cours de route conservent leur ordre relatif du
 * moment, pas celui du départ.
 */
export function compareEndurance(a: EnduranceStanding, b: EnduranceStanding): number {
  if (b.points !== a.points) return b.points - a.points;
  return a.previousRank - b.previousRank;
}

/** Équipes encore en lice, de la meilleure à la moins bonne. */
export function rankActiveTeams(standings: EnduranceStanding[]): EnduranceStanding[] {
  return standings.filter((s) => s.status === "ACTIVE").sort(compareEndurance);
}

/**
 * Appariement d'une manche : couples adjacents du classement courant. Sur un
 * effectif impair, la dernière équipe ne joue pas — elle ne perd ni ne gagne
 * de point (la règle ne prévoit aucune victoire d'office).
 */
export function planEnduranceRound(standings: EnduranceStanding[]): EndurancePairing[] {
  const ordered = rankActiveTeams(standings);
  const pairings: EndurancePairing[] = [];

  for (let index = 0; index + 1 < ordered.length; index += 2) {
    pairings.push({ teamAId: ordered[index].teamId, teamBId: ordered[index + 1].teamId });
  }

  if (ordered.length % 2 === 1) {
    pairings.push({ teamAId: ordered[ordered.length - 1].teamId, teamBId: null });
  }

  return pairings;
}

/** La phase qualificative est-elle terminée ? (effectif retombé à la cible) */
export function qualificationComplete(activeCount: number, config: EnduranceConfig): boolean {
  return activeCount <= config.playoffSize;
}

/**
 * Le plafond de manches qualificatives est-il atteint ?
 *
 * `completedRounds` compte les manches **déjà closes**. Sans plafond la réponse
 * est toujours « non » : la phase ne s'arrête alors que sur l'effectif, comme
 * elle l'a toujours fait.
 */
export function roundLimitReached(config: EnduranceConfig, completedRounds: number): boolean {
  return config.maxRounds !== null && completedRounds >= config.maxRounds;
}

/**
 * Amplitude d'une manche pour une équipe : ce qu'elle peut gagner au mieux, ce
 * qu'elle peut perdre au pire.
 *
 * Le plafond vient du **format de match** : en FT3 un vainqueur emporte trois
 * maps au maximum, un perdant en encaisse trois. Sans format — tournoi en
 * saisie libre — il n'y a pas de plafond du tout, donc `null` : rien n'y est
 * mathématiquement acquis, et aucune équipe ne peut être écartée d'avance.
 */
export function enduranceRoundSwing(
  config: EnduranceConfig,
  format: MatchFormat | null | undefined,
): { gain: number; loss: number } | null {
  if (!format) return null;

  const maps = matchWinsRequired(format);
  return { gain: config.winDelta * maps, loss: config.lossDelta * maps };
}

/**
 * Équipes à écarter à la fin d'une manche, quand la phase a un plafond.
 *
 * Deux situations, la même conclusion — l'équipe ne jouera plus :
 *
 * - `remainingRounds <= 0` — la dernière manche vient d'être jouée : les
 *   `playoffSize` premières sont qualifiées, **tout le reste sort**. Sans ce
 *   trait, la phase s'arrêterait en laissant trente équipes « en lice » dont
 *   huit seulement disputent l'arbre. Un reste **négatif** y est rangé plutôt
 *   qu'écarté : la phase est finie dans les deux cas, alors que ne rien couper
 *   laisserait un tournoi sans issue — plus de manche à poser (le plafond
 *   l'interdit) et jamais assez d'éliminations pour basculer en play-offs.
 * - `remainingRounds > 0` — élimination **mathématique** : une équipe sort dès
 *   qu'au moins `playoffSize` autres finiront devant elle quoi qu'il arrive. Le
 *   critère compare le **plafond** de l'équipe (elle gagne tout ce qui reste) au
 *   **plancher** des autres (elles perdent tout ce qui reste) : mieux vaut
 *   garder une manche de trop une équipe condamnée que d'en sortir une qui
 *   pouvait encore revenir. Une adversaire dont le plancher dépasse ce plafond
 *   ne peut pas non plus tomber à zéro en route — son acquis est donc réel, pas
 *   seulement arithmétique.
 *
 * **Parité.** Un effectif impair fait chômer une équipe à chaque manche : la
 * coupe mathématique est abandonnée si elle laisse un nombre impair d'équipes
 * *à qui il reste des manches à jouer*. On ne prive pas une équipe en course de
 * sa manche pour sortir des équipes condamnées — elles le resteront à la
 * manche suivante. Le cas ne se pose pas quand la coupe ramène pile à
 * `playoffSize` : plus personne ne dispute de manche qualificative derrière.
 */
export function enduranceEliminationCut(
  standings: EnduranceStanding[],
  config: EnduranceConfig,
  remainingRounds: number,
  format: MatchFormat | null | undefined,
): number[] {
  const active = rankActiveTeams(standings);

  // Plus de manche à jouer : la coupe est un simple trait sous la cible.
  if (remainingRounds <= 0) return active.slice(config.playoffSize).map((s) => s.teamId);

  const swing = enduranceRoundSwing(config, format);
  if (!swing) return [];

  const gain = swing.gain * remainingRounds;
  const loss = swing.loss * remainingRounds;

  const doomed = active.filter((team) => {
    const ceiling = team.points + gain;
    const ahead = active.filter(
      (other) => other.teamId !== team.teamId && other.points - loss > ceiling,
    ).length;
    return ahead >= config.playoffSize;
  });

  if (doomed.length === 0) return [];

  const survivors = active.length - doomed.length;
  if (survivors > config.playoffSize && survivors % 2 !== 0) return [];

  return doomed.map((team) => team.teamId);
}

/**
 * Applique le solde de maps d'une équipe sur son capital, et la sort du tournoi
 * si celui-ci tombe à 0.
 *
 * Le contrôle vaut pour les **deux** équipes du match, pas seulement la
 * perdante : sur un barème où la perte pèse plus que le gain, un 3-2 peut
 * coûter des points à son vainqueur.
 */
function applyMapDelta(
  standing: EnduranceStanding,
  mapsWon: number,
  mapsLost: number,
  config: EnduranceConfig,
  round: number,
): void {
  standing.points += config.winDelta * mapsWon - config.lossDelta * mapsLost;
  if (standing.points <= 0) {
    standing.points = 0;
    standing.status = "ELIMINATED";
    standing.eliminatedRound = round;
  }
}

/**
 * État d'une équipe à la fin de la manche qu'on est en train d'enregistrer.
 *
 * Le statut est lu **au moment où la manche se referme**, pas à la fin du
 * rejeu : c'est ce qui rend la case honnête. Une équipe éliminée à la manche 5
 * a bien un capital à montrer pour les manches 1 à 4 ; lire son statut final
 * les blanchirait toutes.
 */
function enduranceRoundCell(standing: EnduranceStanding, round: number): EnduranceRoundCell {
  // Le forfait couvre la manche où il est déclaré **et tout le reste** : c'est
  // la case rouge « FF » du tableau, pas un capital tombé à zéro.
  if (standing.status === "FORFEIT") return { round, kind: "FORFEIT", points: null };

  // Sortie lors d'une manche **antérieure** : elle n'a pas joué celle-ci. La
  // manche de sa sortie, elle, affiche son capital — c'est le résultat de la
  // manche, et pour une équipe écartée faute de perspectives ce capital n'est
  // même pas nul.
  if (
    standing.status !== "ACTIVE" &&
    standing.eliminatedRound !== null &&
    standing.eliminatedRound < round
  ) {
    return { round, kind: "OUT", points: null };
  }

  return { round, kind: "POINTS", points: standing.points };
}

/** Rejeu complet : classement final **et** capital manche par manche. */
export type EnduranceReplay = {
  standings: EnduranceStanding[];
  /** Manches rejouées, dans l'ordre (1..N). Vide avant la première manche. */
  rounds: number[];
  /** Cases du tableau, par équipe, alignées sur `rounds`. */
  history: Map<number, EnduranceRoundCell[]>;
};

/**
 * Rejoue la phase qualificative et renvoie l'état complet des équipes.
 *
 * L'élimination est **immédiate** : dès que le capital atteint 0 au cours d'une
 * manche, l'équipe est sortie et ne participe plus aux suivantes — même si un
 * match ultérieur la mentionnait (cas d'un score corrigé a posteriori).
 */
export function replayEndurance(input: ReplayEnduranceInput): EnduranceStanding[] {
  return replayEnduranceDetailed(input).standings;
}

/**
 * Même rejeu, avec l'historique manche par manche en plus.
 *
 * Il n'est pas stocké : il se dérive du même parcours que le classement, donc
 * une correction de score le refait comme elle refait tout le reste. C'est la
 * raison d'être de cette variante — recalculer l'historique dans un second
 * passage laisserait deux vérités possibles pour un même tournoi.
 */
export function replayEnduranceDetailed(input: ReplayEnduranceInput): EnduranceReplay {
  const { teams, matches, forfeits, config, lastRound, matchFormat } = input;

  const standings = new Map<number, EnduranceStanding>(
    teams.map((team) => [
      team.teamId,
      {
        teamId: team.teamId,
        seed: team.seed,
        points: config.startPoints,
        wins: 0,
        losses: 0,
        status: "ACTIVE" as EnduranceStatus,
        eliminatedRound: null,
        rank: team.seed,
        previousRank: team.seed,
      },
    ]),
  );

  const forfeitsByRound = new Map<number, number[]>();
  for (const forfeit of forfeits) {
    const list = forfeitsByRound.get(forfeit.round) ?? [];
    list.push(forfeit.teamId);
    forfeitsByRound.set(forfeit.round, list);
  }

  const maxRound = Math.max(
    lastRound,
    ...matches.map((m) => m.round),
    ...forfeits.map((f) => f.round),
    0,
  );

  // Une manche est **close** quand elle a des matchs et qu'ils sont tous joués.
  // La coupe de fin de manche s'y adosse : sur une manche entamée, une équipe
  // qui n'a pas encore disputé la sienne verrait son plafond calculé comme si
  // elle avait déjà tout perdu.
  const roundProgress = new Map<number, { total: number; done: number }>();
  for (const match of matches) {
    const entry = roundProgress.get(match.round) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (match.completed) entry.done += 1;
    roundProgress.set(match.round, entry);
  }
  const roundIsClosed = (round: number): boolean => {
    const entry = roundProgress.get(round);
    return entry !== undefined && entry.total > 0 && entry.total === entry.done;
  };

  const rounds: number[] = [];
  const history = new Map<number, EnduranceRoundCell[]>(teams.map((team) => [team.teamId, []]));

  for (let round = 1; round <= maxRound; round += 1) {
    for (const match of matches) {
      if (match.round !== round || !match.completed) continue;

      const winner = match.winnerTeamId === null ? null : standings.get(match.winnerTeamId);
      const loser = match.loserTeamId === null ? null : standings.get(match.loserTeamId);

      // Un match impliquant une équipe déjà sortie ne compte pour personne : ni
      // résurrection de l'éliminée, ni point retiré à son adversaire. Le cas ne
      // devrait pas se produire (le moteur n'apparie que des équipes actives),
      // mais un score corrigé après coup peut le faire apparaître.
      if (!winner || !loser || winner.status !== "ACTIVE" || loser.status !== "ACTIVE") {
        continue;
      }

      const { winnerMaps, loserMaps } = enduranceMatchMaps(match, matchFormat);

      winner.wins += 1;
      loser.losses += 1;

      // Barème map par map, dans les deux sens : le vainqueur d'un 3-2 ne
      // gagne qu'un point net, celui d'un 3-0 en gagne trois.
      applyMapDelta(winner, winnerMaps, loserMaps, config, round);
      applyMapDelta(loser, loserMaps, winnerMaps, config, round);
    }

    for (const teamId of forfeitsByRound.get(round) ?? []) {
      const standing = standings.get(teamId);
      if (!standing) continue;
      // L'abandon prime sur l'élimination que son propre match de forfait vient
      // peut-être de provoquer dans cette même manche (le score plein peut vider
      // le capital) : c'est la décision humaine qui est écrite au classement.
      const eliminatedThisRound =
        standing.status === "ELIMINATED" && standing.eliminatedRound === round;
      if (standing.status === "ACTIVE" || eliminatedThisRound) {
        standing.status = "FORFEIT";
        standing.eliminatedRound = round;
        standing.points = 0;
      }
    }

    // Coupe de fin de manche — seulement sous plafond de manches, seulement sur
    // une manche close. Les équipes écartées gardent leur capital : c'est
    // l'horizon qui leur manque, pas les points.
    if (config.maxRounds !== null && roundIsClosed(round)) {
      const cut = enduranceEliminationCut(
        [...standings.values()],
        config,
        config.maxRounds - round,
        matchFormat,
      );
      for (const teamId of cut) {
        const standing = standings.get(teamId);
        if (!standing) continue;
        standing.status = "OUT_OF_CONTENTION";
        standing.eliminatedRound = round;
      }
    }

    // Fige l'ordre de cette manche : il servira de départage à la suivante.
    const ordered = [...standings.values()].filter((s) => s.status === "ACTIVE").sort(compareEndurance);
    ordered.forEach((standing, index) => {
      standing.previousRank = index + 1;
    });

    rounds.push(round);
    for (const standing of standings.values()) {
      history.get(standing.teamId)?.push(enduranceRoundCell(standing, round));
    }
  }

  return { standings: assignRanks([...standings.values()]), rounds, history };
}

/**
 * Classe les équipes : les actives d'abord (endurance puis ordre précédent),
 * ensuite les sorties, de la dernière éliminée à la première — une équipe qui a
 * tenu plus longtemps finit devant.
 */
export function assignRanks(standings: EnduranceStanding[]): EnduranceStanding[] {
  const active = standings.filter((s) => s.status === "ACTIVE").sort(compareEndurance);

  const out = standings
    .filter((s) => s.status !== "ACTIVE")
    .sort((a, b) => {
      const roundA = a.eliminatedRound ?? 0;
      const roundB = b.eliminatedRound ?? 0;
      if (roundB !== roundA) return roundB - roundA;
      if (b.points !== a.points) return b.points - a.points;
      return a.previousRank - b.previousRank;
    });

  return [...active, ...out].map((standing, index) => ({ ...standing, rank: index + 1 }));
}

/**
 * Tableau des quarts de finale, en rangs de qualification (1 = meilleure).
 *
 * Volontairement différent d'un seeding classique : le règlement impose
 * 8v4, 6v2, 1v5 puis 3v7, dans cet ordre d'affichage. L'équipe du haut prend le
 * side gauche, celle du bas le side droite.
 */
export const PLAYOFF_QUARTER_PAIRINGS: readonly (readonly [number, number])[] = [
  [8, 4],
  [6, 2],
  [1, 5],
  [3, 7],
];

/**
 * Convertit les rangs de qualification en identifiants d'équipes pour les
 * quarts de finale. `qualified` est ordonné du 1ᵉʳ au dernier qualifié.
 *
 * @throws INVALID_PLAYOFF_FIELD si l'effectif n'est pas celui attendu.
 */
export function buildPlayoffPairings(qualified: number[]): EndurancePairing[] {
  if (qualified.length !== PLAYOFF_QUARTER_PAIRINGS.length * 2) {
    throw new Error("INVALID_PLAYOFF_FIELD");
  }

  return PLAYOFF_QUARTER_PAIRINGS.map(([topRank, bottomRank]) => ({
    teamAId: qualified[topRank - 1],
    teamBId: qualified[bottomRank - 1],
  }));
}

/**
 * Les `playoffSize` premières équipes **encore en lice**, dans l'ordre.
 *
 * Le filtre sur le statut n'est pas décoratif : `assignRanks` range les actives
 * d'abord puis les sorties, si bien qu'une simple tranche compléterait le
 * plateau avec des éliminées dès qu'il en reste moins que `playoffSize`. Le cas
 * n'était qu'un accident tant qu'une manche ne retirait qu'un point au perdant ;
 * le barème par map en fait une situation ordinaire — un 3-0 en retire trois, et
 * plusieurs équipes proches de zéro sortent alors dans la même manche.
 *
 * L'appelant sait déjà quoi faire d'un effectif qui n'est pas exactement celui
 * attendu : `startEndurancePlayoffs` retombe sur un appariement haut contre bas,
 * et clôt le tournoi à une qualifiée ou moins.
 */
export function selectQualifiedTeamIds(
  standings: EnduranceStanding[],
  config: EnduranceConfig,
): number[] {
  return assignRanks(standings)
    .filter((standing) => standing.status === "ACTIVE")
    .slice(0, config.playoffSize)
    .map((standing) => standing.teamId);
}
