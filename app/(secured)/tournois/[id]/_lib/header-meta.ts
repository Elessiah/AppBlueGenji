import { matchFormatLabel, matchFormatDescription } from "@/lib/shared/match-format";
import { participantWording } from "@/lib/shared/participants";
import type {
  TournamentCard,
  TournamentFormat,
  TournamentGame,
  TournamentPhase,
  TournamentState,
} from "@/lib/shared/types";

/**
 * Identité d'un tournoi, mise en fiche plutôt qu'en guirlande de pastilles.
 *
 * L'en-tête alignait huit pastilles bleues identiques — témoin de flux, jeu,
 * état, format, mode, format de match, effectif, rôle du lecteur — sur une même
 * ligne, sans hiérarchie ni étiquette : on ne savait plus lequel de « Double
 * élim. » et « BlueGenji Survie » disait le format (c'était le second, le
 * premier était un doublon fautif d'un `switch` oublié). Chaque fait porte
 * désormais son intitulé, et le doublon disparaît avec {@link FORMAT_LABELS},
 * source unique.
 *
 * Module **pur** : il ne décide que de *ce qui* est affiché et dans quel ordre.
 * Le rendu — grille, dates localisées, jauge d'effectif — vit dans
 * `_components/TournamentHeader.tsx`.
 */

export const FORMAT_LABELS: Record<TournamentFormat, string> = {
  SINGLE: "Simple élimination",
  DOUBLE: "Double élimination",
  SWISS: "Ronde suisse",
  SURVIVAL: "Survie",
  MULTI: "Multi-phases",
  BG_SURVIE: "BlueGenji Survie",
};

export const GAME_LABELS: Record<TournamentGame, string> = {
  OW2: "Overwatch 2",
  MR: "Marvel Rivals",
};

/**
 * Libellés d'état, et **ton** qui les habille.
 *
 * Aucun n'est rouge : le rouge (`pill-live`) est réservé à ce qui est
 * réellement à l'antenne. Un tournoi « en cours » n'est pas une diffusion — la
 * confusion des trois sens de « live » est justement ce que ces libellés
 * évitent (voir CLAUDE.md).
 */
export const STATE_META: Record<TournamentState, { label: string; tone: HeaderTone }> = {
  UPCOMING: { label: "Prochainement", tone: "neutral" },
  REGISTRATION: { label: "Inscriptions ouvertes", tone: "green" },
  RUNNING: { label: "En cours", tone: "blue" },
  FINISHED: { label: "Terminé", tone: "muted" },
};

export type HeaderTone = "neutral" | "green" | "blue" | "muted";

export type HeaderMetaItem = {
  key: string;
  /** Intitulé du fait : c'est lui qui rend la valeur lisible sans deviner. */
  label: string;
  /**
   * Valeur affichable, ou date ISO quand `kind === "date"` — la mise en forme
   * d'une date dépend du fuseau du lecteur, elle n'a rien à faire ici.
   */
  value: string;
  kind: "text" | "count" | "date";
  /** Explication au survol, quand la valeur est une notation (« FT3 »). */
  hint?: string;
  /** Avancement 0–1 d'une jauge sous la valeur (effectif rempli). */
  ratio?: number;
};

/**
 * Les faits de l'en-tête, dans l'ordre de lecture : ce que c'est, comment ça se
 * joue, avec combien de monde, et quand.
 *
 * Les faits absents ne laissent pas de case vide : un tournoi sans format de
 * match, sans petite finale ou sans phase n'affiche rien de ces lignes plutôt
 * qu'un tiret à interpréter.
 */
export function headerMetaItems(
  card: TournamentCard,
  phases: TournamentPhase[] | null,
  currentPhaseId: number | null,
  now: number = Date.now(),
): HeaderMetaItem[] {
  const wording = participantWording(card.participantType);
  const items: HeaderMetaItem[] = [];

  items.push({
    key: "format",
    label: "Format",
    value: FORMAT_LABELS[card.format] ?? card.format,
    kind: "text",
  });

  // Repère utile seulement pendant que le tournoi tourne : avant le coup
  // d'envoi, « Phase 0/3 » ne dirait rien, et `current_phase_id` **n'est pas
  // remis à zéro à la clôture** — sans la garde d'état, un multi-phases terminé
  // afficherait pour toujours « Phase en cours 3/3 ».
  if (
    card.format === "MULTI" &&
    card.state === "RUNNING" &&
    phases &&
    phases.length > 0 &&
    currentPhaseId !== null
  ) {
    const index = phases.findIndex((phase) => phase.id === currentPhaseId);
    if (index >= 0) {
      items.push({
        key: "phase",
        label: "Phase en cours",
        value: `${index + 1}/${phases.length}`,
        kind: "count",
      });
    }
  }

  if (card.matchFormat) {
    items.push({
      key: "match-format",
      label: "Format des matchs",
      value: matchFormatLabel(card.matchFormat),
      kind: "text",
      hint: matchFormatDescription(card.matchFormat),
    });
  }

  if (card.hasThirdPlaceMatch) {
    items.push({
      key: "third-place",
      label: "Troisième place",
      value: "Petite finale",
      kind: "text",
    });
  }

  // Un effectif se lit d'un coup d'œil : la jauge dit le remplissage sans avoir
  // à diviser de tête. `maxTeams` nul n'existe pas en base, mais un ratio
  // infini traverserait toute la mise en page — on s'en garde.
  items.push({
    key: "entrants",
    label: wording.manyParticipating,
    value: `${card.registeredTeams}/${card.maxTeams}`,
    kind: "count",
    ratio: card.maxTeams > 0 ? Math.min(1, card.registeredTeams / card.maxTeams) : 0,
  });

  const registration = registrationDateItem(card, now);
  if (registration) items.push(registration);

  items.push({
    key: "start",
    label: card.state === "FINISHED" ? "Joué le" : "Début du tournoi",
    value: card.startAt,
    kind: "date",
  });

  return items;
}

/**
 * La date d'inscription qui compte **maintenant** : l'ouverture tant qu'elle est
 * à venir, la clôture ensuite. Une fois le tournoi lancé, plus aucune : elle
 * n'apprendrait rien et pousserait la date de début hors de vue.
 */
function registrationDateItem(card: TournamentCard, now: number): HeaderMetaItem | null {
  if (card.state === "RUNNING" || card.state === "FINISHED") return null;

  const opensAt = Date.parse(card.registrationOpenAt);

  if (Number.isFinite(opensAt) && now < opensAt) {
    return {
      key: "registration-open",
      label: "Inscriptions dès",
      value: card.registrationOpenAt,
      kind: "date",
    };
  }

  return {
    key: "registration-close",
    label: "Clôture des inscriptions",
    value: card.registrationCloseAt,
    kind: "date",
  };
}

/** Sous-titre d'identité : « Overwatch 2 · Individuel ». */
export function headerIdentityLine(card: TournamentCard): string {
  const wording = participantWording(card.participantType);
  return [GAME_LABELS[card.game] ?? card.game, wording.badge].filter(Boolean).join(" · ");
}
