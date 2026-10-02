/**
 * BlueGenji Survie — fin de la phase qualificative : effectif cible, plafond
 * de manches, élimination mathématique et sélection des qualifiées
 * (`docs/features/BG_SURVIE_MODE.md`).
 *
 * Module pur : aucune dépendance base de données.
 */

import { matchWinsRequired, type MatchFormat } from "../match-format";
import type { EnduranceConfig } from "./config";
import { assignRanks, rankActiveTeams, type EnduranceStanding } from "./standings";

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
