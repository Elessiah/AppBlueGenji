/**
 * Saisie de la fenêtre « Cartes et bans » (`docs/features/ROUND_MAPS.md`),
 * décidée hors du composant : la règle se teste sans rendu. Le serveur
 * renettoie tout (`normalizeRoundMapSlots`) ; ceci ne règle que l'écran.
 */
import { FIRST_MAP_MAX_LENGTH } from "@/lib/shared/match-referee";
import { ROUND_MAP_CANDIDATES_MAX, roundKeyId, roundMapsOf, type RoundKey, type RoundMapConfig } from "@/lib/shared/round-maps";
import { visibleText } from "@/lib/shared/visible-text";

/** Comparaison des noms, comme le serveur (sans casse). */
function sameMap(a: string, b: string): boolean {
  return a.toLocaleLowerCase("fr") === b.toLocaleLowerCase("fr");
}

/** La carte est-elle déjà dans le créneau ? */
export function slotHasMap(slot: readonly string[], map: string): boolean {
  return slot.some((candidate) => sameMap(candidate, map));
}

/** Résultat d'un ajout : le créneau, ou le refus à dire en notification. */
export type SlotEdit = { slot: string[]; refused: null } | { slot: readonly string[]; refused: "EMPTY" | "TOO_LONG" | "POOL_FULL" };

/**
 * Ajoute une carte au créneau (saisie libre ou liste) : nom affichable, 64
 * caractères au plus, doublon ignoré, {@link ROUND_MAP_CANDIDATES_MAX} au plus.
 */
export function addMapToSlot(slot: readonly string[], raw: string): SlotEdit {
  const name = visibleText(raw);
  if (name === "") return { slot, refused: "EMPTY" };
  if ([...name].length > FIRST_MAP_MAX_LENGTH) return { slot, refused: "TOO_LONG" };
  if (slotHasMap(slot, name)) return { slot: [...slot], refused: null };
  if (slot.length >= ROUND_MAP_CANDIDATES_MAX) return { slot, refused: "POOL_FULL" };
  return { slot: [...slot, name], refused: null };
}

/** Retire une carte du créneau. */
export function removeMapFromSlot(slot: readonly string[], map: string): string[] {
  return slot.filter((candidate) => !sameMap(candidate, map));
}

/** Coche ou décoche une carte de la liste. */
export function toggleMapInSlot(slot: readonly string[], map: string): SlotEdit {
  return slotHasMap(slot, map) ? { slot: removeMapFromSlot(slot, map), refused: null } : addMapToSlot(slot, map);
}

/** Créneaux à envoyer : les vides écartés (le serveur fait de même). */
export function slotsToSave(slots: readonly (readonly string[])[]): string[][] {
  return slots.filter((slot) => slot.length > 0).map((slot) => [...slot]);
}

/** Créneaux à éditer pour un tour : son réglage, ou une carte vide à remplir. */
export function slotsToEdit(rounds: readonly RoundMapConfig[], round: RoundKey | null): string[][] {
  const saved = round ? (roundMapsOf(rounds, round)?.slots ?? []) : [];
  return saved.length > 0 ? saved.map((slot) => [...slot]) : [[]];
}

/** Deux réglages identiques (même ordre, même graphie) ? */
export function sameSlots(a: readonly (readonly string[])[], b: readonly (readonly string[])[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Tours dont le réglage serait **remplacé** par une copie de `slots` vers
 * `targets` : ceux qui en portent déjà un, différent. Rien à confirmer quand
 * la liste est vide.
 */
export function overwrittenRounds(
  rounds: readonly RoundMapConfig[],
  targets: readonly RoundKey[],
  slots: readonly (readonly string[])[],
): RoundKey[] {
  return targets.filter((target) => {
    const saved = roundMapsOf(rounds, target);
    return saved !== null && !sameSlots(saved.slots, slots);
  });
}

/** Le tour d'id `id` (`roundKeyId`) dans la liste, `null` s'il n'y est pas. */
export function findRound(rounds: readonly RoundKey[], id: string): RoundKey | null {
  return rounds.find((round) => roundKeyId(round) === id) ?? null;
}
