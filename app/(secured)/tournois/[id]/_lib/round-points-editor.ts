/**
 * Saisie des points par carte d'un tour, format Duel / Arcade
 * (`docs/features/DUEL_ARCADE.md`), décidée hors du composant
 * (`RoundPointsForm`) : la règle se teste sans rendu. Le serveur renettoie tout
 * (`normalizeMapPointTargets`) ; ceci ne règle que l'écran.
 *
 * Chaque carte du tour a son champ, prérempli de son N effectif (la carte,
 * sinon le tour, sinon le tournoi). Une carte laissée — ou ramenée — au nombre
 * du tour le **suit** (`null`) : rien n'est stocké pour elle, et elle suivra un
 * nouveau nombre du tour.
 */
import { ROUND_MAP_SLOTS_MAX } from "@/lib/shared/round-maps";

/** Valeur d'une carte à l'écran : son propre N, ou `null` (elle suit le tour). */
export type MapPointDraft = number | null;

/** Les `null` de fin retirés : la forme stockée (`normalizeMapPointTargets`). */
export function trimMapPointTargets(targets: ReadonlyArray<MapPointDraft>): MapPointDraft[] {
  let end = targets.length;
  while (end > 0 && targets[end - 1] === null) end -= 1;
  return targets.slice(0, end);
}

/**
 * Cartes montrées : autant que le format du tour en joue (`roundMaxMaps`, sans
 * dépasser {@link ROUND_MAP_SLOTS_MAX} ; score libre : ce plafond), et au moins
 * autant que de cartes déjà réglées (un format raccourci depuis ne cache pas
 * un réglage resté). `0` sur un tour à une seule carte sans réglage : le nombre
 * du tour dit déjà tout.
 */
export function mapPointRowCount(maxMaps: number | null, saved: ReadonlyArray<MapPointDraft>): number {
  const byFormat = Math.min(maxMaps ?? ROUND_MAP_SLOTS_MAX, ROUND_MAP_SLOTS_MAX);
  const rows = Math.max(byFormat, saved.length);
  return rows <= 1 && saved.length === 0 ? 0 : rows;
}

/**
 * Brouillon d'ouverture : les cartes réglées, `null` partout ailleurs ; une
 * carte dont le N vaut celui du tour le suit.
 */
export function mapPointDrafts(
  saved: ReadonlyArray<MapPointDraft>,
  roundTarget: number,
  rows: number,
): MapPointDraft[] {
  return Array.from({ length: rows }, (_, index) => {
    const value = saved[index] ?? null;
    return value === roundTarget ? null : value;
  });
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

/** Ce qui part au serveur (`mapTargets`) : cartes au nombre du tour remises à `null`, `null` de fin retirés. */
export function mapPointTargetsToSend(drafts: ReadonlyArray<MapPointDraft>, roundTarget: number): MapPointDraft[] {
  return trimMapPointTargets(drafts.map((value) => (value === roundTarget ? null : value)));
}

/** Deux listes stockées sont-elles les mêmes ? */
export function sameMapPointTargets(a: ReadonlyArray<MapPointDraft>, b: ReadonlyArray<MapPointDraft>): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
