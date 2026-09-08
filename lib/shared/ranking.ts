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

/**
 * Cote de départ, commune à tout le monde. Une équipe qui n'a jamais joué vaut
 * ce nombre : ni un zéro qui la ferait passer pour mauvaise, ni un rang gagné
 * sans rien disputer — {@link compareRankedTeams} la range après les classées.
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
export function ratingTransfer(winnerRating: number, loserRating: number): number {
  return Math.round(RANKING_K_FACTOR * (1 - expectedScore(winnerRating, loserRating)));
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
  /** Date ISO du résultat. Une date illisible range le match en tête. */
  playedAt: string;
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
};

/** L'état d'une équipe qui n'a encore rien joué. */
export function baseRankedTeamState(): RankedTeamState {
  return { points: RANKING_BASE_POINTS, wins: 0, losses: 0, draws: 0, matchesPlayed: 0 };
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
 * **Le** calcul du classement : rejoue toutes les rencontres dans l'ordre et
 * rend la cote de chaque équipe qui en a disputé une.
 *
 * L'ordre est imposé ici et non laissé au SQL appelant : la chronologie fait
 * partie de la règle, pas de la requête. Le tableau reçu n'est pas modifié.
 *
 * Une équipe absente du résultat n'a joué aucun match compté : sa cote est
 * {@link RANKING_BASE_POINTS} — voir {@link rankedPointsOf}.
 */
export function replayRanking(matches: RankedMatch[]): Map<number, RankedTeamState> {
  const states = new Map<number, RankedTeamState>();

  const stateOf = (teamId: number): RankedTeamState => {
    const existing = states.get(teamId);
    if (existing) return existing;
    const created = baseRankedTeamState();
    states.set(teamId, created);
    return created;
  };

  for (const match of [...matches].sort(compareRankedMatches)) {
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

    const transfer = ratingTransfer(winner.points, loser.points);

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
 * Avant cela, sa cote est celle de tout le monde : la laisser se mêler aux
 * classées la placerait au milieu du tableau sans avoir rien joué — et le
 * leaderboard de l'accueil, qui n'affiche que les huit premières, se serait
 * rempli d'équipes de remplissage devant des équipes qui jouent.
 */
export function isRankedTeam(team: { wins: number; losses: number; draws?: number }): boolean {
  // Le nul compte : une équipe dont l'unique rencontre s'est close sur 2-2 a
  // bien joué, et sa cote a bougé. `draws` est facultatif — les vues qui n'en
  // portent pas (une ligne SQL antérieure) se lisent exactement comme avant.
  return team.wins + team.losses + (team.draws ?? 0) > 0;
}

/**
 * Ordre du classement du site, appliqué **en mémoire** pour que toutes les vues
 * trient à l'identique : les classées d'abord, puis la cote, puis les
 * victoires, puis le nom.
 *
 * Le tri final se fait ici et non en SQL — la collation MySQL et
 * `localeCompare("fr")` ne départagent pas les noms de la même façon, et deux
 * vues triées chacune de son côté finiraient par afficher deux ordres.
 */
export function compareRankedTeams(
  a: { points: number; wins: number; losses: number; draws?: number; name: string },
  b: { points: number; wins: number; losses: number; draws?: number; name: string },
): number {
  const rankedA = isRankedTeam(a);
  const rankedB = isRankedTeam(b);
  if (rankedA !== rankedB) return rankedA ? -1 : 1;
  if (b.points !== a.points) return b.points - a.points;
  if (b.wins !== a.wins) return b.wins - a.wins;
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
  + `(plancher ${RANKING_FLOOR_POINTS})`;

/** Ce qu'affiche une équipe qui n'a encore disputé aucun match compté. */
export const RANKING_UNRANKED_HINT = "Aucun match joué : cote de départ";

/**
 * La règle de seeding, telle qu'on l'explique au visiteur sur les pages
 * `/regles` des modes qui seedent au classement (Survie, Ronde suisse,
 * Multi-phases).
 *
 * Elle vit **ici**, dérivée des constantes, et non recopiée dans le registre des
 * règles : les deux pages y annonçaient encore « victoire = 3 points, défaite =
 * 1 point » — l'ancien barème de la carte d'annuaire, celui où une défaite
 * rapportait des points, retiré du code par la PR #88 sans que le texte suive.
 * Deux phrases copiées dérivent ; une constante partagée, non.
 *
 * Sans marqueur Markdown : les pages de règles rendent le texte tel quel.
 */
export const RANKING_SEEDING_RULE =
  `Le seeding initial vient du classement du site : chaque équipe part de `
  + `${RANKING_BASE_POINTS} points, et chaque match en transfère du perdant au `
  + `vainqueur — d'autant plus que le résultat était improbable. `
  + `Seed 1 = meilleure équipe.`;
