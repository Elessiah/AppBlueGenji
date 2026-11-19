import { PROFILE_RELOAD_FAILED_MESSAGE } from "./roles-errors";

/** Refus de `/api/admin/users/[id]/planning-guest` en phrase (outil resté français, D4). */
const PLANNING_GUEST_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  UNAUTHORIZED: "Ta session a expiré : reconnecte-toi.",
  FORBIDDEN: "Tu n'as pas la permission de régler les invités.",
  INVALID_ID: "Ce compte est introuvable.",
  USER_NOT_FOUND: "Ce compte est introuvable.",
  CANNOT_MODIFY_SELF: "Tu ne peux pas te déclarer invité toi-même.",
  INVALID_PAYLOAD: "Le réglage envoyé est invalide.",
  PROFILE_RELOAD_FAILED: PROFILE_RELOAD_FAILED_MESSAGE,
  CONCURRENT_UPDATE_RETRY: "Une autre modification de ce compte est passée au même moment : rien n'a été enregistré. Réessaie.",
};

export function planningGuestErrorMessage(code: string): string {
  return Object.hasOwn(PLANNING_GUEST_ERROR_MESSAGES, code)
    ? PLANNING_GUEST_ERROR_MESSAGES[code]
    : "L'enregistrement du réglage « Invité » a échoué.";
}
