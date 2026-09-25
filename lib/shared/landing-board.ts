/**
 * Ce que dit une carte du tableau « Tournois en cours et à venir » de
 * l'accueil : l'état, l'action proposée, la date de début.
 *
 * Tout cela était écrit dans le composant, et faux de plusieurs façons : l'état
 * brut anglais (« REGISTRATION · BRACKET »), un « S'inscrire » sur un tournoi
 * déjà lancé ou complet, un « Voir le bracket » sur un tournoi aux inscriptions
 * (dont l'arbre est vide) et une date avec ses secondes. La règle vit donc ici,
 * pure, pour se tester sans rendu.
 *
 * Le jeu, lui, n'a plus rien à décider : il est porté par `TournamentCard.game`
 * — il était **deviné d'après le nom** (`inferGameLabel`), si bien qu'un
 * tournoi Marvel Rivals au nom neutre s'annonçait Overwatch.
 */
import { computeTournamentProgress, type TournamentStageKey } from "./tournament-progress";
import type { TournamentCard, TournamentFormat } from "./types";

type BoardCard = Pick<
  TournamentCard,
  | "state"
  | "format"
  | "maxTeams"
  | "registeredTeams"
  | "startVisibilityAt"
  | "registrationOpenAt"
  | "registrationCloseAt"
  | "startAt"
>;

/**
 * Fuseau de rédaction des dates du tableau. Le composant est rendu **côté
 * serveur**, dont le fuseau n'est pas celui du lecteur : sans fuseau fixé, la
 * date affichée dépendrait de la machine qui sert la page. Le public du site
 * est français, comme pour les aperçus de liens (`share-metadata.ts`).
 */
export const BOARD_TIME_ZONE = "Europe/Paris";

/** Formats dont le plateau est un arbre : « Voir le bracket » y a un sens. */
const BRACKET_FORMATS: ReadonlySet<TournamentFormat> = new Set<TournamentFormat>(["SINGLE", "DOUBLE"]);

/** Un plateau plein ne prend plus d'inscription ; `maxTeams` à 0 = sans limite. */
export function isTournamentFull(card: Pick<TournamentCard, "maxTeams" | "registeredTeams">): boolean {
  return card.maxTeams > 0 && card.registeredTeams >= card.maxTeams;
}

/**
 * Étape du cycle de vie vue par l'accueil. `UPCOMING` recouvre deux moments
 * qu'un visiteur ne confond pas — inscriptions à venir, inscriptions closes —,
 * départagés par les dates comme sur la frise de la fiche.
 */
function boardStage(card: BoardCard, now: number): TournamentStageKey {
  return computeTournamentProgress(card, { now }).current;
}

/** Libellé français de l'état, pour la pastille de la carte. */
export function boardStateLabel(card: BoardCard, now: number = Date.now()): string {
  switch (boardStage(card, now)) {
    case "REGISTRATION":
      return isTournamentFull(card) ? "Complet" : "Inscriptions ouvertes";
    case "LOCKED":
      return "Inscriptions closes";
    case "RUNNING":
      return "En cours";
    case "FINISHED":
      return "Terminé";
    default:
      return "Bientôt";
  }
}

/**
 * Action de la carte. Elle mène toujours à la fiche du tournoi ; seul le
 * libellé change, pour ne jamais promettre ce que la fiche ne fera pas :
 * « S'inscrire » seulement quand les inscriptions sont ouvertes et qu'il reste
 * une place, « Voir le bracket » seulement sur un tournoi lancé dont le plateau
 * est un arbre (la Suisse, la Survie ou BlueGenji Survie n'en ont pas — ou pas
 * encore), « Voir le tournoi » sinon.
 */
export function boardActionLabel(card: BoardCard, now: number = Date.now()): string {
  const stage = boardStage(card, now);
  if (stage === "REGISTRATION" && !isTournamentFull(card)) {
    return "S'inscrire";
  }
  if (stage === "RUNNING") {
    return BRACKET_FORMATS.has(card.format) ? "Voir le bracket" : "Suivre le tournoi";
  }
  return "Voir le tournoi";
}

/**
 * Date de début d'une carte : jour, mois et heure à la minute (« 21 sept. ·
 * 20:30 »), l'année seulement quand elle n'est pas l'année en cours. Même
 * grain que le calendrier voisin, sans les secondes de `toLocaleString`.
 * Chaîne vide sur une date illisible, plutôt qu'« Invalid Date ».
 */
export function formatBoardStartAt(iso: string, now: number = Date.now()): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";

  const yearOf = (value: Date): string =>
    new Intl.DateTimeFormat("fr-FR", { year: "numeric", timeZone: BOARD_TIME_ZONE }).format(value);
  const sameYear = yearOf(date) === yearOf(new Date(now));

  const day = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: BOARD_TIME_ZONE,
  }).format(date);
  const time = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BOARD_TIME_ZONE,
  }).format(date);
  return `${day} · ${time}`;
}
