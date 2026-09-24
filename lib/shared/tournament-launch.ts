/**
 * « Avancer le tournoi » : faire franchir à un tournoi l'étape suivante de son
 * avant-course, sur-le-champ — logique pure, partagée.
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
 * - n'importe laquelle des quatre étapes peut donc être le point de départ.
 *
 * Le geste avance **d'une étape** (`advanceTarget`) et non jusqu'au coup
 * d'envoi : masqué ou annoncé → inscriptions, inscriptions → clôture, clôture →
 * en cours. Il se répète, ce qui laisse au staff le temps d'ouvrir les
 * inscriptions d'un tournoi encore masqué, puis de relire le seeding une fois
 * les inscriptions closes, avant de lancer.
 *
 * L'état n'est jamais écrit à la main : ce sont les dates qui font foi partout
 * ailleurs (`tournament-state.ts`), et un état posé de force serait défait à la
 * première synchronisation. C'est aussi ce qui fait que le lancement anticipé
 * n'a **aucun** chemin à lui côté moteur : une fois les dates abrégées,
 * `syncTournamentState` lance le tournoi comme il l'aurait fait à l'heure dite.
 *
 * Module pur : l'interface s'en sert pour n'afficher le bouton que lorsqu'il
 * mène quelque part et pour nommer l'étape qui vient, le serveur pour rejouer
 * la règle sous verrou.
 */
import { MIN_ENTRANTS_FOR_MATCHES } from "./constants";
import { computeTournamentState, type TournamentStateInput } from "./tournament-state";
import { computeTournamentProgress, type TournamentStageKey } from "./tournament-progress";
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
 * module). Deux lectures de l'état y concourent, et il faut les deux : le
 * *stocké*, qui peut avoir été forcé à la main avant l'heure, et le *calculé*,
 * qui a pu dépasser le coup d'envoi sans que la colonne soit recalée.
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

  // L'état stocké fait plancher, exactement comme pour la frise
  // (`stageFloorFromState`) et pour la fenêtre d'édition : un tournoi peut être
  // lancé ou clos à la main avant l'heure, et ses dates ne le racontent alors
  // plus. Le seul consulter laisserait « abréger » un tournoi que la page
  // affiche en cours — les deux modules répondraient différemment sur la même
  // ligne, et le bouton proposerait d'abréger le vide.
  if (tournament.state === "FINISHED") return "TOURNAMENT_ALREADY_FINISHED";
  if (tournament.state === "RUNNING") return "TOURNAMENT_ALREADY_STARTED";

  // Et l'état calculé fait le reste : les dates peuvent avoir dépassé le coup
  // d'envoi sans que la colonne ait été recalée — il n'y a alors plus rien à
  // abréger, la prochaine synchronisation lancera le tournoi d'elle-même.
  const state = computeTournamentState(tournament as TournamentStateInput, now);
  if (state === "FINISHED") return "TOURNAMENT_ALREADY_FINISHED";
  if (state === "RUNNING") return "TOURNAMENT_ALREADY_STARTED";

  return null;
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
  return shortenScheduleForAdvance(tournament, "RUNNING", now);
}

/**
 * Étape où « Avancer le tournoi » mène, depuis l'étape courante.
 *
 * Le bouton n'abrège plus tout d'un coup : il fait franchir **une** étape, pour
 * que le staff puisse ouvrir les inscriptions d'un tournoi encore masqué sans
 * le lancer, puis clore les inscriptions (et relire le seeding) avant le coup
 * d'envoi. Masqué et annoncé mènent tous deux aux **inscriptions** — un tournoi
 * « annoncé » sans inscriptions n'est pas une étape où l'on s'arrête exprès.
 */
export type AdvanceTarget = Extract<TournamentStageKey, "REGISTRATION" | "LOCKED" | "RUNNING">;

const ADVANCE_TARGETS: Partial<Record<TournamentStageKey, AdvanceTarget>> = {
  HIDDEN: "REGISTRATION",
  ANNOUNCED: "REGISTRATION",
  REGISTRATION: "LOCKED",
  LOCKED: "RUNNING",
};

/**
 * Jalon qui fait entrer dans chaque étape cible, en index dans
 * `[visibilité, ouverture, clôture, début]`.
 */
const TARGET_MILESTONE: Record<AdvanceTarget, number> = {
  REGISTRATION: 1,
  LOCKED: 2,
  RUNNING: 3,
};

/**
 * Étape suivante du tournoi, ou `null` quand il n'y a plus rien à avancer.
 *
 * **`null` exactement quand `launchBlockReason` refuse**, et c'est ce refus qui
 * le décide, pas un second calcul qui lui ressemblerait : `computeTournamentProgress`
 * remplace un jalon illisible par celui de son voisin pour que la frise reste
 * dessinable, là où avancer s'y refuse. Sans cette ligne, un tournoi aux dates
 * corrompues afficherait le bouton sur une action que le serveur refuse en 400.
 *
 * L'étape, elle, est bien celle de `computeTournamentProgress` et non l'état du
 * moteur : c'est la seule des deux à distinguer « masqué » d'« annoncé » et
 * l'avant de l'après-inscriptions.
 */
export function advanceTarget(
  tournament: LaunchableTournament,
  now: number = Date.now(),
): AdvanceTarget | null {
  if (launchBlockReason(tournament, now) !== null) return null;
  const { current } = computeTournamentProgress(tournament, { now });
  return ADVANCE_TARGETS[current] ?? null;
}

/**
 * Les jalons ramenés au plus tôt pour qu'à l'instant `now` le tournoi soit
 * **dans l'étape cible** — ni avant, ni après.
 *
 * Même principe que `shortenScheduleForLaunch`, dont c'est la généralisation
 * (cible `RUNNING`) : on ne fait jamais avancer une date, on ne fait que
 * reculer celle qui ouvre l'étape visée, puis celles qui la précèdent, chacune
 * bornée par la suivante. Les jalons postérieurs restent à venir : ouvrir les
 * inscriptions ne touche ni leur clôture ni le coup d'envoi.
 *
 * Ne contrôle rien : appeler `advanceTarget` d'abord.
 */
export function shortenScheduleForAdvance(
  tournament: LaunchableTournament,
  target: AdvanceTarget,
  now: number = Date.now(),
): ShortenedSchedule {
  const backdated = now - LAUNCH_BACKDATE_MS;
  const pivot = TARGET_MILESTONE[target];
  const times = [
    tournament.startVisibilityAt,
    tournament.registrationOpenAt,
    tournament.registrationCloseAt,
    tournament.startAt,
  ].map(timeOf);

  for (let index = times.length - 1; index >= 0; index -= 1) {
    let value = times[index];
    if (index <= pivot) value = Math.min(value, backdated);
    if (index < times.length - 1) value = Math.min(value, times[index + 1]);
    times[index] = value;
  }

  const [startVisibilityAt, registrationOpenAt, registrationCloseAt, startAt] = times;
  return {
    startVisibilityAt: new Date(startVisibilityAt).toISOString(),
    registrationOpenAt: new Date(registrationOpenAt).toISOString(),
    registrationCloseAt: new Date(registrationCloseAt).toISOString(),
    startAt: new Date(startAt).toISOString(),
  };
}

/**
 * Le lancement clôturera-t-il le tournoi sans qu'un seul match soit joué ?
 *
 * Le seuil est celui du moteur (`MIN_ENTRANTS_FOR_MATCHES`, `./constants`),
 * partagé avec `finalizeUnderfilledTournament` qui décide réellement de la
 * clôture : la confirmation ne peut pas promettre autre chose que ce qui va se
 * passer.
 *
 * Un effectif insuffisant n'est pas un refus — c'est exactement ce qui se
 * produirait à l'heure annoncée, et un organisateur peut vouloir en finir tout
 * de suite avec un plateau désert. Mais « Lancer » ne doit pas être ce qui le
 * lui apprend : la confirmation le dit avant le clic.
 */
export function willCloseWithoutMatches(entrantCount: number): boolean {
  return entrantCount < MIN_ENTRANTS_FOR_MATCHES;
}

/**
 * Message rendu à l'organisateur une fois le tournoi avancé.
 *
 * Il se décide sur l'état **réellement atteint**, pas seulement sur l'étape
 * visée : le moteur clôt sur-le-champ un plateau de moins de deux engagés, et
 * annoncer « tournoi lancé » devant une fiche déjà terminée serait un démenti
 * immédiat.
 */
export function advanceSuccessMessage(
  target: AdvanceTarget,
  state: TournamentState,
  entrantCount: number,
): string {
  if (state === "FINISHED") {
    return "Tournoi clos : il n'y avait pas assez d'engagés pour jouer un match.";
  }
  if (state === "RUNNING") return `Tournoi lancé avec ${entrantCount} engagés.`;
  if (target === "REGISTRATION") return "Inscriptions ouvertes.";
  return `Inscriptions closes avec ${entrantCount} engagés.`;
}
