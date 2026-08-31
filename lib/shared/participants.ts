/**
 * Type de participant d'un tournoi : équipes (défaut historique) ou joueurs
 * inscrits individuellement.
 *
 * Le moteur de tournoi (plateaux, survie, suisse, endurance, multi-phases) ne
 * connaît qu'une notion d'**engagé** identifié par un `team_id`. Un tournoi
 * individuel ne change donc rien à l'appariement ni au calcul des scores : il
 * change *qui* s'inscrit (le joueur, via son entrée solo — voir
 * `lib/server/solo-entries-service.ts`) et *comment on en parle* à l'écran.
 *
 * Ce module porte les deux parties purement lexicales/structurelles de la
 * fonctionnalité : le vocabulaire français associé à chaque type, et la
 * dérivation du nom de l'entrée solo d'un joueur.
 */

export type ParticipantType = "TEAM" | "SOLO";

export function isParticipantType(value: unknown): value is ParticipantType {
  return value === "TEAM" || value === "SOLO";
}

/** Ramène n'importe quelle valeur douteuse au type par défaut (`TEAM`). */
export function toParticipantType(value: unknown): ParticipantType {
  return isParticipantType(value) ? value : "TEAM";
}

export function isSoloTournament(participantType: ParticipantType | null | undefined): boolean {
  return participantType === "SOLO";
}

/**
 * Vocabulaire d'un type de participant. Centralisé ici pour que les libellés
 * restent cohérents d'un écran à l'autre : cartes de tournoi, page de détail,
 * formulaire de création, messages d'erreur.
 */
export type ParticipantWording = {
  /** « équipe » / « joueur ». */
  one: string;
  /** « équipes » / « joueurs ». */
  many: string;
  /** « Équipe » / « Joueur » (en-tête de colonne). */
  oneCapitalized: string;
  /** « Équipes » / « Joueurs ». */
  manyCapitalized: string;
  /** « Équipes participantes » / « Joueurs participants ». */
  manyParticipating: string;
  /** « équipes engagées » / « joueurs engagés ». */
  manyEngaged: string;
  /** Libellé du champ de capacité à la création. */
  maxLabel: string;
  /** Bouton d'inscription de la page de tournoi. */
  registerCta: string;
  /** Bouton d'inscription d'un engagé sans compte (équipe fantôme). */
  guestCta: string;
  /** Sujet des phrases parlant de l'engagé : « L'équipe » / « Le joueur ». */
  subject: string;
  /** Confirmation d'abandon, quand le joueur parle de son propre engagement. */
  forfeitSelfConfirm: string;
  /** Titre du dialogue d'inscription d'un engagé sans compte. */
  guestTitle: string;
  /** Rappel de la portée du dialogue d'inscription d'un engagé sans compte. */
  guestHint: string;
  /** Libellé du sélecteur d'engagé sans compte existant. */
  guestSelectLabel: string;
  /** Libellé du champ de nom à la création d'un engagé sans compte. */
  guestNewNameLabel: string;
  /** Confirmation affichée après inscription d'un engagé sans compte. */
  guestSuccess: string;
  /** Badge du bandeau de tournoi (null = rien à signaler, cas des équipes). */
  badge: string | null;
};

export const PARTICIPANT_WORDING: Record<ParticipantType, ParticipantWording> = {
  TEAM: {
    one: "équipe",
    many: "équipes",
    oneCapitalized: "Équipe",
    manyCapitalized: "Équipes",
    manyParticipating: "Équipes participantes",
    manyEngaged: "équipes engagées",
    maxLabel: "Nombre max d'équipes",
    registerCta: "Inscrire mon équipe",
    guestCta: "+ Équipe fantôme",
    subject: "L'équipe",
    forfeitSelfConfirm: "Abandonner ? Votre équipe quittera définitivement le tournoi.",
    guestTitle: "Inscrire une équipe fantôme",
    guestHint:
      "Réservé aux équipes fantômes : une équipe de joueurs s'inscrit toujours elle-même.",
    guestSelectLabel: "Équipe fantôme",
    guestNewNameLabel: "Nom de la nouvelle équipe",
    guestSuccess: "Équipe fantôme inscrite.",
    badge: null,
  },
  SOLO: {
    one: "joueur",
    many: "joueurs",
    oneCapitalized: "Joueur",
    manyCapitalized: "Joueurs",
    manyParticipating: "Joueurs participants",
    manyEngaged: "joueurs engagés",
    maxLabel: "Nombre max de joueurs",
    registerCta: "M'inscrire",
    guestCta: "+ Joueur invité",
    subject: "Le joueur",
    forfeitSelfConfirm: "Abandonner ? Tu quitteras définitivement le tournoi.",
    guestTitle: "Inscrire un joueur invité",
    guestHint:
      "Réservé aux joueurs sans compte sur le site : un joueur inscrit s'engage toujours lui-même.",
    guestSelectLabel: "Joueur invité",
    guestNewNameLabel: "Pseudo du joueur invité",
    guestSuccess: "Joueur invité inscrit.",
    badge: "Individuel",
  },
};

export function participantWording(
  participantType: ParticipantType | null | undefined,
): ParticipantWording {
  return PARTICIPANT_WORDING[toParticipantType(participantType)];
}

/** Longueur maximale d'un nom d'équipe en base (`bg_teams.name`). */
export const TEAM_NAME_MAX_LENGTH = 60;
/** Longueur minimale retenue pour qu'un nom d'entrée solo reste lisible. */
const SOLO_NAME_MIN_LENGTH = 3;

/**
 * Noms candidats pour l'entrée solo d'un joueur, du plus souhaitable au plus
 * défensif.
 *
 * L'entrée solo est une ligne de `bg_teams`, dont le nom est **unique** : le
 * pseudo peut donc être déjà pris par une équipe (ou par l'entrée solo d'un
 * homonyme historique). L'appelant essaie les candidats dans l'ordre et retient
 * le premier libre ; le dernier, construit sur l'identifiant du compte, ne peut
 * entrer en collision qu'avec lui-même.
 */
export function soloEntryNameCandidates(pseudo: string, userId: number): string[] {
  const trimmed = pseudo.trim();
  const suffix = ` #${userId}`;
  const candidates: string[] = [];

  if (trimmed.length >= SOLO_NAME_MIN_LENGTH) {
    candidates.push(trimmed.slice(0, TEAM_NAME_MAX_LENGTH));
  }

  if (trimmed.length > 0) {
    candidates.push(`${trimmed.slice(0, TEAM_NAME_MAX_LENGTH - suffix.length)}${suffix}`);
  }

  candidates.push(`Joueur${suffix}`);

  // Un pseudo très court peut produire deux fois le même candidat : on ne
  // retente jamais un nom déjà écarté.
  return candidates.filter((name, index) => candidates.indexOf(name) === index);
}

/**
 * Lien vers la fiche de l'engagé : le profil du joueur pour une entrée solo,
 * la page d'équipe sinon. `soloUserIds` associe l'identifiant d'engagé
 * (`team_id`) à l'identifiant du compte joueur.
 */
export function entrantHref(
  teamId: number,
  soloUserIds: Record<number, number> | null | undefined,
): string {
  const userId = soloUserIds?.[teamId];
  return userId ? `/joueurs/${userId}` : `/equipes/${teamId}`;
}
