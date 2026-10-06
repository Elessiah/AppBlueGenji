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
import type { Locale } from "./locales";

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

// Formateurs construits une fois par langue : leurs options ne varient pas, et
// une construction coûte bien plus qu'un formatage.
type BoardFormats = {
  year: Intl.DateTimeFormat;
  day: Intl.DateTimeFormat;
  dayYear: Intl.DateTimeFormat;
  time: Intl.DateTimeFormat;
};

function buildFormats(tag: string): BoardFormats {
  return {
    year: new Intl.DateTimeFormat(tag, { year: "numeric", timeZone: BOARD_TIME_ZONE }),
    day: new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: BOARD_TIME_ZONE }),
    dayYear: new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric", timeZone: BOARD_TIME_ZONE }),
    // 24 h dans les deux langues : « 09:00 PM » ne tient pas dans les colonnes
    // étroites, et l'heure doit se lire comme celle du calendrier voisin.
    time: new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: BOARD_TIME_ZONE }),
  };
}

const BOARD_FORMATS: Readonly<Record<Locale, BoardFormats>> = {
  fr: buildFormats("fr-FR"),
  en: buildFormats("en-US"),
};

/** Formats dont le plateau est un arbre : « Voir le bracket » y a un sens. */
const BRACKET_FORMATS: ReadonlySet<TournamentFormat> = new Set<TournamentFormat>(["SINGLE", "DOUBLE"]);

/**
 * Un plateau plein ne prend plus d'inscription. Même comparaison que le refus
 * serveur (`registerTeam` → `TOURNAMENT_FULL`) : la carte ne doit pas annoncer
 * une place que l'inscription refusera.
 */
export function isTournamentFull(card: Pick<TournamentCard, "maxTeams" | "registeredTeams">): boolean {
  return card.registeredTeams >= card.maxTeams;
}

/**
 * Étape du cycle de vie vue par l'accueil. `UPCOMING` recouvre deux moments
 * qu'un visiteur ne confond pas — inscriptions à venir, inscriptions closes —,
 * départagés par les dates comme sur la frise de la fiche.
 */
function boardStage(card: BoardCard, now: number): TournamentStageKey {
  return computeTournamentProgress(card, { now }).current;
}

/** État d'une carte, clé de `landing.board.state` (`messages/<langue>/landing.json`). */
export type BoardStateKey = "full" | "registration" | "locked" | "running" | "finished" | "soon";

/** État de la carte, en clé — l'écran le traduit. */
export function boardStateKey(card: BoardCard, now: number = Date.now()): BoardStateKey {
  switch (boardStage(card, now)) {
    case "REGISTRATION":
      return isTournamentFull(card) ? "full" : "registration";
    case "LOCKED":
      return "locked";
    case "RUNNING":
      return "running";
    case "FINISHED":
      return "finished";
    default:
      return "soon";
  }
}

const BOARD_STATE_FR: Readonly<Record<BoardStateKey, string>> = {
  full: "Complet",
  registration: "Inscriptions ouvertes",
  locked: "Inscriptions closes",
  running: "En cours",
  finished: "Terminé",
  soon: "Bientôt",
};

/** Libellé français de l'état, pour la pastille de la carte. */
export function boardStateLabel(card: BoardCard, now: number = Date.now()): string {
  return BOARD_STATE_FR[boardStateKey(card, now)];
}

/** Action d'une carte, en clé : `bracket`, `follow` ou `view` (voir `boardActionLabel`). */
export type BoardActionKey = "bracket" | "follow" | "view";

export function boardActionKey(card: BoardCard, now: number = Date.now()): BoardActionKey {
  if (boardStage(card, now) === "RUNNING") return BRACKET_FORMATS.has(card.format) ? "bracket" : "follow";
  return "view";
}

/**
 * Action de la carte. Elle mène toujours à la fiche du tournoi ; seul le
 * libellé change, pour ne jamais promettre ce que la fiche ne fera pas.
 *
 * Jamais « S'inscrire » : le tableau ne connaît pas le lecteur (visiteur sans
 * compte, sans équipe, sans rôle de gestion, ou déjà inscrit), et cliquer
 * pouvait mener à une fiche qui refuse l'inscription (`registerBlockedNotice`)
 * — même règle que les cartes d'inscription de `/tournois`
 * (`RegistrationCard.tsx`), où « Complet » se lit déjà séparément sur la
 * pastille d'état (`boardStateLabel`). « Voir le bracket » seulement sur un
 * tournoi lancé dont le plateau est un arbre (la Suisse, la Survie ou
 * BlueGenji Survie n'en ont pas — ou pas encore), « Voir le tournoi » sinon.
 */
export function boardActionLabel(card: BoardCard, now: number = Date.now()): string {
  return BOARD_ACTION_FR[boardActionKey(card, now)];
}

const BOARD_ACTION_FR: Readonly<Record<BoardActionKey, string>> = {
  bracket: "Voir le bracket",
  follow: "Suivre le tournoi",
  view: "Voir le tournoi",
};

/**
 * Date de début d'une carte : jour, mois et heure à la minute (« 21 sept. ·
 * 20:30 »), l'année seulement quand elle n'est pas l'année en cours. Même
 * grain que le calendrier voisin, sans les secondes de `toLocaleString`.
 * Chaîne vide sur une date illisible, plutôt qu'« Invalid Date ».
 */
export function formatBoardStartAt(iso: string, now: number = Date.now(), locale: Locale = "fr"): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";

  const formats = BOARD_FORMATS[locale];
  const sameYear = formats.year.format(date) === formats.year.format(new Date(now));
  const day = (sameYear ? formats.day : formats.dayYear).format(date);
  return `${day} · ${formats.time.format(date)}`;
}
