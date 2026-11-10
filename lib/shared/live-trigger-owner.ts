/**
 * À qui appartient le mode de passage à l'antenne d'un match
 * (`bg_matches.live_trigger`, `docs/features/CAST_SETTINGS.md` § Qui règle le
 * mode d'antenne).
 *
 * Le mode d'un match est commun à tous ses streams : un co-caster ou un autre
 * porteur de `live` qui le changerait déciderait pour le caster qui l'a posé.
 * Une fois posé, seuls le **caster qui l'a posé** (`live_trigger_user_id`),
 * l'**arbitre désigné** du match (médiateur) et le staff `tournaments` + `live`
 * (`castOverseer`) le changent ou le retirent. Un mode posé par le staff — ou dont le caster qui l'avait posé
 * s'est retiré — n'a pas de propriétaire : ce staff et l'arbitre le changent,
 * et un caster montré du match aussi (sauf quand le match porte le lien de
 * l'organisation, `organisationModeLocked`), qui en devient alors le maître
 * (décision du 2026-11-05). Seul un caster du match devient propriétaire du
 * mode qu'il pose : posé par qui ne le caste pas (staff, arbitre), le
 * mode reste sans maître. Un porteur de la seule `live` ne règle que **son**
 * cast : sans caster le match, il n'en pose ni n'en change le mode. Un caster
 * tu (devenu inéligible avant le lancement) ou parti ne tient plus le mode,
 * qui reste alors sans maître. Ouvrir ou couper l'antenne d'un mode manuel
 * suit la même règle.
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
 *   parti) : les casters montrés du match — jamais un porteur de la seule
 *   `live` qui ne le caste pas, ni la seule permission `tournaments` hors
 *   arbitrage (les routes exigent `live` ou l'arbitrage, `assertLiveActor`).
 */
export function mayChangeLiveTrigger(hold: LiveTriggerHold, actor: LiveTriggerActor, actorCasts = false): boolean {
  if (actor.oversees || isMatchRefereeActor(hold, actor)) return true;
  if (hold.ownerId !== null) return hold.ownerId === actor.userId;
  return actorCasts;
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
 * Le mode d'antenne est-il fermé à cet acteur parce que le match porte le
 * **vrai** lien de l'organisation — celui que le staff a posé dans « Diffusion
 * officielle », case « lien de l'organisation » cochée (décision du 2026-11-10) ?
 * Alors seuls le staff `tournaments` + `live` (`oversees`), l'arbitre désigné
 * et le maître du mode le changent, en ouvrent ou coupent l'antenne ; un caster ne le
 * prend pas (`STAFF_STREAM_FORBIDDEN`). Ne ferment **pas** le mode : la chaîne
 * qu'un membre du staff a posée comme la sienne (case décochée), le lien
 * d'un stream de caster, même ancien et sans auteur connu, ni un match encore
 * sans mode (le premier mode posé par un caster est le sien).
 *
 * `organisationLink` : le serveur le lit sous le verrou du match
 * (`hasOrganisationLink`), l'interface sur l'instantané
 * (`BracketMatch.officialBroadcastLink`) — la même règle des deux côtés.
 */
export function organisationModeLocked(hold: LiveTriggerHold, actor: LiveTriggerActor, organisationLink: boolean): boolean {
  if (!organisationLink || hold.trigger === null) return false;
  // Le staff `tournaments` + `live` et l'arbitre désigné, comme le disent les textes.
  if (actor.oversees || isMatchRefereeActor(hold, actor)) return false;
  return hold.ownerId !== actor.userId;
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
    /** `BracketMatch.officialBroadcastLink` : le match porte le lien de « Diffusion officielle ». */
    officialBroadcastLink?: boolean;
  },
  viewer: LiveTriggerViewer,
  /** Le lecteur caste-t-il le match ? Par défaut : nommé parmi ses casters ; vrai à l'inscription. */
  viewerCasts?: boolean,
): boolean {
  if (viewer.userId === null) return false;
  const userId = viewer.userId;
  const hold: LiveTriggerHold = {
    trigger: match.liveTrigger,
    ownerId: match.liveTriggerCasterId ?? null,
    refereeId: viewer.referees ? viewer.userId : null,
  };
  const actor: LiveTriggerActor = { userId, oversees: viewer.oversees, manages: viewer.manages };
  // La règle du serveur (`STAFF_STREAM_FORBIDDEN`, décision du 2026-11-10).
  if (organisationModeLocked(hold, actor, match.officialBroadcastLink ?? false)) return false;
  return mayChangeLiveTrigger(hold, actor, viewerCasts ?? match.casters.some((caster) => caster.userId === userId));
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

/**
 * Le propriétaire à écrire quand `actor` pose `next` (`null` quand le match
 * n'est plus casté) :
 * - un maître montré (`shownOwner`) le garde, quel que soit l'auteur —
 *   l'arbitre ou le staff `tournaments` + `live` médie pour lui, même s'il caste aussi le match, il ne
 *   le lui retire pas ;
 * - sans maître montré, un caster montré qui pose le mode en devient le
 *   maître ; posé par qui ne le caste pas, le mode reste sans maître — un
 *   maître tu (parti, inéligible avant le lancement) perd ainsi le mode qu'un
 *   autre change pendant qu'il est tu.
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
