/**
 * Retour en arrière : défaire le dernier stade joué d'un tournoi, à répétition.
 *
 * Le geste répond à un cas très concret d'organisation : une manche a été
 * saisie sur de mauvais appariements, ou toute une manche a été jouée avant
 * qu'on s'aperçoive que la précédente portait une erreur. `match-lock` verrouille
 * alors la manche fautive — **y compris pour un administrateur** — parce que la
 * manche suivante porte des saisies. Le seul chemin de sortie était d'effacer
 * ces scores un par un, dans le bon ordre, sur un plateau qui peut compter
 * plusieurs dizaines de rencontres.
 *
 * D'où une action unique : **effacer le dernier stade joué**, qui rouvre le
 * précédent à la correction. Elle se **répète** — un stade par appel, du dernier
 * jusqu'au premier — parce qu'une erreur se rattrape d'un cran ou deux, jamais
 * en recommençant le tournoi. Le terminus est `ROLLBACK_NOTHING_TO_UNDO` :
 * plus rien n'est saisi, le tournoi est à l'instant de son coup d'envoi.
 *
 * ## Le stade, et pourquoi ce n'est pas le numéro de manche
 *
 * Un numéro de manche ne situe un match que dans les formats qui n'en ont qu'une
 * série. Il ne dit rien en double élimination (les deux tableaux se numérotent
 * chacun de leur côté : « manche 3 » y désigne deux stades sans rapport), rien
 * en multi-phases (chaque phase repart de 1), et il ment sur la petite finale
 * (créée en manche 1 par `bracket-single.ts`, jouée avec la finale).
 *
 * Un **stade** est donc un couple `(rang de phase, index)`, comparé dans cet
 * ordre, et l'index se lit de deux façons selon ce que le groupe de matchs d'une
 * phase donne à voir :
 *
 * · **Un plateau** — au moins un match y porte un lien `next_winner_match_id` /
 *   `next_loser_match_id`. L'index est alors tiré du **graphe** : profondeur =
 *   plus long chemin jusqu'à une racine, index = `maxProfondeur − profondeur`.
 *   En élimination simple cela redonne exactement le numéro de manche, et range
 *   la petite finale au stade de la finale sans cas particulier (elle est une
 *   racine, comme la finale). En double élimination cela produit l'ordre réel
 *   de déroulement — UB1, puis {UB2, LB1}, puis LB2, puis {UB3, LB3}, LB4, et
 *   la grande finale : chaque stade ne contient que des rencontres qui ne
 *   dépendent pas les unes des autres.
 * · **Un classement** — aucun lien : l'index *est* le numéro de manche. Les
 *   trois modes à classement appareillent depuis un classement, jamais par des
 *   liens de plateau ; l'arbre final de la BlueGenji Survie non plus, et ses
 *   tours sont numérotés à partir de `PLAYOFF_ROUND_OFFSET`, si bien qu'ils se
 *   rangent d'eux-mêmes après les manches qualificatives.
 *
 * Les deux familles se distinguent donc **par les liens eux-mêmes**, jamais par
 * le nom du format : c'est ce qui permet à ce module de traiter un tournoi
 * multi-phases sans rien connaître de ses phases, et à un format ajouté demain
 * d'entrer dans la règle sans une ligne.
 *
 * ## Ce que le stade suivant garantit
 *
 * Le stade visé est le **plus grand** parmi les matchs portant une saisie
 * (`hasScoreInput`). Tout ce qui le suit est donc nécessairement vierge : le
 * retour en arrière n'efface jamais un résultat qu'il n'a pas montré. Ce qui
 * suit est *détaché* sur un plateau (la structure naît au lancement, ses
 * identifiants sont des adresses publiques) et *supprimé* dans un format à
 * classement, dont le moteur pose ses manches une à une. Une **phase
 * ultérieure** est supprimée dans tous les cas : son plateau a été posé avec
 * les qualifiées de la phase qu'on rouvre.
 *
 * Module pur : l'interface s'en sert pour n'ouvrir le dialogue que sur un stade
 * réellement effaçable et pour montrer les scores qui vont partir, le serveur
 * pour décider ce qu'il écrit (`lib/server/tournaments/rollback.ts`). Deux
 * implémentations divergeraient au premier format ajouté.
 */
import { isEndurancePlayoffRound, PLAYOFF_ROUND_OFFSET } from "./bg-survie";
import { hasScoreInput, type MatchScoreState } from "./match-lock";
import type { BracketType } from "./types";

/**
 * Vue d'un match suffisante pour décider du retour en arrière : celle de
 * `match-lock` (qui sait lire une saisie, et porte déjà liens de plateau et
 * phase), plus la partie de plateau — le dialogue s'en sert pour nommer les
 * rencontres qu'il efface.
 */
export type RollbackMatch = MatchScoreState & { bracket: BracketType };

/**
 * Seul refus du module pur.
 *
 * Il n'y en avait trois de plus — format non pris en charge, arbre d'endurance
 * tiré —, et ils ont disparu avec le stade : le graphe ordonne la double
 * élimination, le rang de phase ordonne le multi-phases, et l'arbre final de la
 * BlueGenji Survie se défait tour par tour comme n'importe quel plateau.
 */
export type RollbackRefusal = "ROLLBACK_NOTHING_TO_UNDO";

/** Position d'un match dans le déroulement du tournoi. */
export interface RollbackStage {
  /** Rang de la phase (0 = tournoi sans phases). */
  phaseRank: number;
  /** Index du stade dans sa phase. Croissant dans l'ordre du jeu. */
  index: number;
}

/** Ce qu'un retour en arrière va écrire. */
export interface RollbackPlan {
  stage: RollbackStage;
  /**
   * Le stade sous forme de chaîne, échangée avec le serveur.
   *
   * Contrôle de concurrence : le dialogue **montre** les rencontres qu'il
   * efface, et renvoie la clé du stade qu'il a promis d'effacer. Le serveur
   * recalcule le plan sur une lecture verrouillée et refuse plutôt que
   * d'effacer des scores que personne n'a vus.
   */
  stageKey: string;
  /**
   * Numéro affiché de la manche défaite.
   *
   * Sur un plateau, c'est le rang du stade (`index + 1`) et non le numéro de
   * manche stocké : en élimination simple les deux coïncident, en double ils ne
   * le peuvent pas. Dans un format à classement, c'est le numéro de manche.
   */
  roundNumber: number;
  /** Tour de l'arbre final d'une BlueGenji Survie (numéroté depuis 1000). */
  playoffRound: boolean;
  /** Matchs du stade : saisies, vainqueur et forfait effacés, rencontres gardées. */
  clearedMatchIds: number[];
  /** Ce qui suit sur un plateau : vidé de ses qualifiées, jamais supprimé. */
  detachedMatchIds: number[];
  /** Ce qui suit ailleurs : supprimé, le moteur le reposera. */
  deletedMatchIds: number[];
}

/** Ce qu'il faut d'un plan pour le nommer. Le serveur en compose un après coup. */
export type RollbackStageDescriptor = Pick<
  RollbackPlan,
  "stage" | "roundNumber" | "playoffRound"
>;

/**
 * Rang de la phase d'un match, dans le vocabulaire de `match-lock` : la position
 * voulue par l'organisateur d'abord, l'identifiant ensuite (les phases sont
 * insérées dans l'ordre des positions), 0 pour un tournoi sans phases.
 */
function phaseRankOf(match: RollbackMatch): number {
  return match.phasePosition ?? match.phaseId ?? 0;
}

/** Ordre de déroulement : la phase d'abord, le stade ensuite. */
export function compareRollbackStages(a: RollbackStage, b: RollbackStage): number {
  return a.phaseRank - b.phaseRank || a.index - b.index;
}

/** Le stade sous forme de chaîne, telle qu'elle voyage jusqu'au serveur. */
export function rollbackStageKey(stage: RollbackStage): string {
  return `${stage.phaseRank}:${stage.index}`;
}

/** Ce groupe de matchs est-il un plateau ? Ses liens le disent, pas son format. */
function isBracketGroup(group: readonly RollbackMatch[]): boolean {
  return group.some(
    (match) => match.nextWinnerMatchId !== null || match.nextLoserMatchId !== null,
  );
}

/**
 * Profondeur de chaque match d'un plateau : plus long chemin jusqu'à une racine.
 *
 * Le **plus long** et non le plus court, parce qu'un match de double élimination
 * mène à la grande finale par deux chemins de longueurs différentes (le
 * vainqueur du tableau principal y va en un pas, son perdant en repasse par tout
 * le repêchage). Prendre le plus court rangerait la finale du tableau principal
 * avant des rencontres qui la précèdent.
 *
 * Le garde-fou anti-cycle ne devrait jamais servir — un plateau est un graphe
 * acyclique par construction — mais une ligne abîmée ne doit pas faire boucler
 * l'interface.
 */
function bracketDepths(group: readonly RollbackMatch[]): Map<number, number> {
  const byId = new Map(group.map((match) => [match.id, match]));
  const depths = new Map<number, number>();
  const visiting = new Set<number>();

  const depthOf = (match: RollbackMatch): number => {
    const known = depths.get(match.id);
    if (known !== undefined) return known;
    if (visiting.has(match.id)) return 0;
    visiting.add(match.id);

    let depth = 0;
    for (const targetId of [match.nextWinnerMatchId, match.nextLoserMatchId]) {
      if (targetId === null) continue;
      // Un lien qui sort du groupe ne compte pas : il n'y en a pas d'un plateau
      // à l'autre, et une donnée abîmée ne doit pas déplacer un stade.
      const target = byId.get(targetId);
      if (target === undefined) continue;
      depth = Math.max(depth, depthOf(target) + 1);
    }

    visiting.delete(match.id);
    depths.set(match.id, depth);
    return depth;
  };

  for (const match of group) depthOf(match);
  return depths;
}

/** Index de stade de chaque match, et rangs de phase reconnus comme plateaux. */
function stageIndexes(matches: readonly RollbackMatch[]): {
  indexOf: Map<number, number>;
  bracketPhases: Set<number>;
} {
  const groups = new Map<number, RollbackMatch[]>();
  for (const match of matches) {
    const rank = phaseRankOf(match);
    const group = groups.get(rank);
    if (group) group.push(match);
    else groups.set(rank, [match]);
  }

  const indexOf = new Map<number, number>();
  const bracketPhases = new Set<number>();

  for (const [rank, group] of groups) {
    if (!isBracketGroup(group)) {
      for (const match of group) indexOf.set(match.id, match.roundNumber);
      continue;
    }

    bracketPhases.add(rank);
    const depths = bracketDepths(group);
    let maxDepth = 0;
    for (const depth of depths.values()) maxDepth = Math.max(maxDepth, depth);
    for (const match of group) indexOf.set(match.id, maxDepth - (depths.get(match.id) ?? 0));
  }

  return { indexOf, bracketPhases };
}

/**
 * Décide ce que défaire, ou dit qu'il n'y a plus rien à défaire.
 *
 * Le format du tournoi n'entre pas dans la décision, et ce n'est pas un oubli :
 * tout ce qu'il faut savoir — plateau ou classement, ordre des phases — se lit
 * sur les matchs eux-mêmes. Voir l'en-tête du module.
 *
 * @param matches Tous les matchs du tournoi.
 * @returns Le plan d'écriture, ou le motif de refus.
 */
export function planRoundRollback(
  matches: readonly RollbackMatch[],
): RollbackPlan | RollbackRefusal {
  const played = matches.filter(hasScoreInput);
  if (played.length === 0) return "ROLLBACK_NOTHING_TO_UNDO";

  const { indexOf, bracketPhases } = stageIndexes(matches);
  const stageOf = (match: RollbackMatch): RollbackStage => ({
    phaseRank: phaseRankOf(match),
    index: indexOf.get(match.id) ?? match.roundNumber,
  });

  // Le dernier stade **joué**, pas le dernier existant : en élimination tout le
  // plateau naît au lancement, la finale existe donc dès la première rencontre.
  let target = stageOf(played[0]);
  for (const match of played) {
    const stage = stageOf(match);
    if (compareRollbackStages(stage, target) > 0) target = stage;
  }

  const targetIsBracket = bracketPhases.has(target.phaseRank);
  const clearedMatchIds: number[] = [];
  const detachedMatchIds: number[] = [];
  const deletedMatchIds: number[] = [];

  for (const match of matches) {
    const order = compareRollbackStages(stageOf(match), target);
    if (order < 0) continue;
    if (order === 0) {
      clearedMatchIds.push(match.id);
      continue;
    }

    // Une phase ultérieure a été posée avec les qualifiées de celle qu'on
    // rouvre : elle est supprimée quoi qu'il arrive, et le moteur la reposera.
    // À l'intérieur d'une même phase, c'est la nature du groupe qui tranche.
    if (phaseRankOf(match) > target.phaseRank || !targetIsBracket) {
      deletedMatchIds.push(match.id);
    } else {
      detachedMatchIds.push(match.id);
    }
  }

  return {
    stage: target,
    stageKey: rollbackStageKey(target),
    // Dans un groupe à classement, l'index **est** le numéro de manche.
    roundNumber: targetIsBracket ? target.index + 1 : target.index,
    playoffRound: !targetIsBracket && isEndurancePlayoffRound(target.index),
    clearedMatchIds,
    detachedMatchIds,
    deletedMatchIds,
  };
}

/**
 * Libellé du stade défait, pour le dialogue de confirmation et le journal.
 *
 * Les tours de l'arbre final de la BlueGenji Survie sont numérotés à partir de
 * {@link PLAYOFF_ROUND_OFFSET} : les afficher tels quels annoncerait « manche
 * 1002 » sur un tournoi qui en a joué neuf.
 */
export function rollbackStageLabel(plan: RollbackStageDescriptor): string {
  const round = plan.playoffRound
    ? `tour ${plan.roundNumber - PLAYOFF_ROUND_OFFSET + 1} des play-offs`
    : `manche ${plan.roundNumber}`;

  return plan.stage.phaseRank > 0 ? `${round} de la phase ${plan.stage.phaseRank}` : round;
}

/**
 * Le même libellé, précédé de son article défini.
 *
 * Il en faut deux, et c'est le français qui l'impose : une **manche** est
 * féminine, un **tour** de play-off masculin. Toute phrase qui accorde quoi que
 * ce soit avec le libellé — un article, un participe — se trompe une fois sur
 * deux si elle le fabrique elle-même. Les deux formes sont donc écrites ici, et
 * les textes sont tournés pour n'avoir jamais besoin d'une troisième (« de
 * la manche 4 » et « du tour 2 » ne se dérivent pas l'un de l'autre).
 */
export function rollbackStageLabelWithArticle(plan: RollbackStageDescriptor): string {
  const article = plan.playoffRound ? "le" : "la";
  return `${article} ${rollbackStageLabel(plan)}`;
}
