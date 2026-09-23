/**
 * **Double forfait** : les deux engagées d'une rencontre déclarent forfait.
 *
 * Le forfait ordinaire désigne une équipe, et son adversaire l'emporte au score
 * plein du format. Quand **personne** ne se présente, il n'y a plus de
 * bénéficiaire à désigner : la rencontre se clôt sans vainqueur, sans perdant
 * nommé et sans score (`bg_matches.double_forfeit`), et **chacune des deux
 * engagées la perd**. Une seule règle, déclinée par chaque moteur :
 *
 * - **Élimination simple / double, arbre final d'une BlueGenji Survie** : les
 *   deux sortent. Personne ne monte — le créneau qu'aurait pris la gagnante
 *   reste vide, et le match suivant devient une **exemption** pour
 *   l'adversaire qui l'attend (`tryAutoResolveByes`) ; deux doubles forfaits
 *   voisins donnent un match fantôme, et l'exemption se reporte un tour plus
 *   loin. En double élimination, personne ne tombe non plus au tableau de
 *   repêchage : il n'y a qu'un créneau de perdant pour deux perdantes, et en
 *   désigner une serait arbitraire.
 * - **Ronde suisse, Survie** : une défaite pour chacune, 0 point, rien d'autre —
 *   exactement ce qu'y vaut un forfait ordinaire pour l'équipe qui le déclare.
 *   Le barrage de la Survie élimine donc les deux.
 * - **BlueGenji Survie (qualification)** : chacune perd le score plein du
 *   format (FT3 → −3), comme la perdante d'un forfait ordinaire.
 *
 * **Hors du classement du site et des fiches** : aucune rencontre n'a eu lieu.
 * La cote Elo transfère des points d'une perdante à une gagnante, et il n'y a
 * pas de gagnante — l'assiette (`playedMatchSql`) l'écarte d'elle-même, la ligne
 * ne portant ni vainqueur ni score. Les conséquences sportives, elles, restent
 * entières : élimination, défaite au classement du tournoi, rang final.
 *
 * Ce module porte la seule partie de la règle qui se calcule hors d'un moteur :
 * les **rangs finaux** d'un tableau dont la finale ou la petite finale n'a pas
 * été jouée — podium à place vacante et ex æquo —, partagés par l'élimination,
 * l'arbre final d'une BlueGenji Survie et le multi-phases. Voir
 * `docs/features/DOUBLE_FORFEIT.md`.
 */

/** Ce qu'une rencontre de podium doit dire d'elle-même. */
export type PodiumMatch = {
  team1Id: number | null;
  team2Id: number | null;
  winnerTeamId: number | null;
  loserTeamId: number | null;
  doubleForfeit: boolean;
};

/** Un rang final, ex æquo compris (deux entrées au même `rank`). */
export type RankedEntry = { teamId: number; rank: number };

/**
 * Les rangs que désignent une finale et, s'il y en a une, une petite finale.
 *
 * Une rencontre de podium met **deux places** en jeu. Jouée, elle les attribue
 * dans l'ordre (vainqueur puis perdant). Close sur un double forfait, elle
 * n'en attribue que la **seconde**, aux deux engagées ex æquo : la première
 * place reste vacante — une finale sans vainqueur ne fait pas de championne —,
 * mais aucune des deux n'est rétrogradée derrière des équipes éliminées plus
 * tôt. Elles ont atteint la finale ; elles ne l'ont pas gagnée.
 *
 * Les places sont numérotées à la suite : une finale close sur un double
 * forfait donne `2, 2`, et la suivante — vainqueur de la petite finale, ou
 * première des éliminées — prend la 3ᵉ. Le calcul des points de parcours
 * (`lib/shared/tournament-placement.ts`) ne lit que l'ordre et traite deux rangs
 * égaux comme un ex æquo : les deux finalistes s'y partagent les deux premières
 * places, ce qui est exactement ce qu'elles ont atteint.
 *
 * Une rencontre gagnée **par exemption** — la finale d'un tableau dont l'autre
 * demi-finale a été close en double forfait — consomme elle aussi ses deux
 * places : la seconde reste vacante, faute de finaliste battue, et la
 * gagnante de la petite finale reste 3ᵉ. La faire remonter à la 2ᵉ place
 * récompenserait une défaite en demi-finale d'un rang qu'aucun match ne lui a
 * donné.
 *
 * @returns les rangs attribués, et la prochaine place libre.
 */
export function podiumRanks(matches: (PodiumMatch | null | undefined)[]): {
  entries: RankedEntry[];
  nextRank: number;
} {
  const entries: RankedEntry[] = [];
  let next = 1;

  for (const match of matches) {
    if (!match) continue;

    if (match.doubleForfeit) {
      const teams = [match.team1Id, match.team2Id].filter((id): id is number => id !== null);
      if (teams.length === 0) continue;
      // Les deux places sont consommées, la première restant vacante.
      const rank = next + 1;
      for (const teamId of teams) entries.push({ teamId, rank });
      next += 2;
      continue;
    }

    if (match.winnerTeamId === null && match.loserTeamId === null) continue;
    if (match.winnerTeamId !== null) entries.push({ teamId: match.winnerTeamId, rank: next });
    if (match.loserTeamId !== null) entries.push({ teamId: match.loserTeamId, rank: next + 1 });
    next += 2;
  }

  return { entries, nextRank: next };
}

/**
 * Numérote une liste ordonnée d'équipes à la suite d'un podium, à partir de
 * sa première place libre. Une équipe déjà placée au podium est ignorée.
 */
export function appendSequentialRanks(
  podium: { entries: RankedEntry[]; nextRank: number },
  rest: number[],
): RankedEntry[] {
  const placed = new Set(podium.entries.map((entry) => entry.teamId));
  const entries = [...podium.entries];
  let rank = podium.nextRank;
  for (const teamId of rest) {
    if (placed.has(teamId)) continue;
    placed.add(teamId);
    entries.push({ teamId, rank });
    rank += 1;
  }
  return entries;
}

/**
 * Rangs finaux d'un tournoi multi-phases, à partir de l'ordre déjà trié.
 *
 * Numérotés à la suite, à une exception : deux équipes à égalité de phase
 * atteinte **et** de rang dans la phase restent ex æquo, et la phase la plus
 * avancée garde ses rangs tels quels. Une finale close sur un double forfait
 * range ses deux finalistes 2ᵉˢ ex æquo et ne fait pas de championne
 * ({@link podiumRanks}) : recompter à partir de 1 aurait sacré l'une des deux
 * au seul hasard du tri.
 */
export function multiTournamentRanks(
  order: { phaseReached: number; phaseRank: number }[],
): number[] {
  const ranks: number[] = [];
  const topPhase = order[0]?.phaseReached;

  for (let i = 0; i < order.length; i += 1) {
    const current = order[i];
    const previous = order[i - 1];
    if (
      previous &&
      previous.phaseReached === current.phaseReached &&
      previous.phaseRank === current.phaseRank
    ) {
      ranks.push(ranks[i - 1]);
    } else if (
      current.phaseReached === topPhase &&
      current.phaseRank >= i + 1 &&
      current.phaseRank <= order.length
    ) {
      ranks.push(current.phaseRank);
    } else {
      ranks.push(Math.max(i + 1, (ranks[i - 1] ?? 0) + 1));
    }
  }

  return ranks;
}
