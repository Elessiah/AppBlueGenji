/**
 * Saisie des points par carte d'un tour, format Duel / Arcade
 * (`docs/features/DUEL_ARCADE.md`), décidée hors du composant
 * (`RoundPointsForm`) : la règle se teste sans rendu. Le serveur renettoie tout
 * (`normalizeMapPointTargets`) ; ceci ne règle que l'écran.
 *
 * Chaque carte du tour a son champ, prérempli de son N effectif (la carte,
 * sinon le tour, sinon le tournoi). Une carte jamais réglée, ou **ramenée** à
 * la main au nombre du tour, le **suit** (`null`) : rien n'est stocké pour
 * elle, et elle suivra un nouveau nombre du tour. Une carte réglée garde son N,
 * même quand le tour vient à valoir le même nombre.
 */
import { ROUND_MAP_SLOTS_MAX } from "@/lib/shared/round-maps";
import {
  clipMapPointTargets,
  isValidMapPointTarget,
  sameMapPointTargets,
  trimMapPointTargets,
} from "@/lib/shared/map-points";

export { sameMapPointTargets, trimMapPointTargets };

/** Valeur d'une carte à l'écran : son propre N, ou `null` (elle suit le tour). */
export type MapPointDraft = number | null;

/**
 * Cartes montrées : autant que le format du tour en joue (`roundMaxMaps`, sans
 * dépasser {@link ROUND_MAP_SLOTS_MAX} ; score libre : ce plafond). `0` sur un
 * tour à une seule carte : le nombre du tour dit déjà tout.
 */
export function mapPointRowCount(maxMaps: number | null): number {
  const rows = Math.min(maxMaps ?? ROUND_MAP_SLOTS_MAX, ROUND_MAP_SLOTS_MAX);
  return rows <= 1 ? 0 : rows;
}

/**
 * Réglage enregistré, tel que l'écran le règle : limité aux cartes montrées
 * (un réglage resté au-delà d'un format raccourci n'est jamais joué ni servi).
 */
export function shownSavedMapPointTargets(saved: ReadonlyArray<MapPointDraft>, rows: number): MapPointDraft[] {
  return clipMapPointTargets(saved, rows);
}

/** Brouillon d'ouverture : les cartes réglées, `null` (elles suivent le tour) partout ailleurs. */
export function mapPointDrafts(saved: ReadonlyArray<MapPointDraft>, rows: number): MapPointDraft[] {
  return Array.from({ length: rows }, (_, index) => saved[index] ?? null);
}

/** Une carte saisie : ramenée au nombre du tour, elle le suit. */
export function editMapPointDraft(
  drafts: ReadonlyArray<MapPointDraft>,
  index: number,
  value: number,
  roundTarget: number,
): MapPointDraft[] {
  return drafts.map((draft, i) => {
    if (i !== index) return draft;
    return value === roundTarget ? null : value;
  });
}

/** Ce qui part au serveur (`mapTargets`) : `null` de fin retirés. */
export function mapPointTargetsToSend(drafts: ReadonlyArray<MapPointDraft>): MapPointDraft[] {
  return trimMapPointTargets(drafts);
}

/** Champ d'une carte (`map-0` = carte 1), clé de `useFieldErrors`. */
export type MapPointField = "points" | `map-${number}`;

/**
 * Champ à désigner pour un refus `INVALID_MAP_POINT_TARGET` (le serveur ne rend
 * qu'un code) : le nombre du tour s'il est hors bornes, sinon la première carte hors bornes, sinon la dernière carte que le
 * format joue (réglage trop long), sinon le nombre du tour.
 */
export function invalidPointField(
  mapTargets: ReadonlyArray<MapPointDraft>,
  rows: number,
  roundTarget: number | null = null,
): MapPointField {
  if (roundTarget !== null && !isValidMapPointTarget(roundTarget)) return "points";
  const bad = mapTargets.findIndex((value) => value !== null && !isValidMapPointTarget(value));
  if (bad >= 0) return `map-${bad}`;
  if (mapTargets.length > rows && rows > 0) return `map-${rows - 1}`;
  return "points";
}
