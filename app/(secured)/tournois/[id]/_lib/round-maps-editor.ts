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

/**
 * Numéro (1, 2…) du premier créneau vide suivi d'un créneau rempli, `null`
 * sinon : l'enregistrer écarterait le vide et décalerait les cartes suivantes
 * (la carte 3 deviendrait la carte 2). Seuls les vides de fin s'écartent.
 */
export function slotGap(slots: readonly (readonly string[])[]): number | null {
  const lastFilled = slots.findLastIndex((slot) => slot.length > 0);
  const gap = slots.findIndex((slot, index) => slot.length === 0 && index < lastFilled);
  return gap === -1 ? null : gap + 1;
}

/**
 * Une touche Entrée dans la liste des cartes (recherche, case) ne doit pas
 * envoyer le formulaire du tour : elle enregistrerait une saisie à moitié faite.
 * La saisie libre, qui a son propre « Ajouter », se charge de la touche elle-même.
 */
export function blocksImplicitSubmit(key: string, inputType: string | null): boolean {
  return key === "Enter" && inputType !== null && inputType !== "text";
}

/** Tours découpés en lots d'au plus `size` (une écriture par lot). */
export function chunkRounds<T>(rounds: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < rounds.length; start += size) chunks.push(rounds.slice(start, start + size));
  return chunks;
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
 * Des cartes saisies et pas encore enregistrées pour ce tour ? Les créneaux
 * vides ne comptent pas (rien à perdre) ; changer de tour les abandonnerait.
 */
export function slotsDirty(
  slots: readonly (readonly string[])[],
  rounds: readonly RoundMapConfig[],
  round: RoundKey | null,
): boolean {
  const saved = round ? (roundMapsOf(rounds, round)?.slots ?? []) : [];
  return !sameSlots(slotsToSave(slots), saved);
}

/**
 * Créneaux à garder quand l'instantané change pendant que la fenêtre est
 * ouverte (un autre membre du staff, ou son propre enregistrement) : la saisie
 * suit le réglage du serveur tant qu'elle n'a pas été modifiée (`before`), ou
 * quand elle vaut déjà le nouveau réglage (`after`, son propre envoi : les
 * créneaux vides écartés et renumérotés comme au serveur). Une saisie en cours
 * n'est jamais écrasée ; rien ne bouge si le réglage de ce tour n'a pas changé.
 */
export function resyncSlots(
  current: readonly (readonly string[])[],
  before: readonly RoundMapConfig[],
  after: readonly RoundMapConfig[],
  round: RoundKey | null,
): readonly (readonly string[])[] {
  const savedBefore = round ? (roundMapsOf(before, round)?.slots ?? []) : [];
  const savedAfter = round ? (roundMapsOf(after, round)?.slots ?? []) : [];
  if (sameSlots(savedBefore, savedAfter)) return current;
  if (slotsDirty(current, before, round) && slotsDirty(current, after, round)) return current;
  return slotsToEdit(after, round);
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

/**
 * Numéro (1, 2…) du premier créneau **de trop** : celui qui porte la carte
 * au-delà de `max` (les créneaux vides ne comptent pas, ils sont écartés à
 * l'envoi). `null` si le tour tient dans `max`, ou sans plafond.
 */
export function slotOverMax(slots: readonly (readonly string[])[], max: number | null): number | null {
  if (max === null) return null;
  let filled = 0;
  for (const [index, slot] of slots.entries()) {
    if (slot.length === 0) continue;
    filled += 1;
    if (filled > max) return index + 1;
  }
  return null;
}

/**
 * Premier tour cible qui ne peut pas porter `count` cartes : `limitOf` rend son
 * plafond effectif (`null` : sans plafond). `null` si tous les tours tiennent.
 */
export function firstTargetOverMax<T>(targets: readonly T[], count: number, limitOf: (target: T) => number | null): T | null {
  for (const target of targets) {
    const limit = limitOf(target);
    if (limit !== null && count > limit) return target;
  }
  return null;
}

/**
 * Indice du voisin qui reprend le focus quand l'élément `removed` disparaît d'une
 * liste de `remaining` éléments restants : le suivant, ou le dernier. `null`
 * quand il n'en reste aucun (le focus va alors à l'élément qui porte la liste).
 */
export function focusIndexAfterRemoval(removed: number, remaining: number): number | null {
  return remaining <= 0 ? null : Math.min(Math.max(removed, 0), remaining - 1);
}

/**
 * Tour vers lequel se rabattre quand celui qui est affiché (`roundId`) a quitté
 * la liste — un autre membre du staff a changé le format, le plateau a été
 * régénéré — ou n'a jamais existé. `null` : rien à faire. L'identifiant rendu
 * est celui du premier tour, `""` quand il n'y en a plus.
 */
export function vanishedRoundFallback(rounds: readonly RoundKey[], roundId: string): string | null {
  if (findRound(rounds, roundId) !== null) return null;
  const first = rounds[0];
  if (!first) return roundId === "" ? null : "";
  return roundKeyId(first);
}

/** Deux listes de tours désignent-elles les mêmes tours, dans le même ordre ? */
export function sameRoundKeys(a: readonly RoundKey[], b: readonly RoundKey[]): boolean {
  return a.length === b.length && a.every((round, index) => roundKeyId(round) === roundKeyId(b[index]));
}

/** Empreinte des cartes enregistrées de tous les tours : change quand elles changent, pas à chaque instantané. */
export function storedRoundsSignature(rounds: readonly RoundMapConfig[]): string {
  return JSON.stringify(rounds);
}
