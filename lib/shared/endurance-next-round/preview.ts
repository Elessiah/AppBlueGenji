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
 * Le calcul se répartit par étape : déroulés possibles de la manche
 * (`outcomes.ts`), places bornées (`position-bounds.ts`), rencontres acquises
 * (`pairings.ts`), tour suivant d'un arbre en cours (`playoff-preview.ts`).
 * Les types vivent dans `types.ts`.
 *
 * Module pur : aucune dépendance base de données ni interface.
 */

import { PLAYOFF_ROUND_OFFSET } from "../bg-survie/rounds";
import { firstPlayoffMatches, qualificationMatches } from "./pairings";
import { nextPlayoffPreview } from "./playoff-preview";
import { analysePositions } from "./position-bounds";
import { qualificationUnits } from "./outcomes";
import type { EnduranceNextRoundInput, EnduranceNextRoundPreview } from "./types";

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
