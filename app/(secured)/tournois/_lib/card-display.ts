/**
 * Ce que disent les cartes de `/tournois`, décidé hors du rendu.
 *
 * Quatre composants de carte recopiaient la même dérivation, et la recopiaient
 * faux : `format === "DOUBLE" ? … : "Élimination simple"` annonçait une ronde
 * suisse, une survie ou un multi-phases comme une élimination simple, deux
 * fois par carte. Tout ce qui se déduit d'une carte passe donc par ici, et le
 * libellé d'un format par `FORMAT_LABELS`, la table de la fiche.
 */
import { computeTournamentProgress } from "@/lib/shared/tournament-progress";
import type { TournamentCard, TournamentFormat } from "@/lib/shared/types";

/**
 * Action d'une carte « en cours », selon ce que la fiche montre d'abord : un
 * arbre pour l'élimination, un classement pour les modes qui en tiennent un.
 * « Voir bracket » partout promettait un arbre à la ronde suisse et à la
 * survie, qui n'en ont pas.
 */
export function runningCardAction(format: TournamentFormat): string {
  switch (format) {
    case "SINGLE":
    case "DOUBLE":
      return "Voir le bracket";
    case "SWISS":
    case "SURVIVAL":
    case "BG_SURVIE":
      return "Voir le classement";
    default:
      return "Voir le tournoi";
  }
}

/**
 * Les deux visages d'un tournoi `UPCOMING` : pas encore ouvert aux
 * inscriptions (`ANNOUNCED`), ou inscriptions **closes** en attente du coup
 * d'envoi (`LOCKED`) — `computeTournamentState` rend `UPCOMING` dans les deux
 * cas. Les dates tranchent, par la règle de la frise de la fiche.
 *
 * Un tournoi encore masqué (section réservée au staff) compte comme annoncé :
 * ses inscriptions ne sont pas ouvertes non plus.
 */
export function upcomingCardFace(
  card: Pick<
    TournamentCard,
    "state" | "startVisibilityAt" | "registrationOpenAt" | "registrationCloseAt" | "startAt"
  >,
  now: number,
): "ANNOUNCED" | "LOCKED" {
  return computeTournamentProgress(card, { now }).current === "LOCKED" ? "LOCKED" : "ANNOUNCED";
}

export type RegistrationFill = {
  /** Part des places prises, de 0 à 1 (bornée : un dépassement reste plein). */
  ratio: number;
  percent: number;
  /** Plus aucune place : l'inscription serait refusée (`TOURNAMENT_FULL`). */
  full: boolean;
};

/** Remplissage d'un plateau. Une capacité nulle ou illisible ne remplit rien. */
export function registrationFill(
  card: Pick<TournamentCard, "registeredTeams" | "maxTeams">,
): RegistrationFill {
  const max = Number(card.maxTeams);
  const registered = Math.max(0, Number(card.registeredTeams) || 0);
  if (!(max > 0)) return { ratio: 0, percent: 0, full: false };

  const ratio = Math.min(1, registered / max);
  // Tronqué : arrondi, 199/200 afficherait « 100 % » sur un plateau qui
  // accepte encore une inscription.
  return { ratio, percent: Math.floor(ratio * 100), full: registered >= max };
}

/**
 * Pourcentage affiché d'un avancement de 0 à 1, `null` s'il n'est pas connu.
 * Tronqué et non arrondi : une carte ne doit pas annoncer 100 % d'un tournoi
 * qui n'est pas clos (l'arrondi de 0,996 le ferait).
 */
export function progressPercent(ratio: number | null): number | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  return Math.floor(Math.min(1, Math.max(0, ratio)) * 100);
}

/**
 * Date d'une carte, dans le fuseau du lecteur : jour, mois abrégé, année, et
 * l'heure quand elle compte (un coup d'envoi, une clôture d'inscriptions). Une
 * date illisible rend un tiret plutôt qu'« Invalid Date ».
 */
export function formatCardDate(iso: string | null, withTime: boolean): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}
