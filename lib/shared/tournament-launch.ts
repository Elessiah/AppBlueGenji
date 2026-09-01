/**
 * Abréger les étapes pré-`RUNNING` d'un tournoi pour le lancer sur-le-champ —
 * logique pure, partagée.
 *
 * Un tournoi traverse quatre étapes avant de commencer — masqué, annoncé,
 * inscriptions, clôture (`tournament-progress.ts`) — et rien ne permettait de
 * les écourter. L'édition (`tournament-edit.ts`) n'y suffit pas, et pas par
 * omission : reculer `registrationCloseAt` dans le passé y est explicitement
 * refusé, et avancer `startAt` seul ne change rien — `computeTournamentState`
 * teste les inscriptions **avant** le coup d'envoi, si bien qu'un tournoi dont
 * la clôture est encore à venir reste « Inscriptions » quelle que soit sa date
 * de début. Abréger n'est donc pas une modification de plus : c'est le
 * déplacement **cohérent** des quatre jalons, qu'un formulaire champ par champ
 * ne peut pas produire.
 *
 * Le principe tient en une phrase : **on ne fait jamais avancer une date, on ne
 * fait que la reculer**. Chaque jalon est ramené au plus tôt entre sa valeur et
 * l'instant du lancement, dans l'ordre inverse du calendrier. Trois propriétés
 * en découlent seules, sans un cas particulier écrit à la main :
 *
 * - l'ordre chronologique exigé par `validateDateOrder` est préservé, donc
 *   aussi l'invariant « un tournoi caché est toujours `UPCOMING` » dont
 *   `docs/features/TOURNAMENT_VISIBILITY_ACCESS.md` dispense les routes
 *   d'écriture — abréger depuis l'étape « masqué » **publie** le tournoi au
 *   passage, il ne devient jamais « en cours et invisible » ;
 * - un tournoi déjà dans l'entre-deux (inscriptions closes, début à venir) ne
 *   voit pas ses inscriptions rouvertes rétroactivement ;
 * - n'importe laquelle des quatre étapes peut donc être le point de départ, et
 *   toutes celles qui restaient sont franchies d'un coup.
 *
 * L'état n'est jamais écrit à la main : ce sont les dates qui font foi partout
 * ailleurs (`tournament-state.ts`), et un état posé de force serait défait à la
 * première synchronisation. C'est aussi ce qui fait que le lancement anticipé
 * n'a **aucun** chemin à lui côté moteur : une fois les dates abrégées,
 * `syncTournamentState` lance le tournoi comme il l'aurait fait à l'heure dite.
 *
 * Module pur : l'interface s'en sert pour n'afficher le bouton que lorsqu'il
 * mène quelque part et pour nommer ce qui va être sauté, le serveur pour
 * rejouer la règle sous verrou.
 */
import { computeTournamentState, type TournamentStateInput } from "./tournament-state";
import {
  computeTournamentProgress,
  TOURNAMENT_STAGE_ORDER,
  type TournamentStageKey,
} from "./tournament-progress";
import type { TournamentState } from "./types";

/**
 * Recul appliqué aux jalons abrégés, en millisecondes.
 *
 * Les poser *exactement* à `now` ne lancerait rien : `computeTournamentState`
 * rend `REGISTRATION` tant que `now <= registrationCloseAt`, bornes comprises.
 * Une seconde suffit à sortir de l'égalité, et c'est aussi la résolution d'une
 * colonne `DATETIME` — MySQL tronque à la seconde, donc un recul plus court
 * pourrait se retrouver stocké à l'identique.
 */
export const LAUNCH_BACKDATE_MS = 1000;

/** Vue minimale d'un tournoi, satisfaite par `TournamentCard` comme par une ligne SQL. */
export type LaunchableTournament = {
  state: TournamentState;
  startVisibilityAt: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  startAt: string;
};

/**
 * Ce qui empêche d'abréger.
 *
 * Les codes sont ceux que le serveur renvoie tels quels : une seule
 * formulation, du module pur jusqu'au toast.
 */
export type LaunchBlockReason =
  | "INVALID_DATES"
  | "TOURNAMENT_ALREADY_STARTED"
  | "TOURNAMENT_ALREADY_FINISHED";

/** Les quatre jalons, une fois abrégés. Dates ISO, comme partout côté client. */
export type ShortenedSchedule = {
  startVisibilityAt: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  startAt: string;
};

function timeOf(value: string): number {
  return new Date(value).getTime();
}

/**
 * Premier obstacle au lancement anticipé, ou `null` s'il n'y en a pas.
 *
 * Le seul vrai refus est **« il n'y a plus rien à abréger »** : les quatre
 * étapes d'avant-course sont toutes des points de départ valides, y compris
 * « masqué » — abréger publie alors le tournoi au passage (voir l'en-tête du
 * module). L'état consulté est le *calculé*, pas le stocké : un tournoi dont
 * l'heure de début est passée n'a rien à abréger même si la colonne `state`
 * n'a pas encore été recalée, et il partira à la prochaine synchronisation.
 *
 * Ce qui n'est **pas** un refus, alors qu'on pourrait s'y attendre : partir
 * d'une étape où personne n'a pu s'engager (l'inscription exige l'état
 * `REGISTRATION`, pour un joueur comme pour une équipe invitée). Le lancement
 * clôt alors le tournoi sur-le-champ, faute d'adversaires
 * (`docs/features/UNDERFILLED_TOURNAMENTS.md`) : c'est une conséquence à
 * annoncer avant le clic — `willCloseWithoutMatches` — et non un droit à
 * retirer. Refuser reviendrait à décider à la place de l'organisateur qu'un
 * tournoi mort-né doit rester ouvert jusqu'à son heure.
 */
export function launchBlockReason(
  tournament: LaunchableTournament,
  now: number = Date.now(),
): LaunchBlockReason | null {
  const milestones = [
    tournament.startVisibilityAt,
    tournament.registrationOpenAt,
    tournament.registrationCloseAt,
    tournament.startAt,
  ].map(timeOf);

  // Une date illisible interdit d'abréger plutôt que d'être ignorée : tout ce
  // qui suit repose sur des comparaisons, et `NaN` les rend toutes fausses — le
  // tournoi passerait alors chaque contrôle sans qu'aucun n'ait rien vérifié.
  if (milestones.some((time) => !Number.isFinite(time))) return "INVALID_DATES";

  const state = computeTournamentState(tournament as TournamentStateInput, now);
  if (state === "FINISHED") return "TOURNAMENT_ALREADY_FINISHED";
  if (state === "RUNNING") return "TOURNAMENT_ALREADY_STARTED";

  return null;
}

/**
 * Étapes d'avant-course que le lancement va franchir d'un coup, de celle où le
 * tournoi se trouve jusqu'à la dernière avant « En cours ».
 *
 * L'étape courante en fait partie : elle est **abrégée**, pas sautée — mais du
 * point de vue de qui confirme, la distinction ne change rien, ce sont les
 * étapes qui n'auront pas lieu comme prévu. Vide dès qu'il n'y a plus rien à
 * abréger, c'est-à-dire exactement quand `launchBlockReason` refuse.
 *
 * L'étape est celle de `computeTournamentProgress`, et non l'état du moteur :
 * c'est la seule des deux à distinguer « masqué » d'« annoncé » et l'avant de
 * l'après-inscriptions — les quatre nuances dont il est justement question ici.
 */
export function abridgedStagesForLaunch(
  tournament: LaunchableTournament,
  now: number = Date.now(),
): TournamentStageKey[] {
  const runningIndex = TOURNAMENT_STAGE_ORDER.indexOf("RUNNING");
  const { currentIndex } = computeTournamentProgress(tournament, { now });
  if (currentIndex >= runningIndex) return [];
  return TOURNAMENT_STAGE_ORDER.slice(currentIndex, runningIndex);
}

/** Raccourci de lecture : le tournoi peut-il être abrégé maintenant ? */
export function canLaunchNow(tournament: LaunchableTournament, now: number = Date.now()): boolean {
  return launchBlockReason(tournament, now) === null;
}

/**
 * Les quatre jalons ramenés au plus tôt, de façon qu'à l'instant `now` le
 * tournoi soit `RUNNING`.
 *
 * Le calcul remonte le calendrier à l'envers — début, clôture, ouverture,
 * visibilité — chaque jalon étant borné par le suivant déjà résolu. C'est ce
 * chaînage, et non une suite de cas particuliers, qui garantit
 * `visibilité <= ouverture <= clôture <= début` quelle que soit la position de
 * départ du tournoi. En pratique, seuls les jalons réellement à venir bougent :
 * abréger un tournoi dont les inscriptions sont déjà closes ne touche que sa
 * date de début.
 *
 * Ne contrôle rien : appeler `launchBlockReason` d'abord.
 */
export function shortenScheduleForLaunch(
  tournament: LaunchableTournament,
  now: number = Date.now(),
): ShortenedSchedule {
  const target = now - LAUNCH_BACKDATE_MS;

  const startAt = Math.min(timeOf(tournament.startAt), target);
  const registrationCloseAt = Math.min(timeOf(tournament.registrationCloseAt), startAt);
  const registrationOpenAt = Math.min(timeOf(tournament.registrationOpenAt), registrationCloseAt);
  const startVisibilityAt = Math.min(timeOf(tournament.startVisibilityAt), registrationOpenAt);

  return {
    startVisibilityAt: new Date(startVisibilityAt).toISOString(),
    registrationOpenAt: new Date(registrationOpenAt).toISOString(),
    registrationCloseAt: new Date(registrationCloseAt).toISOString(),
    startAt: new Date(startAt).toISOString(),
  };
}

/**
 * Effectif en deçà duquel le lancement ne produira aucun match : le tournoi est
 * clos sur-le-champ, l'unique engagée déclarée première
 * (`docs/features/UNDERFILLED_TOURNAMENTS.md`).
 *
 * Ce n'est pas un refus — c'est exactement ce qui se produirait à l'heure
 * annoncée, et un organisateur peut vouloir en finir tout de suite avec un
 * plateau désert. Mais « Lancer » ne doit pas être ce qui le lui apprend : la
 * confirmation le dit avant le clic.
 */
export const MIN_ENTRANTS_FOR_MATCHES = 2;

/** Le lancement clôturera-t-il le tournoi sans qu'un seul match soit joué ? */
export function willCloseWithoutMatches(entrantCount: number): boolean {
  return entrantCount < MIN_ENTRANTS_FOR_MATCHES;
}
