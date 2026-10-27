import type { AuthUser } from "@/lib/server/auth";

/**
 * Ce que le navigateur apprend de la session par `GET /api/auth/me` : qui
 * (identifiant, pseudo) et ce qu'il peut faire (`isAdmin`, `roles`, lus par
 * `can()` sur les écrans de gestion des tournois). Une forme **explicite**,
 * jamais `AuthUser` entier : les drapeaux internes de la session
 * (`certifyPromptDue`, modale de recrutement), l'âge déclaré et les
 * identifiants de fournisseur (`discordId`, `googleSub`) n'ont pas de lecteur
 * côté client, et un champ ajouté demain à `AuthUser` ne sortira pas sans
 * qu'on l'écrive ici.
 */
export type PublicSessionUser = Pick<AuthUser, "id" | "pseudo" | "isAdmin" | "roles">;

/** Forme publique d'un utilisateur de session (voir {@link PublicSessionUser}). */
export function publicSessionUser(user: AuthUser): PublicSessionUser {
  return { id: user.id, pseudo: user.pseudo, isAdmin: user.isAdmin, roles: user.roles };
}
