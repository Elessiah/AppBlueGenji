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
 * mode reste au staff. Un caster tu (devenu inéligible avant le lancement) ou
 * parti ne tient plus le mode, que le serveur et l'interface rendent au staff.
 * Ouvrir ou couper l'antenne d'un mode manuel suit la même règle.
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

/**
 * L'acteur peut-il ouvrir ou couper l'antenne d'un mode `MANUAL` ? Qui peut
 * changer le mode (`mayChangeLiveTrigger`) ; et, sur un mode **sans maître**
 * (caster parti, mode posé avant la règle), tout caster montré du match
 * (`actorCasts`) — personne d'autre n'y décide pour lui, et le match ne reste
 * pas hors antenne en attendant le staff. Le mode d'un autre caster, lui, ne
 * se bascule pas (décision 2).
 */
export function mayToggleOnAir(hold: LiveTriggerHold, actor: LiveTriggerActor, actorCasts: boolean): boolean {
  if (mayChangeLiveTrigger(hold, actor)) return true;
  return hold.ownerId === null && actorCasts;
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
 * Le lecteur peut-il changer le mode d'antenne de ce match (ou ouvrir et
 * couper son antenne) ? La règle du serveur (`mayChangeLiveTrigger`), lue sur
 * l'instantané : le propriétaire y est `liveTriggerCasterId`, nommé tant qu'il
 * y est montré — le serveur ne tient pas non plus pour maître un caster tu ou
 * parti (`loadShownCasterIds`). Faux sans compte.
 */
export function viewerMayChangeLiveTrigger(
  match: { liveTrigger: MatchLiveTrigger | null; liveTriggerCasterId?: number | null },
  viewer: LiveTriggerViewer,
): boolean {
  if (viewer.userId === null) return false;
  return mayChangeLiveTrigger(
    {
      trigger: match.liveTrigger,
      ownerId: match.liveTriggerCasterId ?? null,
      refereeId: viewer.referees ? viewer.userId : null,
    },
    { userId: viewer.userId, isAdmin: viewer.isAdmin, manages: viewer.manages },
  );
}

/**
 * Le lecteur peut-il ouvrir ou couper l'antenne de ce match ? `mayToggleOnAir`
 * lue sur l'instantané : un caster montré du match (`casters`) bascule un mode
 * sans maître. Faux sans compte.
 */
export function viewerMayToggleOnAir(
  match: {
    liveTrigger: MatchLiveTrigger | null;
    liveTriggerCasterId?: number | null;
    casters: readonly { userId: number }[];
  },
  viewer: LiveTriggerViewer,
): boolean {
  if (viewer.userId === null) return false;
  if (viewerMayChangeLiveTrigger(match, viewer)) return true;
  const userId = viewer.userId;
  return (match.liveTriggerCasterId ?? null) === null && match.casters.some((caster) => caster.userId === userId);
}

/**
 * Le propriétaire à écrire quand `actor` pose `next` : lui s'il caste le
 * match ; `null` quand le match n'est plus casté. Posé par qui ne le caste pas
 * (arbitre, admin, staff), le mode garde son maître actuel (`keptOwner`, un
 * caster montré) — l'arbitre médie pour lui, il ne le lui retire pas — ou
 * reste au staff s'il n'en avait pas. L'instantané ne nomme que le caster
 * montré (`liveTriggerCasterId`) : un propriétaire qui ne caste pas serait
 * invisible à l'interface, qui offrirait un réglage refusé.
 */
export function liveTriggerOwnerAfter(
  next: MatchLiveTrigger | null,
  actor: LiveTriggerActor,
  actorCasts: boolean,
  keptOwner: number | null = null,
): number | null {
  if (next === null) return null;
  return actorCasts ? actor.userId : keptOwner;
}
