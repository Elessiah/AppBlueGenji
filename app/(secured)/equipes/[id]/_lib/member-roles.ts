import type { TeamRole } from "@/lib/shared/types";
import { SELF_ASSIGNABLE_ROLES } from "@/lib/shared/team-roles";

/**
 * Décisions des écrans de rôles de la fiche d'équipe (« Rôles », « Mes rôles »,
 * modale d'invitation), sorties des composants pour se tester sans navigateur.
 */

/** Mêmes rôles, sans égard à l'ordre ni aux doublons. */
export function sameRoleSet(a: readonly TeamRole[], b: readonly TeamRole[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((role) => right.has(role));
}

/**
 * Rôles à envoyer depuis la modale « Rôles » de la gestion, ou `null` si rien
 * n'a changé (aucun appel). Une sélection vide est permise (D71).
 */
export function memberRolesToSave(original: readonly TeamRole[], selected: readonly TeamRole[]): TeamRole[] | null {
  return sameRoleSet(original, selected) ? null : [...selected];
}

/**
 * Rôles de jeu à envoyer depuis « Mes rôles », ou `null` si rien n'a changé.
 * Seuls les rôles qu'un membre se donne lui-même partent (dans leur ordre) :
 * le serveur refuserait tout autre code (`ROLE_NOT_SELF_ASSIGNABLE`).
 */
export function ownGameRolesToSave(saved: readonly TeamRole[], selected: readonly TeamRole[]): TeamRole[] | null {
  const chosen = SELF_ASSIGNABLE_ROLES.filter((role) => selected.includes(role));
  const current = SELF_ASSIGNABLE_ROLES.filter((role) => saved.includes(role));
  return sameRoleSet(current, chosen) ? null : chosen;
}

/**
 * Suite d'une invitation envoyée depuis sa modale : sur un succès, le champ
 * pseudo se vide et la modale se ferme ; sur un refus **du pseudo**, la modale
 * se ferme pour montrer l'erreur sur le champ, qui garde sa saisie ; sur tout
 * autre refus (conflit, limite…), la modale reste ouverte avec sa sélection.
 */
export function invitationOutcome(
  ok: boolean,
  pseudoRefused: boolean,
): { clearPseudo: boolean; closeDialog: boolean; keepRoles: boolean } {
  // Pseudo refusé : la modale se ferme, mais les rôles cochés sont gardés pour
  // la rouvrir après correction de la faute de frappe.
  return { clearPseudo: ok, closeDialog: ok || pseudoRefused, keepRoles: !ok && pseudoRefused };
}

/**
 * Entrée sur une case à cocher d'un formulaire : le navigateur la prend pour un
 * envoi (soumission implicite). Une case se bascule à la barre d'espace ; on
 * n'envoie ni une invitation ni un changement de rôles sur un geste qui
 * voulait seulement la parcourir.
 */
export function isCheckboxEnter(key: string, target: unknown): boolean {
  if (key !== "Enter" || typeof target !== "object" || target === null || !("tagName" in target)) return false;
  const element = target as { tagName: string; type?: string };
  return element.tagName === "INPUT" && element.type === "checkbox";
}
