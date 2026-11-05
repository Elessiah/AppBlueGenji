/**
 * À qui appartient le mode de passage à l'antenne d'un match
 * (`bg_matches.live_trigger`, `docs/features/CAST_SETTINGS.md` § Qui règle le
 * mode d'antenne).
 *
 * Le mode d'un match est commun à tous ses streams : un co-caster ou un autre
 * porteur de `live` qui le changerait déciderait pour le caster qui l'a posé.
 * Une fois posé, seuls le **caster qui l'a posé** (`live_trigger_user_id`),
 * l'**arbitre désigné** du match (médiateur) et un **admin** le changent ou le
 * retirent. Un mode posé par le staff — ou dont le caster qui l'avait posé
 * s'est retiré — n'a pas de propriétaire : il reste au staff `tournaments`.
 * Seul un caster du match devient propriétaire du mode qu'il pose : posé par
 * qui ne le caste pas (staff, admin, arbitre, porteur de la seule `live`), le
 * mode reste au staff.
 *
 * Module pur : la même règle sert le serveur (sous le verrou du match) et
 * l'interface (contrôles cachés), jamais deux définitions.
 */
import type { MatchLiveTrigger } from "./live-streams";

/** Qui demande le changement. */
export type LiveTriggerActor = {
  userId: number;
  /** Admin de la plateforme : la règle admin s'applique ici (décision du 2026-11-05). */
  isAdmin: boolean;
  /** Permission `tournaments` (staff de l'organisation). */
  manages: boolean;
};

/** L'état du match qui décide. */
export type LiveTriggerHold = {
  trigger: MatchLiveTrigger | null;
  /** Le caster qui a posé le mode, `null` sans propriétaire. */
  ownerId: number | null;
  /** L'arbitre désigné **retenu** du match (`null` sans arbitre). */
  refereeId: number | null;
};

/** L'acteur est-il l'arbitre désigné de ce match ? Exige la permission `tournaments`, condition de l'arbitrage. */
export function isMatchRefereeActor(hold: Pick<LiveTriggerHold, "refereeId">, actor: LiveTriggerActor): boolean {
  return actor.manages && hold.refereeId !== null && hold.refereeId === actor.userId;
}

/**
 * L'acteur peut-il changer (ou retirer) le mode d'antenne ?
 *
 * - match pas encore casté (`trigger` nul) : le premier à le poser le peut ;
 * - admin ou arbitre désigné : toujours ;
 * - mode d'un caster : lui seul ;
 * - mode sans propriétaire (posé par le staff, ou caster parti) : le staff `tournaments`.
 */
export function mayChangeLiveTrigger(hold: LiveTriggerHold, actor: LiveTriggerActor): boolean {
  if (hold.trigger === null) return true;
  if (actor.isAdmin || isMatchRefereeActor(hold, actor)) return true;
  if (hold.ownerId !== null) return hold.ownerId === actor.userId;
  return actor.manages;
}

/** Ce que l'interface sait du lecteur pour la même règle. */
export type LiveTriggerViewer = {
  userId: number | null;
  isAdmin: boolean;
  manages: boolean;
  /** Le lecteur est l'arbitre désigné montré du match (`viewerRefereesMatch`). */
  referees: boolean;
};

/**
 * Propriétaire que l'instantané tait (`liveTriggerOwnerHidden` : caster retiré
 * mais pas encore rendu) : un identifiant qu'aucun compte ne porte, pour que
 * l'interface garde le mode verrouillé comme le serveur.
 */
const HIDDEN_OWNER = -1;

/**
 * Le lecteur peut-il changer le mode d'antenne de ce match ? La règle du
 * serveur (`mayChangeLiveTrigger`), lue sur l'instantané : le propriétaire y
 * est `liveTriggerCasterId` (ou tu, `liveTriggerOwnerHidden`). Faux sans compte.
 */
export function viewerMayChangeLiveTrigger(
  match: { liveTrigger: MatchLiveTrigger | null; liveTriggerCasterId?: number | null; liveTriggerOwnerHidden?: boolean },
  viewer: LiveTriggerViewer,
): boolean {
  if (viewer.userId === null) return false;
  return mayChangeLiveTrigger(
    {
      trigger: match.liveTrigger,
      ownerId: match.liveTriggerCasterId ?? (match.liveTriggerOwnerHidden === true ? HIDDEN_OWNER : null),
      refereeId: viewer.referees ? viewer.userId : null,
    },
    { userId: viewer.userId, isAdmin: viewer.isAdmin, manages: viewer.manages },
  );
}

/**
 * Le propriétaire à écrire quand `actor` pose `next` : lui s'il caste le
 * match ; `null` quand le match n'est plus casté ou que le mode est posé par
 * qui ne le caste pas — il reste alors au staff. L'instantané ne nomme que le
 * caster montré (`liveTriggerCasterId`) : un propriétaire qui ne caste pas
 * serait invisible à l'interface, qui offrirait un réglage refusé.
 */
export function liveTriggerOwnerAfter(
  next: MatchLiveTrigger | null,
  actor: LiveTriggerActor,
  actorCasts: boolean,
): number | null {
  if (next === null || !actorCasts) return null;
  return actor.userId;
}

/** Un identifiant de compte lu en base (`BIGINT` nul ou non). */
export function nullableUserId(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}
