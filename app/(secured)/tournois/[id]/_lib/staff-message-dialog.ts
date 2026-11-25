import {
  normalizeStaffMessage,
  STAFF_MESSAGE_CATEGORIES,
  STAFF_MESSAGE_MAX_LENGTH,
  type StaffMessageCategory,
  type StaffMessageRecipientCounts,
} from "@/lib/shared/tournament-staff-message";

/**
 * Règles de la fenêtre « Message aux participants » de la fiche
 * (`docs/features/TOURNAMENT_STAFF_MESSAGE.md` § Depuis le site) : cases des
 * catégories, ce qui part au serveur, et ce qui retient l'envoi. Sans React.
 */

/** Les catégories nommées, sans « Tous ». */
const GROUPS: readonly StaffMessageCategory[] = STAFF_MESSAGE_CATEGORIES.filter((category) => category !== "ALL");

/** Ouverture : tout le monde, comme le menu du bot. */
export function initialStaffMessageCategories(): Set<StaffMessageCategory> {
  return new Set(STAFF_MESSAGE_CATEGORIES);
}

/**
 * Une case cochée ou décochée. « Tous » coche (ou décoche) toutes les cases ;
 * décocher une catégorie décoche « Tous » ; cocher la dernière qui manquait
 * coche « Tous » — les cases disent toujours ce qui partira.
 */
export function toggleStaffMessageCategory(
  selected: ReadonlySet<StaffMessageCategory>,
  category: StaffMessageCategory,
  checked: boolean,
): Set<StaffMessageCategory> {
  if (category === "ALL") return checked ? initialStaffMessageCategories() : new Set();
  const next = new Set(selected);
  if (checked) next.add(category);
  else next.delete(category);
  if (GROUPS.every((group) => next.has(group))) next.add("ALL");
  else next.delete("ALL");
  return next;
}

/** Ce que reçoit le serveur : `ALL` seul s'il est coché, sinon les cases dans l'ordre du menu. */
export function staffMessageRequestCategories(selected: ReadonlySet<StaffMessageCategory>): StaffMessageCategory[] {
  if (selected.has("ALL")) return ["ALL"];
  return GROUPS.filter((group) => selected.has(group));
}

/** Personnes que le message atteindra (message privé ou push) : celles qui n'ont pas coupé le sujet. */
export function staffMessageAudience(counts: StaffMessageRecipientCounts): number {
  return Math.max(0, counts.total - counts.optedOut);
}

/** Longueur affichée au compteur : celle que le serveur mesure (texte rogné, en caractères). */
export function staffMessageLength(message: string): number {
  return [...(normalizeStaffMessage(message) ?? "")].length;
}

export type StaffMessageBlocker = "noCategory" | "empty" | "tooLong" | "counting" | "nobody";

/**
 * Pourquoi « Envoyer » reste retenu, ou `null`. Le décompte doit être là (et
 * à jour des cases) : on n'envoie pas sans savoir à combien de personnes.
 */
export function staffMessageBlocker(input: {
  message: string;
  categories: ReadonlySet<StaffMessageCategory>;
  counts: StaffMessageRecipientCounts | null;
}): StaffMessageBlocker | null {
  if (input.categories.size === 0) return "noCategory";
  const length = staffMessageLength(input.message);
  if (length === 0) return "empty";
  if (length > STAFF_MESSAGE_MAX_LENGTH) return "tooLong";
  if (input.counts === null) return "counting";
  if (staffMessageAudience(input.counts) === 0) return "nobody";
  return null;
}

/** Délai avant de recompter après une case cochée : une rafale de clics ne fait qu'une requête. */
export const STAFF_MESSAGE_COUNT_DEBOUNCE_MS = 300;
