import { MATCH_DM_SETTINGS_PATH } from "@/lib/shared/discord-notifications";
import {
  normalizeStaffMessage,
  STAFF_MESSAGE_CATEGORIES,
  STAFF_MESSAGE_ERRORS,
  STAFF_MESSAGE_MAX_LENGTH,
  staffMessageRefusal,
  type StaffMessageCategory,
  type StaffMessageDelivery,
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
  /** Le message privé rendu dépasserait le plafond du bot ({@link staffMessageRenderedTooLong}). */
  renderedTooLong?: boolean;
}): StaffMessageBlocker | null {
  if (input.categories.size === 0) return "noCategory";
  const length = staffMessageLength(input.message);
  if (length === 0) return "empty";
  if (length > STAFF_MESSAGE_MAX_LENGTH || input.renderedTooLong === true) return "tooLong";
  if (input.counts === null) return "counting";
  if (staffMessageAudience(input.counts) === 0) return "nobody";
  return null;
}

/** Délai avant de recompter après une case cochée : une rafale de clics ne fait qu'une requête. */
export const STAFF_MESSAGE_COUNT_DEBOUNCE_MS = 300;

/**
 * Le message privé rendu (citation, échappement, en-tête, liens) dépasserait-il
 * le plafond du bot dans l'une des deux langues ? Même règle que le serveur
 * (`staffMessageRefusal`), les liens bâtis sur l'adresse du site ouvert : un
 * texte sous 1 200 caractères mais fait de lignes courtes ou de caractères
 * échappés est retenu avant l'envoi, au lieu d'un refus après confirmation.
 */
export function staffMessageRenderedTooLong(
  message: string,
  tournament: { id: number; name: string },
  origin: string,
): boolean {
  const text = normalizeStaffMessage(message) ?? "";
  if (text.length === 0) return false;
  const refusal = staffMessageRefusal({
    tournamentName: tournament.name,
    message: text,
    tournamentUrl: `${origin}/tournois/${tournament.id}`,
    settingsUrl: `${origin}${MATCH_DM_SETTINGS_PATH}`,
  });
  return refusal === STAFF_MESSAGE_ERRORS.messageTooLong;
}

/** Refus du serveur qui désignent le champ du texte (`useFieldErrors`). */
export const STAFF_MESSAGE_FIELD_ERRORS = {
  [STAFF_MESSAGE_ERRORS.emptyMessage]: "message",
  [STAFF_MESSAGE_ERRORS.messageTooLong]: "message",
} as const;

/**
 * Ce que dit la notification après un envoi :
 * - `pending` — l'envoi continue (ou un lot reste sans réponse du bot) : ne pas renvoyer ;
 * - `nothingDelivered` — rien n'a été remis (ni message privé, ni push) : une erreur, pas un succès ;
 * - `botUnreachable` — bot injoignable, des push sont partis ;
 * - `sent` — le bilan ordinaire.
 */
export type StaffMessageSendOutcome = "pending" | "nothingDelivered" | "botUnreachable" | "sent";

export function staffMessageSendOutcome(delivery: StaffMessageDelivery): StaffMessageSendOutcome {
  if (delivery.pending) return "pending";
  if (delivery.sent + delivery.pushed === 0) return "nothingDelivered";
  if (delivery.botUnreachable) return "botUnreachable";
  return "sent";
}

/**
 * Code du client quand l'envoi n'a pas rendu de réponse lisible (réseau coupé,
 * `502`/`504` du serveur frontal) : le message a pu partir.
 */
export const STAFF_MESSAGE_OUTCOME_UNKNOWN = "STAFF_MESSAGE_OUTCOME_UNKNOWN";

/**
 * L'envoi a-t-il pu partir malgré l'échec ? Réponse illisible, ou panne du
 * serveur (`INTERNAL_ERROR`) qui a pu survenir en plein envoi : la fenêtre se
 * ferme sur « peut-être parti », pour qu'on ne renvoie pas d'un clic.
 */
export function staffMessageSendMayHaveGoneOut(code: string): boolean {
  return code === STAFF_MESSAGE_OUTCOME_UNKNOWN || code === "INTERNAL_ERROR";
}
