/** Relecture de la fiche échouée : l'écran reste sur l'état d'avant le geste (D4, outil resté français). */
export const PROFILE_RELOAD_FAILED_MESSAGE = "La fiche n'a pas pu être relue : recharge la page.";

/**
 * Refus de `/api/admin/users/[id]/roles` en phrase (outil resté français, D4) :
 * la notification affichait le code brut (`CANNOT_MODIFY_SELF`).
 */
const ROLES_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  UNAUTHORIZED: "Ta session a expiré : reconnecte-toi.",
  FORBIDDEN: "Tu n'as pas la permission d'attribuer des rôles.",
  INVALID_ID: "Ce compte est introuvable.",
  USER_NOT_FOUND: "Ce compte est introuvable.",
  CANNOT_MODIFY_SELF: "Tu ne peux pas modifier tes propres rôles.",
  INVALID_PAYLOAD: "La sélection de rôles est invalide.",
  ROLES_CHANGED: "Les rôles de ce compte ont changé entre-temps : relis-les avant d'enregistrer.",
  PROFILE_RELOAD_FAILED: PROFILE_RELOAD_FAILED_MESSAGE,
  // Les rôles sont enregistrés, seule la relecture a échoué : ne pas laisser croire le contraire.
  ROLES_SAVED_RELOAD_FAILED:
    "Rôles mis à jour, mais la fiche n'a pas pu être relue : recharge la page avant de modifier d'autres rôles.",
  CONCURRENT_UPDATE_RETRY: "Une autre modification de ce compte est passée au même moment : rien n'a été enregistré. Réessaie.",
};

export function rolesErrorMessage(code: string): string {
  return Object.hasOwn(ROLES_ERROR_MESSAGES, code)
    ? ROLES_ERROR_MESSAGES[code]
    : "La mise à jour des rôles a échoué.";
}
