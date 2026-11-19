/**
 * Durées estimées du planning (`docs/features/CAST_PLANNING.md`) : un membre
 * ne tient pas deux entrées qui se chevauchent, mais enchaîne des entrées
 * consécutives. Un match dure son nombre maximal de cartes (format du
 * tournoi) fois la durée d'une carte du jeu, plus une marge ; un tournoi
 * entier (évènement aux matchs enchaînés) dure une soirée. Réglages du staff,
 * gardés dans `bg_settings` (`planning_durations`).
 */
import { DEFAULT_PLANNING_CONFIRM_LEAD_HOURS, PLANNING_CONFIRM_LEAD_BOUNDS } from "./schedule-deadline";
import type { TournamentGame } from "./types";

export type PlanningDurationSettings = {
  /** Minutes par carte, par jeu. */
  mapMinutes: { OW: number; MR: number };
  /** Marge par match (mise en place, pauses). */
  bufferMinutes: number;
  /** Cartes comptées quand le tournoi n'a pas de format de match. */
  defaultMaps: number;
  /** Durée d'un tournoi entier (sans matchs planifiés). */
  eventHours: number;
  /**
   * Délai de confirmation d'office d'un match du planning, en heures avant
   * son début (`docs/features/SCHEDULE_DEADLINE.md`) : au plus tôt de ce
   * délai et de la date butoir du match. Jamais sous 24 h (le préavis d'un
   * match). Absent d'un réglage enregistré avant lui : sa valeur par défaut.
   */
  confirmLeadHours: number;
};

export const DEFAULT_PLANNING_DURATIONS: PlanningDurationSettings = {
  mapMinutes: { OW: 15, MR: 12 },
  bufferMinutes: 10,
  defaultMaps: 3,
  eventHours: 4,
  confirmLeadHours: DEFAULT_PLANNING_CONFIRM_LEAD_HOURS,
};

/** Bornes de chaque réglage (inclusives). */
export const PLANNING_DURATION_BOUNDS = {
  mapMinutes: [5, 60],
  bufferMinutes: [0, 60],
  defaultMaps: [1, 9],
  eventHours: [1, 12],
  confirmLeadHours: PLANNING_CONFIRM_LEAD_BOUNDS,
} as const;

function inBounds(value: unknown, [min, max]: readonly [number, number]): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** Réglages reçus (corps de requête) : `null` au moindre champ hors bornes ou manquant. */
export function validateDurationSettings(raw: unknown): PlanningDurationSettings | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const maps = value.mapMinutes as Record<string, unknown> | null | undefined;
  if (typeof maps !== "object" || maps === null) return null;
  const b = PLANNING_DURATION_BOUNDS;
  if (!inBounds(maps.OW, b.mapMinutes) || !inBounds(maps.MR, b.mapMinutes)) return null;
  if (!inBounds(value.bufferMinutes, b.bufferMinutes)) return null;
  if (!inBounds(value.defaultMaps, b.defaultMaps)) return null;
  if (!inBounds(value.eventHours, b.eventHours)) return null;
  // Facultatif : un réglage enregistré avant le délai de confirmation le garde par défaut.
  const confirmLeadHours = value.confirmLeadHours === undefined ? DEFAULT_PLANNING_CONFIRM_LEAD_HOURS : value.confirmLeadHours;
  if (!inBounds(confirmLeadHours, b.confirmLeadHours)) return null;
  return {
    mapMinutes: { OW: maps.OW, MR: maps.MR },
    bufferMinutes: value.bufferMinutes,
    defaultMaps: value.defaultMaps,
    eventHours: value.eventHours,
    confirmLeadHours,
  };
}

/** Réglages lus en base (JSON) : la valeur par défaut si illisible ou hors bornes. */
export function parseDurationSettings(stored: string | null | undefined): PlanningDurationSettings {
  if (!stored) return DEFAULT_PLANNING_DURATIONS;
  try {
    return validateDurationSettings(JSON.parse(stored)) ?? DEFAULT_PLANNING_DURATIONS;
  } catch {
    return DEFAULT_PLANNING_DURATIONS;
  }
}

export type MatchFormatForDuration = {
  game: TournamentGame;
  type: "BO" | "FT" | null;
  value: number | null;
  maxMaps: number | null;
};

/**
 * Cartes au plus d'un match : BO n → n ; FT n → la borne du tournoi, sinon
 * 2n − 1 (sans nul) ; sans format, `defaultMaps`.
 */
export function maxMapsOf(format: MatchFormatForDuration, settings: PlanningDurationSettings): number {
  const value = format.value !== null && format.value > 0 ? format.value : null;
  if (format.type === "BO" && value !== null) return value;
  if (format.type === "FT" && value !== null) return format.maxMaps !== null && format.maxMaps > 0 ? format.maxMaps : 2 * value - 1;
  return settings.defaultMaps;
}

/** Durée estimée d'un match, en minutes. */
export function estimateMatchMinutes(format: MatchFormatForDuration, settings: PlanningDurationSettings): number {
  return maxMapsOf(format, settings) * settings.mapMinutes[format.game] + settings.bufferMinutes;
}

/** Durée estimée d'un tournoi entier, en minutes. */
export function estimateEventMinutes(settings: PlanningDurationSettings): number {
  return settings.eventHours * 60;
}
