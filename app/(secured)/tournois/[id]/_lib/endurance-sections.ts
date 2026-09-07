import type { BracketMatch } from "@/lib/shared/types";

/**
 * Découpe du plateau « BlueGenji Survie » en volets, et reconstitution de
 * l'arbre de play-offs.
 *
 * Le mode empilait toutes ses manches dans une seule colonne : sur un plafond de
 * dix manches à seize équipes, la page défilait sur quatre-vingts cartes sans
 * qu'aucun repère ne dise où commence la manche courante. Les play-offs, eux,
 * étaient rendus comme les manches qualificatives — une liste de cartes — alors
 * qu'ils sont un vrai arbre à élimination directe : rien ne montrait qui
 * affrontait qui au tour suivant.
 *
 * Module **pur** : il ne décide que du découpage et des liens de l'arbre, jamais
 * du rendu. C'est aussi ce qui le rend testable sans DOM.
 */

/**
 * Première manche de play-offs. Le moteur numérote l'arbre final à partir de
 * 1000 (cf. `lib/server/tournaments/bg-survie.ts`) : sous ce seuil, on est en
 * phase qualificative.
 */
export const PLAYOFF_ROUND_OFFSET = 1000;

/** Un volet = une manche qualificative. */
export interface EnduranceRoundSection {
  /** Numéro de manche (1..n), tel que porté par les matchs. */
  round: number;
  /** Clé stable pour piloter l'état ouvert/fermé. */
  key: string;
  title: string;
  /** Matchs de la manche, ordonnés comme le moteur les a posés. */
  matches: BracketMatch[];
  /** Rencontres tranchées (vainqueur désigné) sur le total de la manche. */
  playedCount: number;
  totalCount: number;
  /** Toutes les rencontres de la manche sont tranchées. */
  isComplete: boolean;
}

/**
 * Sépare les manches qualificatives de l'arbre final. Les deux vivent dans la
 * même table et ne se distinguent que par leur numéro de manche.
 */
export function splitEnduranceMatches(matches: BracketMatch[]): {
  qualification: BracketMatch[];
  playoffs: BracketMatch[];
} {
  const qualification: BracketMatch[] = [];
  const playoffs: BracketMatch[] = [];
  for (const match of matches) {
    if (match.roundNumber >= PLAYOFF_ROUND_OFFSET) playoffs.push(match);
    else qualification.push(match);
  }
  return { qualification, playoffs };
}

/**
 * Un volet par manche qualificative, dans l'ordre chronologique — celui du
 * tableau « manche par manche » juste au-dessus, et celui des arbres à
 * élimination. Lire une histoire à l'envers ne se justifierait que si la page ne
 * montrait qu'une manche à la fois ; ici le volet courant est ouvert d'office.
 */
export function enduranceRoundSections(qualification: BracketMatch[]): EnduranceRoundSection[] {
  const rounds = [...new Set(qualification.map((match) => match.roundNumber))].sort((a, b) => a - b);

  return rounds.map((round) => {
    const matches = qualification
      .filter((match) => match.roundNumber === round)
      .sort((a, b) => a.matchNumber - b.matchNumber);
    const playedCount = matches.filter((match) => match.winnerTeamId !== null).length;
    return {
      round,
      key: `manche-${round}`,
      title: `Manche ${round}`,
      matches,
      playedCount,
      totalCount: matches.length,
      isComplete: matches.length > 0 && playedCount === matches.length,
    };
  });
}

/**
 * Manche à ouvrir à l'arrivée sur la page.
 *
 * Par ordre de priorité : celle où le lecteur a une rencontre à jouer, puis la
 * première manche inachevée — la manche courante, celle qui bouge. Une fois tout
 * joué, on n'ouvre la dernière manche que si l'arbre final n'a pas commencé :
 * sinon c'est lui qui porte l'action, et déplier par-dessus une manche
 * qualificative close le repousserait sous la ligne de flottaison.
 *
 * `null` = tout replié.
 */
export function defaultOpenEnduranceRound(
  sections: EnduranceRoundSection[],
  myTeamId: number | null,
  playoffsStarted: boolean,
): number | null {
  if (sections.length === 0) return null;

  if (myTeamId !== null) {
    const mine = sections.find((section) =>
      section.matches.some(
        (match) =>
          match.winnerTeamId === null &&
          (match.team1Id === myTeamId || match.team2Id === myTeamId),
      ),
    );
    if (mine) return mine.round;
  }

  const pending = sections.find((section) => !section.isComplete);
  if (pending) return pending.round;

  return playoffsStarted ? null : sections[sections.length - 1].round;
}

/** Manche du volet contenant ce match, ou `null` s'il n'y est pas. */
export function enduranceRoundOfMatch(
  sections: EnduranceRoundSection[],
  matchId: number,
): number | null {
  const section = sections.find((s) => s.matches.some((match) => match.id === matchId));
  return section ? section.round : null;
}

/**
 * L'arbre final, séparé de la petite finale.
 *
 * Les deux vivent dans la même manche (le moteur pose la petite finale à côté de
 * la finale, cf. `finalizePlayoffsIfDone`) mais ne se dessinent pas ensemble :
 * la petite finale ne mène nulle part, et l'aligner dans la dernière colonne de
 * l'arbre la ferait nommer « Finale 2 ». Les tableaux à élimination du site les
 * séparent déjà de la même façon, par `bracket`.
 */
export function splitPlayoffBrackets(playoffs: BracketMatch[]): {
  decisive: BracketMatch[];
  thirdPlace: BracketMatch[];
} {
  return {
    decisive: playoffs.filter((match) => match.bracket !== "THIRD_PLACE"),
    thirdPlace: playoffs.filter((match) => match.bracket === "THIRD_PLACE"),
  };
}

/**
 * Liens « vainqueur → match suivant » de l'arbre final, **dérivés**.
 *
 * Le moteur ne pose pas de `next_winner_match_id` sur les play-offs : il crée le
 * tour suivant une fois le précédent complet, en appariant les vainqueurs deux à
 * deux dans l'ordre des numéros de match (cf. `finalizePlayoffsIfDone`). La
 * règle est donc connue, et c'est elle qu'on rejoue ici pour dessiner les
 * traits de l'arbre — le vainqueur du i-ème match d'un tour joue le (i/2)-ème
 * match du tour suivant.
 *
 * Ce lien ne sert **qu'au dessin** : le verrouillage d'un score en BlueGenji
 * Survie se décide sur le numéro de manche (cf. `lib/shared/match-lock.ts`), pas
 * sur les liens de bracket, et rien de ce qui est calculé ici ne remonte jamais
 * au serveur. Un tour non encore créé n'a pas de cible : le trait s'arrête, ce
 * qui est exactement ce qu'il faut montrer.
 */
export function endurancePlayoffLinks(decisive: BracketMatch[]): Map<number, number> {
  const links = new Map<number, number>();
  const rounds = [...new Set(decisive.map((match) => match.roundNumber))].sort((a, b) => a - b);

  const byRound = new Map(
    rounds.map((round) => [
      round,
      decisive
        .filter((match) => match.roundNumber === round)
        .sort((a, b) => a.matchNumber - b.matchNumber),
    ]),
  );

  for (let index = 0; index < rounds.length - 1; index += 1) {
    const current = byRound.get(rounds[index])!;
    const next = byRound.get(rounds[index + 1])!;
    current.forEach((match, position) => {
      const target = next[Math.floor(position / 2)];
      if (target) links.set(match.id, target.id);
    });
  }

  return links;
}
