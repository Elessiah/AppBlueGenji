/**
 * Classement des équipes du site : **notation de force**, pas cumul de points.
 *
 * Il sert au leaderboard de la landing, à l'annuaire `/equipes`, à la fiche
 * d'équipe **et** au seeding des tournois à classement (Survie, Suisse, Multi,
 * aperçu du plateau).
 *
 * ## Ce que le barème additif ne pouvait pas dire
 *
 * Le barème précédent — 100 par victoire, −20 par défaite — comptait des
 * rencontres sans jamais regarder **qui** était en face : battre la meilleure
 * équipe du site et battre une équipe qui n'a jamais gagné rapportaient
 * exactement la même chose, et l'équipe la mieux classée était simplement celle
 * qui avait le plus joué.
 *
 * Le classement est désormais une **cote de type Elo** : chacune part de
 * {@link RANKING_BASE_POINTS}, et chaque match **transfère** des points du
 * perdant au vainqueur — beaucoup quand le résultat était improbable, presque
 * rien quand il était attendu. Une équipe à 500 qui bat une équipe à 900 prend
 * l'essentiel de l'écart ; l'inverse ne déplace presque rien.
 *
 * ## Ce que le transfert de match ne pouvait pas dire non plus
 *
 * Une cote de type Elo ne connaît que des rencontres, et chacune ne paie qu'à
 * hauteur de sa surprise : une équipe forte qui gagne un tournoi en battant plus
 * faible qu'elle n'y gagne presque rien, quand une équipe faible sortie au
 * deuxième tour sur une seule victoire improbable en encaisse trois fois plus.
 * Le classement disait alors qu'aller au bout coûte moins qu'être éliminé tôt.
 *
 * Chaque tournoi terminé redistribue donc en plus une **cagnotte** entre ses
 * engagées, selon leur **rang final** et la difficulté du plateau
 * (`lib/shared/tournament-placement.ts`). C'est un évènement du rejeu comme un
 * autre, à sa date, et de somme nulle : voir
 * `docs/features/TOURNAMENT_PLACEMENT_POINTS.md`.
 *
 * ## Trois propriétés que le module tient
 *
 * 1. **Symétrie.** Ce que le vainqueur gagne, le perdant le perd, au point
 *    près : le transfert est calculé **une fois** ({@link ratingTransfer}) puis
 *    appliqué avec les deux signes — jamais deux arrondis indépendants. Seul le
 *    plancher y déroge, et c'est la seule entorse.
 * 2. **Ordre chronologique.** Une cote dépend de l'ordre des rencontres, ce que
 *    la somme d'avant ignorait. Rien n'est stocké pour autant : le classement se
 *    **rejoue** depuis `bg_matches` ({@link replayRanking}), comme
 *    `replaySurvival` / `replaySwiss` rejouent leurs tournois — il est donc une
 *    **fonction pure** des matchs comptés, de leurs vainqueurs et de leurs
 *    dates, jamais un total accumulé. La date retenue étant celle de la dernière
 *    écriture du match, corriger un vieux score le **redate** et le rejoue en
 *    dernier : voir `docs/features/ELO_RANKING.md`.
 * 3. **Assiette partagée.** Les matchs qui comptent sont exactement ceux du
 *    bilan des fiches ({@link playedMatchSql}) — byes et matchs fantômes
 *    écartés. Un barème partagé posé sur deux assiettes différentes rend encore
 *    deux nombres différents.
 *
 * Les fragments SQL n'interpolent que les expressions fournies par le code
 * appelant — jamais une entrée utilisateur.
 *
 * Voir `docs/features/ELO_RANKING.md`.
 */

import { MIN_PLACEMENT_ENTRANTS, placementDeltas } from "./tournament-placement";

/**
 * Cote de départ, commune à tout le monde. Une équipe qui n'a jamais joué vaut
 * ce nombre : ni un zéro qui la ferait passer pour mauvaise, ni un rang gagné
 * sans rien disputer — {@link compareRankedTeams} la range à sa cote, derrière
 * les équipes qui ont des victoires à cote égale.
 */
export const RANKING_BASE_POINTS = 500;

/**
 * Plancher du classement.
 *
 * La cote se stabilise d'elle-même (une équipe très basse ne perd presque plus
 * rien en s'inclinant face à une équipe moyenne), mais rien n'empêche une longue
 * série de défaites de la faire passer sous zéro — un nombre négatif à côté d'un
 * nom d'équipe est un affichage qu'on n'a aucune raison de servir, et un gouffre
 * qu'une équipe qui reprend ne comblerait jamais.
 *
 * Un cinquième de la base : assez bas pour que la hiérarchie réelle s'exprime,
 * assez haut pour rester lisible.
 */
export const RANKING_FLOOR_POINTS = 100;

/**
 * Amplitude maximale d'un match — le nombre de points que change une victoire
 * totalement improbable.
 *
 * **Constant, et non décroissant avec l'expérience.** Un K par équipe (les
 * nouvelles plus volatiles) casserait la symétrie : une vétérane battue par une
 * débutante perdrait moins que la débutante ne gagne, et le total du site
 * dériverait à chaque rencontre déséquilibrée. Entre « les nouvelles trouvent
 * leur niveau plus vite » et « ce que l'un gagne, l'autre le perd », c'est la
 * seconde propriété qu'on garde : c'est elle qui rend le classement lisible.
 *
 * 32 est la valeur usuelle : il faut une dizaine de victoires surprises pour
 * gagner un rang de niveau, et une seule ne renverse jamais la table.
 */
export const RANKING_K_FACTOR = 32;

/**
 * Écart de cote correspondant à une probabilité de victoire de 10 contre 1.
 *
 * C'est l'échelle du classement : 400 points d'écart valent 91 % de chances pour
 * la favorite. Avec une base à 500, l'exemple canonique (500 contre 900) tombe
 * donc exactement sur ce rapport — la surprise rapporte dix fois ce que rapporte
 * le résultat attendu.
 */
export const RANKING_SCALE = 400;

/**
 * Probabilité qu'une cote l'emporte sur une autre, entre 0 et 1. Deux cotes
 * égales donnent 0,5 ; `RANKING_SCALE` points d'avance donnent ~0,91.
 */
export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / RANKING_SCALE));
}

/**
 * Points transférés du perdant au vainqueur pour une rencontre — toujours
 * positif, arrondi à l'entier.
 *
 * **Un seul calcul pour les deux équipes** : c'est ce qui garantit la symétrie.
 * Arrondir séparément le gain du vainqueur et la perte du perdant produirait
 * deux nombres différents dès que la valeur exacte tombe sur une demie, et le
 * total du site dériverait match après match.
 */
export function ratingTransfer(
  winnerRating: number,
  loserRating: number,
  score?: MatchMargin,
): number {
  const multiplier = marginMultiplier(score, winnerRating - loserRating);
  return Math.round(RANKING_K_FACTOR * (1 - expectedScore(winnerRating, loserRating)) * multiplier);
}

/** Score d'un match gagné, en maps : celles du vainqueur, celles du perdant. */
export type MatchMargin = { winnerMaps: number; loserMaps: number };

/**
 * Majoration maximale d'un transfert pour une victoire **sans concéder de map**
 * (3-0, 2-0) : ×1,5. La victoire la plus serrée possible (3-2, 2-1) reste à ×1.
 *
 * Une demi-fois de plus, pas le double : l'écart de score dit quelque chose du
 * niveau, mais une seule rencontre ne doit pas valoir deux matchs.
 */
export const RANKING_MARGIN_MAX_BONUS = 0.5;

/**
 * Amortisseur de l'autocorrélation (méthode de FiveThirtyEight) : la favorite
 * balaie plus souvent ses adversaires **parce qu'elle** est favorite, et
 * majorer chacun de ses balayages gonflerait sa cote match après match. Le bonus
 * est multiplié par `2,2 / (2,2 + écart × 0,001)` quand c'est la mieux cotée qui
 * gagne — ×0,85 à 400 points d'avance. Un outsider qui balaie garde son bonus
 * entier : il n'est jamais majoré au-delà de {@link RANKING_MARGIN_MAX_BONUS}.
 */
const AUTOCORRELATION_BASE = 2.2;
const AUTOCORRELATION_SLOPE = 0.001;

/**
 * Multiplicateur du transfert selon le **score du match** — entre 1 et
 * 1 + {@link RANKING_MARGIN_MAX_BONUS}.
 *
 * L'écart se rapporte au format, par le nombre de maps du vainqueur (`w`) :
 * `marge = (w − perdant − 1) / (w − 1)`, qui vaut 0 sur la victoire la plus
 * serrée possible et 1 sur un balayage, quel que soit le FT/BO. En FT3 : 3-2 →
 * ×1, 3-1 → ×1,25, 3-0 → ×1,5 ; en FT2 : 2-1 → ×1, 2-0 → ×1,5.
 *
 * Vaut **1** — le transfert d'avant — chaque fois que le score ne dit rien :
 * pas de score (forfait, match ancien), FT1 (une seule map, aucun écart
 * possible), score incohérent (le vainqueur n'a pas plus de maps que le
 * perdant).
 *
 * `ratingGap` = cote du vainqueur − cote du perdant, pour l'amortisseur.
 */
export function marginMultiplier(score: MatchMargin | undefined, ratingGap = 0): number {
  if (!score) return 1;
  const { winnerMaps, loserMaps } = score;
  if (!Number.isInteger(winnerMaps) || !Number.isInteger(loserMaps)) return 1;
  if (winnerMaps <= 1 || loserMaps < 0 || loserMaps >= winnerMaps) return 1;
  const margin = (winnerMaps - loserMaps - 1) / (winnerMaps - 1);
  const damping =
    AUTOCORRELATION_BASE / (AUTOCORRELATION_BASE + Math.max(0, ratingGap) * AUTOCORRELATION_SLOPE);
  return 1 + RANKING_MARGIN_MAX_BONUS * margin * damping;
}

/**
 * Points transférés du **premier** camp au second sur un match nul — négatif
 * quand c'est le premier qui en gagne.
 *
 * Un nul n'est pas un non-évènement : il dit que les deux équipes se valent, ce
 * que les cotes annonçaient peut-être autrement. La favorite en perd donc, et
 * son adversaire en gagne autant — d'autant plus que l'écart était grand. Deux
 * cotes égales ne déplacent rien.
 *
 * Toujours plus doux qu'une victoire, et par construction : l'écart à
 * l'espérance vaut au plus ½ sur un nul, contre 1 sur une surprise totale. Une
 * équipe à 500 qui tient tête à une équipe à 900 lui prend 13 points, là où la
 * battre lui en aurait pris 29.
 *
 * **Un seul calcul pour les deux camps**, comme {@link ratingTransfer} : c'est
 * ce qui garantit la symétrie.
 */
export function ratingDrawTransfer(firstRating: number, secondRating: number): number {
  return Math.round(RANKING_K_FACTOR * (expectedScore(firstRating, secondRating) - 0.5));
}

/**
 * Un match tel que le rejeu le consomme. Deux équipes réelles et la date qui le
 * situe dans l'histoire du site.
 */
export type RankedMatch = {
  matchId: number;
  /** Gagnante — ou, sur un match nul, simplement le camp du side 1. */
  winnerTeamId: number;
  /** Perdante — ou, sur un match nul, le camp du side 2. */
  loserTeamId: number;
  /**
   * Match clos **sans vainqueur** : une map nulle a arrêté la rencontre avant
   * l'objectif, sur un format qui l'autorise (`lib/shared/match-format.ts`).
   * Les deux champs ci-dessus ne nomment alors que les deux camps, dans l'ordre
   * des sides — d'où le drapeau plutôt qu'un `null` qui les effacerait tous les
   * deux, et le rejeu n'aurait plus personne à créditer.
   */
  drawn?: boolean;
  /**
   * Score du match en maps, quand il en dit quelque chose : majore le transfert
   * d'une victoire nette ({@link marginMultiplier}). Absent sur un forfait ou un
   * match ancien sans score — transfert inchangé. Ignoré sur un nul.
   */
  score?: MatchMargin;
  /** Date ISO du résultat. Une date illisible range le match en tête. */
  playedAt: string;
};

/**
 * Le classement final d'un tournoi terminé, tel que le rejeu le consomme.
 *
 * C'est un **évènement de plus** dans la même histoire que les matchs, à sa
 * date, et non un total posé à côté : les cotes qu'il redistribue sont celles
 * de l'instant de la clôture, donc celles que les rencontres du tournoi
 * viennent d'écrire.
 */
export type RankedPlacement = {
  tournamentId: number;
  /** Engagées **classées**, dans n'importe quel ordre. */
  entrants: { teamId: number; rank: number }[];
  /** Date ISO de la clôture. Une date illisible range le tournoi en tête. */
  awardedAt: string;
};

/** Cote et bilan d'une équipe à l'issue du rejeu. */
export type RankedTeamState = {
  points: number;
  wins: number;
  losses: number;
  /** Matchs clos sans vainqueur. */
  draws: number;
  /** Matchs comptés. Zéro = équipe non classée, encore à la cote de départ. */
  matchesPlayed: number;
  /**
   * Part de la cote qui vient des **classements finaux** et non des rencontres
   * — positive pour qui va loin, négative pour qui sort tôt.
   *
   * Elle n'est pas une seconde monnaie : elle est **déjà** dans `points`. On la
   * garde à part pour pouvoir dire à une équipe d'où vient sa cote, ce qu'un
   * total seul ne dit pas.
   */
  placementPoints: number;
};

/** L'état d'une équipe qui n'a encore rien joué. */
export function baseRankedTeamState(): RankedTeamState {
  return {
    points: RANKING_BASE_POINTS,
    wins: 0,
    losses: 0,
    draws: 0,
    matchesPlayed: 0,
    placementPoints: 0,
  };
}

function playedTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Ordre chronologique du rejeu : la date du résultat, puis l'identifiant du
 * match.
 *
 * Le second critère n'est pas décoratif — deux scores saisis dans la même
 * seconde doivent se rejouer dans un ordre **stable**, sinon deux calculs du
 * même classement rendraient deux nombres différents.
 */
export function compareRankedMatches(a: RankedMatch, b: RankedMatch): number {
  const delta = playedTimestamp(a.playedAt) - playedTimestamp(b.playedAt);
  if (delta !== 0) return delta;
  return a.matchId - b.matchId;
}

/**
 * Un pas du rejeu : une rencontre, ou le classement final d'un tournoi.
 *
 * Les deux se rangent dans la **même** chronologie, sans quoi la cagnotte d'un
 * tournoi se redistribuerait sur des cotes d'avant ses propres matchs.
 */
type RankedEvent =
  | { at: number; order: 0; id: number; match: RankedMatch }
  | { at: number; order: 1; id: number; placement: RankedPlacement };

/**
 * Ordre du rejeu tous évènements confondus : la date, puis les matchs **avant**
 * les classements finaux, puis l'identifiant.
 *
 * Le critère du milieu n'est pas décoratif : la clôture d'un tournoi est écrite
 * dans la même transaction que son dernier score, donc à la même seconde. Le
 * classement final doit se lire sur les cotes que ce match vient d'écrire, pas
 * l'inverse.
 */
function compareRankedEvents(a: RankedEvent, b: RankedEvent): number {
  // Entre deux rencontres, la règle est celle de {@link compareRankedMatches} et
  // pas une seconde copie : la réécrire ici la ferait diverger en silence le
  // jour où quelqu'un règle la chronologie là où le JSDoc et les tests disent
  // qu'elle vit.
  if (a.order === 0 && b.order === 0) return compareRankedMatches(a.match, b.match);
  if (a.at !== b.at) return a.at - b.at;
  if (a.order !== b.order) return a.order - b.order;
  return a.id - b.id;
}

/**
 * Redistribue la cagnotte d'un tournoi qui vient de se clore.
 *
 * Le calcul lui-même vit dans `lib/shared/tournament-placement.ts`, pur et
 * ignorant tout du classement du site : ici, on ne fait que lui donner les cotes
 * **du moment** et appliquer ce qu'il rend.
 *
 * Une équipe qui n'a encore aucun état en prend un : elle a bien participé, et
 * sa cagnotte se lit sur la cote de départ, comme sa première rencontre se
 * lirait dessus. Elle reste pour autant **non classée** tant qu'elle n'a pas
 * disputé de match compté ({@link isRankedTeam}) — un classement final ne
 * remplace pas un bilan.
 */
function applyPlacement(
  placement: RankedPlacement,
  stateOf: (teamId: number) => RankedTeamState,
): void {
  if (placement.entrants.length < MIN_PLACEMENT_ENTRANTS) return;

  const deltas = placementDeltas(
    placement.entrants.map((entrant) => ({
      teamId: entrant.teamId,
      rank: entrant.rank,
      rating: stateOf(entrant.teamId).points,
    })),
    RANKING_BASE_POINTS,
  );

  for (const [teamId, delta] of deltas) {
    const state = stateOf(teamId);
    // Le plancher s'applique comme sur une défaite — et pour la même raison :
    // une cote négative n'est ni affichable ni rattrapable. C'est la seule
    // entorse à la somme nulle, la même que celle des transferts de match.
    const next = Math.max(RANKING_FLOOR_POINTS, state.points + delta);
    state.placementPoints += next - state.points;
    state.points = next;
  }
}

/**
 * **Le** calcul du classement : rejoue toutes les rencontres — et tous les
 * classements finaux de tournoi — dans l'ordre, et rend la cote de chaque
 * équipe concernée.
 *
 * L'ordre est imposé ici et non laissé au SQL appelant : la chronologie fait
 * partie de la règle, pas de la requête. Les tableaux reçus ne sont pas
 * modifiés.
 *
 * Les `placements` sont facultatifs : un appelant qui n'en fournit aucun obtient
 * exactement le classement d'avant les points de parcours — c'est ce qui rend le
 * transfert de match testable seul.
 *
 * Une équipe absente du résultat n'a joué aucun match compté ni figuré à aucun
 * classement final : sa cote est {@link RANKING_BASE_POINTS} — voir
 * {@link rankedPointsOf}.
 */
export function replayRanking(
  matches: RankedMatch[],
  placements: RankedPlacement[] = [],
): Map<number, RankedTeamState> {
  const states = new Map<number, RankedTeamState>();

  const stateOf = (teamId: number): RankedTeamState => {
    const existing = states.get(teamId);
    if (existing) return existing;
    const created = baseRankedTeamState();
    states.set(teamId, created);
    return created;
  };

  const events: RankedEvent[] = [
    ...matches.map<RankedEvent>((match) => ({
      at: playedTimestamp(match.playedAt),
      order: 0,
      id: match.matchId,
      match,
    })),
    ...placements.map<RankedEvent>((placement) => ({
      at: playedTimestamp(placement.awardedAt),
      order: 1,
      id: placement.tournamentId,
      placement,
    })),
  ].sort(compareRankedEvents);

  for (const event of events) {
    if (event.order === 1) {
      applyPlacement(event.placement, stateOf);
      continue;
    }

    const match = event.match;
    // Un match contre soi-même n'a pas de perdant : le rejouer transférerait
    // des points d'une équipe à elle-même, et le plancher les ferait
    // apparaître de nulle part.
    if (match.winnerTeamId === match.loserTeamId) continue;

    const winner = stateOf(match.winnerTeamId);
    const loser = stateOf(match.loserTeamId);

    if (match.drawn) {
      // Le transfert va du premier camp au second, et peut être négatif : c'est
      // la favorite qui paie un nul, quel que soit le side qu'elle occupait.
      const transfer = ratingDrawTransfer(winner.points, loser.points);

      winner.points = Math.max(RANKING_FLOOR_POINTS, winner.points - transfer);
      loser.points = Math.max(RANKING_FLOOR_POINTS, loser.points + transfer);

      winner.draws += 1;
      loser.draws += 1;
      winner.matchesPlayed += 1;
      loser.matchesPlayed += 1;
      continue;
    }

    const transfer = ratingTransfer(winner.points, loser.points, match.score);

    winner.points += transfer;
    loser.points = Math.max(RANKING_FLOOR_POINTS, loser.points - transfer);

    winner.wins += 1;
    winner.matchesPlayed += 1;
    loser.losses += 1;
    loser.matchesPlayed += 1;
  }

  return states;
}

/** Cote d'une équipe dans un rejeu, cote de départ comprise si elle n'y figure pas. */
export function rankedPointsOf(states: Map<number, RankedTeamState>, teamId: number): number {
  return states.get(teamId)?.points ?? RANKING_BASE_POINTS;
}

/**
 * Assiette du classement : les matchs qui comptent réellement. Terminés, entre
 * deux équipes réelles — byes (`is_bye`) et matchs fantômes (une équipe
 * manquante) écartés, leur score étant posé par le moteur de tournoi et non
 * joué.
 *
 * **Avec un vainqueur, ou nuls.** Un match nul se reconnaît à ce qu'il est clos
 * sans vainqueur *et* porte deux scores égaux — un match clos sans vainqueur ni
 * score n'est pas un nul, c'est une ligne abîmée, et elle reste dehors. Le
 * distinguer coûte une condition ; ne pas le faire ferait disparaître des
 * fiches une rencontre pourtant jouée.
 *
 * `match` est l'alias de `bg_matches` dans la requête appelante.
 */
export function playedMatchSql(match = "m"): string {
  return `${match}.status = 'COMPLETED'
       AND ${match}.is_bye = 0
       AND ${match}.team1_id IS NOT NULL
       AND ${match}.team2_id IS NOT NULL
       AND (
         ${match}.winner_team_id IS NOT NULL
         OR (
           ${match}.team1_score IS NOT NULL
           AND ${match}.team2_score IS NOT NULL
           AND ${match}.team1_score = ${match}.team2_score
         )
       )`;
}

/** L'assiette par défaut, pour les requêtes qui aliasent `bg_matches` en `m`. */
export const PLAYED_MATCH_SQL = playedMatchSql();

/**
 * Condition de jointure entre une équipe et ses matchs comptés au classement.
 * `teamExpr` désigne l'identifiant d'équipe (`t.id`, `r.team_id`, …).
 *
 * En `LEFT JOIN`, une équipe sans match donne une ligne entièrement `NULL`.
 */
export function rankingMatchJoinSql(teamExpr: string, match = "m"): string {
  return `(${match}.team1_id = ${teamExpr} OR ${match}.team2_id = ${teamExpr})
      AND ${playedMatchSql(match)}`;
}

/**
 * Une équipe est **classée** dès qu'elle a disputé un match compté.
 *
 * Ce drapeau ne décide **pas** de l'ordre ({@link compareRankedTeams} ne lit
 * que la cote et le bilan) : il choisit la légende de la cote (« Aucun match
 * joué ») et si la fiche affiche une place (`getTeamRankingPosition`).
 */
export function isRankedTeam(team: { wins: number; losses: number; draws?: number }): boolean {
  // Le nul compte : une équipe dont l'unique rencontre s'est close sur 2-2 a
  // bien joué, et sa cote a bougé. `draws` est facultatif — les vues qui n'en
  // portent pas (une ligne SQL antérieure) se lisent exactement comme avant.
  return team.wins + team.losses + (team.draws ?? 0) > 0;
}

/**
 * Ordre du classement du site, appliqué **en mémoire** pour que toutes les vues
 * trient à l'identique — leaderboard, page `/classement`, annuaire **et**
 * seeding : la **cote** d'abord, strictement, puis, à cote égale, les victoires
 * (plus d'abord), les défaites (moins d'abord), les nuls (plus de matchs joués
 * d'abord), et enfin le nom.
 *
 * La cote prime sur tout le reste, bilan vide compris. La règle d'avant rangeait
 * les équipes classées (au moins un match) devant toutes les autres : une seule
 * rencontre jouée sur le site suffisait alors à poser la perdante, à 483, en
 * **deuxième** place, devant toutes les équipes restées à 500 (retour du
 * 2026-10-05). Une équipe sans match vaut la cote de départ, ni plus ni moins :
 * elle passe derrière toute équipe qui a gagné des points, devant toute équipe
 * qui en a perdu — et, à 500 contre 500, derrière une équipe qui a des victoires.
 *
 * Le tri final se fait ici et non en SQL — la collation MySQL et
 * `localeCompare("fr")` ne départagent pas les noms de la même façon, et deux
 * vues triées chacune de son côté finiraient par afficher deux ordres.
 */
export function compareRankedTeams(
  a: { points: number; wins: number; losses: number; draws?: number; name: string },
  b: { points: number; wins: number; losses: number; draws?: number; name: string },
): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (a.losses !== b.losses) return a.losses - b.losses;
  const drawsA = a.draws ?? 0;
  const drawsB = b.draws ?? 0;
  if (drawsB !== drawsA) return drawsB - drawsA;
  return a.name.localeCompare(b.name, "fr");
}

/** Intitulé du total de points, partout où il s'affiche. */
export const RANKING_POINTS_LABEL = "Points de classement";

/**
 * Le barème en toutes lettres, dérivé des constantes plutôt que réécrit à la
 * main : un réglage du classement corrige de lui-même la légende qui l'annonce.
 */
export const RANKING_POINTS_HINT =
  `Base ${RANKING_BASE_POINTS} · plus la victoire est improbable, plus elle rapporte `
  + `· le rang final d'un tournoi en redistribue aussi (plancher ${RANKING_FLOOR_POINTS})`;

/** Intitulé de la part de cote qui vient des classements finaux de tournoi. */
export const RANKING_PLACEMENT_LABEL = "Points de parcours";

/**
 * Ce que dit la tuile des points de parcours — et surtout ce qu'elle ne dit
 * pas : ces points ne s'ajoutent pas à la cote, ils en font partie.
 */
export const RANKING_PLACEMENT_HINT = "compris dans la cote · rang final des tournois";

/** Ce qu'affiche une équipe qui n'a encore disputé aucun match compté. */
export const RANKING_UNRANKED_HINT = "Aucun match joué : cote de départ";

/**
 * La même nuance en deux mots, **affichée** sous le total d'une carte
 * d'annuaire d'équipe non classée : la légende complète n'y tient pas, et un
 * `title` y serait inatteignable (la plaque `.cardOverlay` recouvre la carte).
 * Sans elle, une équipe qui n'a jamais joué afficherait le même nombre qu'une
 * équipe qui l'a gagné, sans rien pour les distinguer.
 */
export const RANKING_UNRANKED_SHORT = "Aucun match";

/**
 * Le cas que les points de parcours ont ouvert : aucun match compté, et
 * pourtant une cote qui n'est plus celle du départ.
 *
 * Il est atteignable — une équipe qui abandonne tout un tournoi avant sa
 * première manche n'a rien joué mais reçoit un rang final à la clôture, donc sa
 * part de cagnotte. Lui servir « cote de départ » à côté de 486 ferait dire deux
 * choses à la même ligne.
 */
export const RANKING_PLACEMENT_ONLY_HINT =
  "Aucun match joué · cote issue de ses classements de tournoi";

/**
 * **La** règle qui choisit la légende du total de points, pour que les trois vues
 * qui l'affichent (annuaire, bandeau de tête, fiche) ne recopient pas chacune
 * son ternaire — la troisième formulation ci-dessus serait sinon oubliée dans
 * deux d'entre elles.
 *
 * `ranked` se lit sur le bilan des matchs ({@link isRankedTeam}) ou, pour la
 * fiche, sur la présence d'un rang : les deux disent la même chose.
 */
export function rankingPointsHint(ranked: boolean, points: number): string {
  if (ranked) return RANKING_POINTS_HINT;
  return points === RANKING_BASE_POINTS ? RANKING_UNRANKED_HINT : RANKING_PLACEMENT_ONLY_HINT;
}
