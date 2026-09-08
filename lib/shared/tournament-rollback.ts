/**
 * Retour en arrière : défaire la manche courante d'un tournoi.
 *
 * Le geste répond à un cas très concret d'organisation : une manche a été
 * saisie sur de mauvais appariements, ou toute une manche a été jouée avant
 * qu'on s'aperçoive que la précédente portait une erreur. `match-lock` verrouille
 * alors la manche fautive — **y compris pour un administrateur** — parce que la
 * manche suivante porte des saisies. Le seul chemin de sortie était d'effacer
 * ces scores un par un, dans le bon ordre, sur un plateau qui peut compter
 * plusieurs dizaines de rencontres.
 *
 * D'où une action unique : **effacer la manche courante d'un coup**, ce qui
 * ramène le tournoi à l'instant qui précède son coup d'envoi et rouvre la manche
 * d'avant à la correction.
 *
 * ## Ce que « la manche courante » veut dire
 *
 * La dernière manche **portant une saisie** (`hasScoreInput` : un score même nul,
 * un vainqueur, un forfait, un report en attente). Pas la dernière manche
 * *existante* : en élimination, tout le plateau est créé au lancement, et la
 * finale existe donc dès la première rencontre. Prendre la dernière manche
 * *jouée* est la seule lecture qui donne la même réponse aux deux familles de
 * formats.
 *
 * La **petite finale** se joue au même stade que la finale, mais porte le numéro
 * de manche 1 en élimination simple (`bracket-single.ts`). Elle est donc rangée
 * par {@link matchStage} au stade de la finale, faute de quoi défaire la manche 1
 * d'un tournoi à seize équipes effacerait aussi la petite finale — et défaire la
 * finale la laisserait, elle, debout.
 *
 * ## Ce qui n'est pas couvert, et pourquoi
 *
 * · **Double élimination** : les manches du winner et du loser bracket avancent
 *   en parallèle et se numérotent chacune de leur côté. « Manche 3 » n'y désigne
 *   pas un stade du tournoi mais deux stades sans rapport, et les effacer
 *   ensemble reculerait d'un cran ici et de trois là.
 * · **Multi-phases** : une manche appartient à une phase, dont la clôture a
 *   remis ses qualifiées à la suivante. Défaire la dernière manche d'une phase
 *   close supposerait de *rouvrir* la phase et de défaire le plateau de la
 *   suivante — ce que le moteur ne sait pas faire (`reconcilePhases` relit un
 *   classement, il ne revient jamais en arrière sur une phase démarrée).
 * · **BlueGenji Survie, arbre lancé** : une fois les play-offs tirés, défaire
 *   une manche *qualificative* rendrait à la course des équipes que l'arbre a
 *   été tiré sans elles. Les tours de l'arbre, eux, se défont normalement.
 *
 * Module pur : l'interface s'en sert pour n'ouvrir le dialogue que sur une
 * manche réellement effaçable et pour montrer les scores qui vont partir, le
 * serveur pour décider ce qu'il écrit (`lib/server/tournaments/rollback.ts`).
 * Deux implémentations divergeraient au premier format ajouté.
 */
import { isEndurancePlayoffRound, PLAYOFF_ROUND_OFFSET } from "./bg-survie";
import { hasScoreInput, type MatchScoreState } from "./match-lock";
import type { BracketType, TournamentFormat } from "./types";

/** Formats dont la manche courante se défait. Voir l'en-tête pour les autres. */
export const ROLLBACK_SUPPORTED_FORMATS: readonly TournamentFormat[] = [
  "SINGLE",
  "SWISS",
  "SURVIVAL",
  "BG_SURVIE",
];

/**
 * Vue d'un match suffisante pour décider du retour en arrière : celle de
 * `match-lock` (qui sait lire une saisie), plus la partie de plateau — la petite
 * finale ne se range pas sur son numéro de manche.
 */
export type RollbackMatch = MatchScoreState & { bracket: BracketType };

/** Refus possibles, rendus tels quels par la route et traduits par l'interface. */
export type RollbackRefusal =
  | "ROLLBACK_UNSUPPORTED_FORMAT"
  | "ROLLBACK_NOTHING_TO_UNDO"
  | "ROLLBACK_PLAYOFFS_STARTED";

/**
 * Sort réservé à ce qui descendait de la manche défaite.
 *
 * · `DETACH` — plateau à élimination : les matchs existent depuis le lancement
 *   et portent la structure du tournoi. On les vide de leurs qualifiées, on ne
 *   les supprime pas.
 * · `DELETE` — formats à classement : une manche est *posée* par le moteur quand
 *   la précédente est complète. La manche d'après n'a plus lieu d'être, et ses
 *   appariements sont de toute façon périmés — le moteur la reposera.
 */
export type RollbackDisposal = "DETACH" | "DELETE";

/** Ce qu'un retour en arrière va écrire. */
export interface RollbackPlan {
  /** Numéro de la manche défaite (celui de la base, offset des play-offs compris). */
  roundNumber: number;
  /** Matchs de la manche : saisies, vainqueur et forfait effacés. */
  clearedMatchIds: number[];
  /** Ce qui en descendait, traité selon {@link disposal}. */
  laterMatchIds: number[];
  disposal: RollbackDisposal;
}

/** Le format admet-il le retour en arrière ? */
export function isRollbackSupported(format: TournamentFormat): boolean {
  return ROLLBACK_SUPPORTED_FORMATS.includes(format);
}

/**
 * Stade auquel se joue un match, tous formats confondus.
 *
 * C'est son numéro de manche, à une exception près : la **petite finale**, que
 * l'élimination simple crée en manche 1 (elle n'a pas de tour amont à numéroter)
 * alors qu'elle se joue avec la finale. On la range donc au stade le plus élevé
 * du plateau — ce que la BlueGenji Survie fait déjà d'elle-même, sa petite
 * finale portant le numéro de la finale : le `Math.max` rend alors la même
 * valeur et ne change rien.
 *
 * @param match Match à situer.
 * @param lastRound Plus grand numéro de manche hors petite finale.
 */
function matchStage(match: RollbackMatch, lastRound: number): number {
  if (match.bracket !== "THIRD_PLACE") return match.roundNumber;
  return Math.max(match.roundNumber, lastRound);
}

/**
 * Décide ce que défaire, ou dit pourquoi on ne défait rien.
 *
 * @param matches Tous les matchs du tournoi.
 * @param format Format du tournoi.
 * @returns Le plan d'écriture, ou un motif de refus.
 */
export function planRoundRollback(
  matches: readonly RollbackMatch[],
  format: TournamentFormat,
): RollbackPlan | RollbackRefusal {
  if (!isRollbackSupported(format)) return "ROLLBACK_UNSUPPORTED_FORMAT";

  const played = matches.filter(hasScoreInput);
  if (played.length === 0) return "ROLLBACK_NOTHING_TO_UNDO";

  // Repère de la petite finale. Calculé sur les manches ordinaires : le prendre
  // sur l'ensemble le ferait dépendre de lui-même.
  const ordinary = matches.filter((match) => match.bracket !== "THIRD_PLACE");
  const lastRound = ordinary.reduce((max, match) => Math.max(max, match.roundNumber), 0);

  const stageOf = (match: RollbackMatch) => matchStage(match, lastRound);
  const target = played.reduce((max, match) => Math.max(max, stageOf(match)), 0);

  // L'arbre est tiré : les manches qualificatives ne se défont plus. Le tester
  // sur les numéros de manche plutôt que sur `endurance_playoffs_started` garde
  // la règle lisible côté interface, qui ne reçoit que le plateau — et les deux
  // disent la même chose, le drapeau étant posé en même temps que le premier
  // tour de l'arbre.
  if (
    format === "BG_SURVIE" &&
    !isEndurancePlayoffRound(target) &&
    matches.some((match) => isEndurancePlayoffRound(match.roundNumber))
  ) {
    return "ROLLBACK_PLAYOFFS_STARTED";
  }

  return {
    roundNumber: target,
    clearedMatchIds: matches.filter((match) => stageOf(match) === target).map((match) => match.id),
    laterMatchIds: matches.filter((match) => stageOf(match) > target).map((match) => match.id),
    disposal: format === "SINGLE" ? "DETACH" : "DELETE",
  };
}

/**
 * Libellé de la manche défaite, pour le dialogue de confirmation et le journal.
 *
 * Les tours de l'arbre final de la BlueGenji Survie sont numérotés à partir de
 * {@link PLAYOFF_ROUND_OFFSET} : les afficher tels quels annoncerait « manche
 * 1002 » sur un tournoi qui en a joué neuf.
 *
 * @param roundNumber Numéro de manche tel qu'il est stocké.
 */
export function rollbackRoundLabel(roundNumber: number): string {
  if (isEndurancePlayoffRound(roundNumber)) {
    return `tour ${roundNumber - PLAYOFF_ROUND_OFFSET + 1} des play-offs`;
  }
  return `manche ${roundNumber}`;
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
 *
 * @param roundNumber Numéro de manche tel qu'il est stocké.
 */
export function rollbackRoundLabelWithArticle(roundNumber: number): string {
  const article = isEndurancePlayoffRound(roundNumber) ? "le" : "la";
  return `${article} ${rollbackRoundLabel(roundNumber)}`;
}
