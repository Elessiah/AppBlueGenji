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
 * s'est retiré — n'a pas de propriétaire : le staff `tournaments` le change,
 * et un caster montré du match aussi, qui en devient alors le maître
 * (décision du 2026-11-05). Seul un caster du match devient propriétaire du
 * mode qu'il pose : posé par qui ne le caste pas (staff, admin, arbitre), le
 * mode reste au staff. Un porteur de la seule `live` ne règle que **son**
 * cast : sans caster le match, il n'en pose ni n'en change le mode. Un caster
 * tu (devenu inéligible avant le lancement) ou parti ne tient plus le mode,
 * que le serveur et l'interface rendent au staff. Ouvrir ou couper l'antenne
 * d'un mode manuel suit la même règle.
 *
 * Module pur : la même règle sert le serveur (sous le verrou du match) et
 * l'interface (contrôles cachés), jamais deux définitions.
 */
import type { MatchLiveTrigger } from "./live-streams";

/**
 * Le lecteur (ou l'acteur) règle-t-il **tout** cast du match ? Le staff qui
 * porte à la fois `tournaments` et `live` — jamais un `isAdmin` codé en dur
 * (décision du 2026-11-09).
 */
export function castOverseer(manages: boolean, live: boolean): boolean {
  return manages && live;
}

/** Qui demande le changement. */
export type LiveTriggerActor = {
  userId: number;
  /**
   * Staff `tournaments` **et** `live` : règle tout cast du match, sans exception
   * codée sur l'admin (décision du 2026-11-09, `castOverseer`).
   */
  oversees: boolean;
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
 * L'acteur peut-il changer (ou retirer) le mode d'antenne ? `actorCasts` :
 * l'acteur caste le match en caster montré.
 *
 * - staff `tournaments` + `live` (`oversees`) ou arbitre désigné : toujours ;
 * - mode d'un caster : lui seul ;
 * - pas encore de mode, ou mode sans propriétaire (posé par le staff, caster
 *   parti) : le staff `tournaments` et les casters montrés du match — jamais
 *   un porteur de la seule `live` qui ne le caste pas.
 */
export function mayChangeLiveTrigger(hold: LiveTriggerHold, actor: LiveTriggerActor, actorCasts = false): boolean {
  if (actor.oversees || isMatchRefereeActor(hold, actor)) return true;
  if (hold.ownerId !== null) return hold.ownerId === actor.userId;
  return actor.manages || actorCasts;
}

/**
 * L'acteur peut-il **démarquer** le match (retirer son mode) ? Son maître,
 * l'arbitre désigné ou le staff (`tournaments` + `live`, `oversees`) ; un mode
 * sans maître (posé par le staff, ou dont le maître n'est plus montré) ne se
 * retire pas par la seule `live` (décision du 2026-11-09).
 */
export function mayUnmarkLiveTrigger(hold: LiveTriggerHold, actor: LiveTriggerActor): boolean {
  if (actor.oversees || isMatchRefereeActor(hold, actor)) return true;
  return hold.ownerId !== null && hold.ownerId === actor.userId;
}

/**
 * L'acteur peut-il ouvrir ou couper l'antenne d'un mode `MANUAL` ? La règle
 * du mode (`mayChangeLiveTrigger`) : sur un mode **sans maître**, tout
 * caster montré du match la bascule — le match ne reste pas hors antenne en
 * attendant le staff. Le mode d'un autre caster, lui, ne se bascule pas
 * (décision 2).
 */
export function mayToggleOnAir(hold: LiveTriggerHold, actor: LiveTriggerActor, actorCasts: boolean): boolean {
  return mayChangeLiveTrigger(hold, actor, actorCasts);
}

/** Ce que l'interface sait du lecteur pour la même règle (`liveTriggerViewer`). */
export type LiveTriggerViewer = {
  userId: number | null;
  oversees: boolean;
  manages: boolean;
  /** Le lecteur est l'arbitre désigné montré du match (`viewerRefereesMatch`). */
  referees: boolean;
};

/**
 * Le lecteur tel que la règle le lit, bâti d'un seul endroit pour les trois
 * fenêtres (inscription, réglages du caster, diffusion du staff) : un champ
 * ajouté ici l'est pour toutes. `referees` : `viewerRefereesMatch`.
 */
export function liveTriggerViewer(
  controls: { viewerUserId: number | null; canManage: boolean; canSchedule: boolean },
  referees: boolean,
): LiveTriggerViewer {
  return {
    userId: controls.viewerUserId,
    oversees: castOverseer(controls.canSchedule, controls.canManage),
    manages: controls.canSchedule,
    referees,
  };
}

/**
 * Le lecteur peut-il changer le mode d'antenne de ce match (ou ouvrir et
 * couper son antenne) ? La règle du serveur (`mayChangeLiveTrigger`), lue sur
 * l'instantané : le propriétaire y est `liveTriggerCasterId`, nommé tant qu'il
 * y est montré — le serveur ne tient pas non plus pour maître un caster tu ou
 * parti (`loadShownCasterIds`). Faux sans compte.
 */
export function viewerMayChangeLiveTrigger(
  match: {
    liveTrigger: MatchLiveTrigger | null;
    liveTriggerCasterId?: number | null;
    casters: readonly { userId: number }[];
    streams?: readonly { liveUrl: string | null; staff: boolean }[];
  },
  viewer: LiveTriggerViewer,
  /** Le lecteur caste-t-il le match ? Par défaut : nommé parmi ses casters ; vrai à l'inscription. */
  viewerCasts?: boolean,
): boolean {
  if (viewer.userId === null) return false;
  const userId = viewer.userId;
  // Le mode du staff qui porte le lien de l'organisation n'est pas à la seule
  // `live` (`STAFF_STREAM_FORBIDDEN` au serveur, décision 1 du 2026-11-09).
  if (staffModeLockedFor(match, viewer, userId)) return false;
  return mayChangeLiveTrigger(
    {
      trigger: match.liveTrigger,
      ownerId: match.liveTriggerCasterId ?? null,
      refereeId: viewer.referees ? viewer.userId : null,
    },
    { userId, oversees: viewer.oversees, manages: viewer.manages },
    viewerCasts ?? match.casters.some((caster) => caster.userId === userId),
  );
}

/**
 * Le lecteur peut-il démarquer ce match ? La règle du serveur
 * (`mayUnmarkLiveTrigger`) sur l'instantané ; vrai sur un match sans mode.
 */
export function viewerMayUnmarkLiveTrigger(
  match: { liveTrigger: MatchLiveTrigger | null; liveTriggerCasterId?: number | null },
  viewer: LiveTriggerViewer,
): boolean {
  if (match.liveTrigger === null) return true;
  if (viewer.userId === null) return false;
  return mayUnmarkLiveTrigger(
    { trigger: match.liveTrigger, ownerId: match.liveTriggerCasterId ?? null, refereeId: viewer.referees ? viewer.userId : null },
    { userId: viewer.userId, oversees: viewer.oversees, manages: viewer.manages },
  );
}

/** Le stream de l'organisation porte un lien que ce lecteur (ni staff, ni arbitre, ni maître) ne touche pas. */
function staffModeLockedFor(
  match: { liveTriggerCasterId?: number | null; streams?: readonly { liveUrl: string | null; staff: boolean }[] },
  viewer: LiveTriggerViewer,
  userId: number,
): boolean {
  if (viewer.manages || viewer.referees || (match.liveTriggerCasterId ?? null) === userId) return false;
  return (match.streams ?? []).some((stream) => stream.staff && stream.liveUrl !== null);
}

/**
 * Le lecteur peut-il ouvrir ou couper l'antenne de ce match ? La règle du mode
 * (`viewerMayChangeLiveTrigger`), comme au serveur. Faux sans compte.
 */
export const viewerMayToggleOnAir = viewerMayChangeLiveTrigger;

/**
 * Le propriétaire à écrire quand `actor` pose `next` (`null` quand le match
 * n'est plus casté) :
 * - un maître montré (`shownOwner`) le garde, quel que soit l'auteur —
 *   l'arbitre ou l'admin médie pour lui, même s'il caste aussi le match, il ne
 *   le lui retire pas ;
 * - sans maître montré, un caster montré qui pose le mode en devient le
 *   maître ; posé par qui ne le caste pas, le mode reste au staff — un maître
 *   tu (parti, inéligible) perd ainsi le mode que le staff change pendant
 *   qu'il est tu : ce changement est celui du staff.
 *
 * L'instantané ne nomme que le caster montré (`liveTriggerCasterId`) : un
 * propriétaire qui ne caste pas serait invisible à l'interface, qui offrirait
 * un réglage refusé.
 */
export function liveTriggerOwnerAfter(
  next: MatchLiveTrigger | null,
  actor: LiveTriggerActor,
  actorCasts: boolean,
  shownOwner: number | null = null,
): number | null {
  if (next === null) return null;
  if (shownOwner !== null) return shownOwner;
  return actorCasts ? actor.userId : null;
}
