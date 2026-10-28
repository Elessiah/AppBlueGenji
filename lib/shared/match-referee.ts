/**
 * Arbitre désigné d'un match, autogestion et réglages de la partie
 * (`docs/features/MATCH_REFEREE.md`) — règles pures, lues par le serveur et
 * par la carte du match.
 *
 * - Un **arbitre** se désigne lui-même (« Je prends ce match ») ou est désigné
 *   par le staff (permission `tournaments`). Il lui faut la permission
 *   `tournaments`, un tag Discord certifié **et** un compte Battle.net
 *   rattaché : en Overwatch, les équipes l'ajoutent en jeu (hors Overwatch, on
 *   ne s'invite pas par BattleTag, décision 35). Il peut aussi caster le match ;
 *   il ne peut pas le jouer.
 * - L'**autogestion** s'allume à la main, par le staff : désigner un arbitre
 *   l'éteint, l'allumer retire l'arbitre. Sans l'un ni l'autre, le match reste
 *   « sans décision » : rien ne bascule d'office (le staff est seulement averti
 *   au lancement).
 * - **Hôte** : celui que le staff a choisi, sinon — en BlueGenji Survie, phase
 *   finale — la meilleure tête de série, sinon l'équipe 1. Il prend le côté
 *   gauche ; l'autre équipe bannit la première.
 */
import type { CasterIdentity } from "./match-launch";
import { visibleText } from "./visible-text";

/** Ce qui empêche un compte d'arbitrer un match. */
export type RefereeBlock = "NOT_REFEREE" | "REFEREE_IDENTITY_REQUIRED";

/**
 * Motif qui empêche d'arbitrer, `null` si rien ne l'empêche.
 * `hasTournamentsPermission` est la permission `tournaments`.
 */
export function refereeBlockReason(
  hasTournamentsPermission: boolean,
  identity: CasterIdentity,
): RefereeBlock | null {
  if (!hasTournamentsPermission) return "NOT_REFEREE";
  if (!identity.discordVerified || !identity.blizzardLinked) return "REFEREE_IDENTITY_REQUIRED";
  return null;
}

/** Décision d'organisation d'un match : un arbitre, l'autogestion, ou rien encore. */
export type RefereeDecision = "REFEREE" | "SELF_MANAGED" | "UNDECIDED";

export function refereeDecision(match: { refereeAssigned: boolean; selfManaged: boolean }): RefereeDecision {
  if (match.refereeAssigned) return "REFEREE";
  if (match.selfManaged) return "SELF_MANAGED";
  return "UNDECIDED";
}

/** Longueur maximale de la première carte (`bg_matches.first_map`). */
export const FIRST_MAP_MAX_LENGTH = 64;

/**
 * Première carte saisie par le staff : forme affichable (`visibleText`), vide = aucune.
 * `null` en entrée comme en sortie veut dire « retirer ».
 *
 * @throws `INVALID_FIRST_MAP` si la valeur n'est pas un texte ou dépasse la longueur.
 */
export function normalizeFirstMap(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new Error("INVALID_FIRST_MAP");
  const value = visibleText(raw);
  if (value === "") return null;
  if ([...value].length > FIRST_MAP_MAX_LENGTH) throw new Error("INVALID_FIRST_MAP");
  return value;
}

/**
 * Équipe hôte du match : celle que le staff a désignée (si elle joue encore
 * le match), sinon la meilleure tête de série quand le format en donne
 * (`seedOf`, rang 1 = meilleure — BlueGenji Survie, phase finale), sinon
 * l'équipe 1. `seeds` : rang de chaque engagée (`null` hors de ce cas).
 */
export function matchHostTeamId(
  storedHostTeamId: number | null,
  team1Id: number | null,
  team2Id: number | null,
  seeds?: { team1: number | null; team2: number | null },
): number | null {
  if (storedHostTeamId !== null && (storedHostTeamId === team1Id || storedHostTeamId === team2Id)) {
    return storedHostTeamId;
  }
  if (seeds && team2Id !== null && seeds.team1 !== null && seeds.team2 !== null && seeds.team2 < seeds.team1) {
    return team2Id;
  }
  return team1Id;
}

/** L'équipe qui bannit la première : celle qui n'héberge pas. `null` tant qu'un adversaire manque. */
export function firstBanTeamId(
  hostTeamId: number | null,
  team1Id: number | null,
  team2Id: number | null,
): number | null {
  if (hostTeamId === null || team1Id === null || team2Id === null) return null;
  return hostTeamId === team1Id ? team2Id : team1Id;
}

/** Un match entré en lancement sans arbitre ni autogestion, avant son alerte. */
export type NoRefereeCandidate = {
  matchId: number;
  /** Appariement lancé (`launchPairingKey`). */
  pairing: string;
  /** Le match a une heure (`start_at`) : il se joue à son heure, pas avec sa manche. */
  scheduled: boolean;
  phaseId: number;
  bracket: string;
  roundNumber: number;
};

/** Une manche sans horaire dont des matchs entrent en lancement sans décision. */
export type NoRefereeRound = { phaseId: number; bracket: string; roundNumber: number; matchIds: number[] };

/**
 * Regroupe les alertes « sans arbitre ni autogestion » (décision de
 * l'utilisateur, 2026-10-27) : un match **planifié** garde son alerte à lui
 * (les matchs ne se jouent pas tous le même jour) ; les matchs **sans
 * horaire** d'une même manche (phase, tableau, numéro) partagent une seule
 * alerte qui les liste. Matchs triés par identifiant, manches dans l'ordre de
 * leur premier match.
 */
export function groupNoRefereeAlerts(candidates: readonly NoRefereeCandidate[]): {
  perMatch: NoRefereeCandidate[];
  perRound: NoRefereeRound[];
} {
  const sorted = [...candidates].sort((a, b) => a.matchId - b.matchId);
  const perMatch = sorted.filter((candidate) => candidate.scheduled);
  const rounds = new Map<string, NoRefereeRound>();
  for (const candidate of sorted) {
    if (candidate.scheduled) continue;
    const key = `${candidate.phaseId}:${candidate.bracket}:${candidate.roundNumber}`;
    const round = rounds.get(key);
    if (round) round.matchIds.push(candidate.matchId);
    else {
      rounds.set(key, {
        phaseId: candidate.phaseId,
        bracket: candidate.bracket,
        roundNumber: candidate.roundNumber,
        matchIds: [candidate.matchId],
      });
    }
  }
  return { perMatch, perRound: [...rounds.values()] };
}
