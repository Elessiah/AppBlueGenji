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
};

export function rolesErrorMessage(code: string): string {
  return Object.hasOwn(ROLES_ERROR_MESSAGES, code)
    ? ROLES_ERROR_MESSAGES[code]
    : "La mise à jour des rôles a échoué.";
}
