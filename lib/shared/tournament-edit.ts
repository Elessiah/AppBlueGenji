/**
 * Fenêtre d'édition d'un tournoi — logique pure, partagée client/serveur.
 *
 * Un tournoi n'est pas modifiable de la même façon selon qu'il est encore
 * caché, déjà annoncé, ou lancé. La règle est ici et nulle part ailleurs : le
 * serveur la rejoue sous verrou pour refuser une modification interdite, et
 * l'interface s'en sert pour désactiver les champs concernés. Même modèle que
 * `match-lock.ts` et `seeding.ts`.
 */
import type { TournamentState } from "./types";

/**
 * Tous les champs modifiables d'un tournoi, dans l'ordre du formulaire.
 *
 * Cette liste est la **source unique** : `TournamentField` en est dérivé. Les
 * deux étaient tenus à la main en parallèle, et rien n'obligeait un champ
 * ajouté au type à rejoindre le tableau — or c'est le tableau que parcourt la
 * liste blanche de `PATCH /api/tournaments/[id]/edit` : un champ oublié là
 * aurait été silencieusement ignoré à l'édition, sans la moindre erreur.
 */
export const ALL_TOURNAMENT_FIELDS = [
  "name",
  "description",
  "game",
  "format",
  "participantType",
  "maxTeams",
  "startVisibilityAt",
  "registrationOpenAt",
  "registrationCloseAt",
  "startAt",
  "hasThirdPlaceMatch",
  "survivalRoundsBeforeFirstCut",
  "survivalRoundsPerCut",
  "swissTotalRounds",
  "swissPointsWin",
  "swissPointsDraw",
  "swissPointsLoss",
  "endurancePoints",
  "enduranceWinDelta",
  "enduranceLossDelta",
  "endurancePlayoffSize",
  "matchFormat",
  "phases",
] as const;

/** Champ modifiable d'un tournoi. */
export type TournamentField = (typeof ALL_TOURNAMENT_FIELDS)[number];

/**
 * Champs qui survivent à la publication.
 *
 * `registrationOpenAt` n'en fait volontairement pas partie, même sur un tournoi
 * visible dont l'ouverture n'a pas encore eu lieu : la date d'ouverture est le
 * cœur de l'annonce, et la repousser après coup est précisément ce qui fait
 * rater une inscription.
 */
export const RESTRICTED_FIELDS: readonly TournamentField[] = [
  "name",
  "description",
  "registrationCloseAt",
  "startAt",
  "maxTeams",
];

/**
 * - `FULL` — tournoi encore invisible : tout est modifiable, personne n'a rien lu.
 * - `RESTRICTED` — annonce publiée, tournoi pas encore lancé.
 * - `LOCKED` — tournoi en cours ou terminé : plus rien, l'arbitrage prend le relais.
 */
export type EditWindow = "FULL" | "RESTRICTED" | "LOCKED";

/** Pourquoi la fenêtre est-elle réduite ? `null` = elle ne l'est pas. */
export type EditLockReason = "VISIBLE" | "STARTED" | null;

/** Vue minimale d'un tournoi, satisfaite par `TournamentCard` comme par une ligne SQL. */
export type EditableTournament = {
  state: TournamentState;
  startVisibilityAt: string;
  maxTeams: number;
};

/**
 * Le tournoi est-il encore invisible ?
 *
 * Une date illisible est traitée comme **visible** : mieux vaut restreindre à
 * tort que rouvrir le format d'un tournoi déjà annoncé.
 *
 * `isTournamentPublished` (`tournament-visibility.ts`) tranche l'inverse sur la
 * même donnée abîmée — non publié, donc réservé au staff. Ce n'est pas une
 * divergence : les deux se ferment, chacune du côté qui restreint. Ici la
 * restriction est de moins pouvoir modifier, là-bas de moins pouvoir lire.
 */
function isHidden(tournament: EditableTournament, now: number): boolean {
  const visibleAt = new Date(tournament.startVisibilityAt).getTime();
  return Number.isFinite(visibleAt) && visibleAt > now;
}

export function editWindowFor(
  tournament: EditableTournament,
  now: number = Date.now(),
): EditWindow {
  // L'état prime : un tournoi lancé reste verrouillé même si sa date de
  // visibilité a été reprise à la main et pointe dans le futur.
  if (tournament.state === "RUNNING" || tournament.state === "FINISHED") return "LOCKED";
  return isHidden(tournament, now) ? "FULL" : "RESTRICTED";
}

export function editLockReason(
  tournament: EditableTournament,
  now: number = Date.now(),
): EditLockReason {
  const window = editWindowFor(tournament, now);
  if (window === "LOCKED") return "STARTED";
  if (window === "RESTRICTED") return "VISIBLE";
  return null;
}

/**
 * Champs modifiables dans une fenêtre donnée.
 *
 * Séparé de `editableFieldsFor` parce que le client ne dispose pas toujours du
 * tournoi : `GET /api/tournaments/[id]/edit` lui rend la **fenêtre** déjà
 * calculée, sans l'état. Faute de cette porte, la page d'édition rejouait le
 * `switch` en miniature — deux écritures de la même règle, dont une seule
 * aurait suivi l'ajout d'une fenêtre.
 */
export function editableFieldsForWindow(window: EditWindow): ReadonlySet<TournamentField> {
  switch (window) {
    case "FULL":
      return new Set(ALL_TOURNAMENT_FIELDS);
    case "RESTRICTED":
      return new Set(RESTRICTED_FIELDS);
    case "LOCKED":
      // Fenêtre verrouillée : aucun champ n'est modifiable. L'exhaustivité est
      // vérifiée à la compilation : ajouter une valeur à EditWindow déclenchera
      // une erreur TypeScript plutôt qu'une logique silencieuse.
      return new Set();
  }
}

export function editableFieldsFor(
  tournament: EditableTournament,
  now: number = Date.now(),
): ReadonlySet<TournamentField> {
  return editableFieldsForWindow(editWindowFor(tournament, now));
}

export function isFieldEditable(
  field: TournamentField,
  tournament: EditableTournament,
  now: number = Date.now(),
): boolean {
  return editableFieldsFor(tournament, now).has(field);
}

/** Ce qui empêche un patch de passer. */
export type EditViolation =
  | { code: "FIELD_NOT_EDITABLE"; field: TournamentField }
  | { code: "MAX_TEAMS_CANNOT_DECREASE" }
  | { code: "REGISTRATION_CLOSE_IN_PAST" };

/**
 * Première violation d'un patch, ou `null` s'il passe.
 *
 * L'ordre des contrôles est significatif : un champ interdit est signalé comme
 * tel avant que sa valeur soit jugée. Dire « effectif trop bas » sur un tournoi
 * en cours, où l'effectif n'est de toute façon plus modifiable, enverrait
 * l'utilisateur corriger la mauvaise chose.
 *
 * Ne juge que le **droit** de modifier. La cohérence des valeurs entre elles
 * (ordre des dates, barème suisse monotone…) appartient à
 * `lib/server/tournaments/validation.ts`.
 */
export function checkEditPatch(
  current: EditableTournament,
  patch: Partial<Record<TournamentField, unknown>>,
  now: number = Date.now(),
): EditViolation | null {
  const editable = editableFieldsFor(current, now);

  for (const field of ALL_TOURNAMENT_FIELDS) {
    if (patch[field] === undefined) continue;
    if (!editable.has(field)) return { code: "FIELD_NOT_EDITABLE", field };
  }

  const window = editWindowFor(current, now);
  if (window !== "RESTRICTED") return null;

  if (patch.maxTeams !== undefined && Number(patch.maxTeams) < current.maxTeams) {
    return { code: "MAX_TEAMS_CANNOT_DECREASE" };
  }

  // Reculer la clôture dans le passé ne clôt pas les inscriptions :
  // `computeTournamentState` renverrait `UPCOMING` et le tournoi reculerait
  // d'un état. Pour clore tout de suite, on avance `startAt`.
  if (current.state === "REGISTRATION" && patch.registrationCloseAt !== undefined) {
    const closeAt = new Date(String(patch.registrationCloseAt)).getTime();
    if (Number.isFinite(closeAt) && closeAt < now) return { code: "REGISTRATION_CLOSE_IN_PAST" };
  }

  return null;
}
