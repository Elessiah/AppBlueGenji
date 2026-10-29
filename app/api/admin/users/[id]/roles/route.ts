import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { publishRolesChange, setOwnPlatformRoles, setUserRoles } from "@/lib/server/users/roles";
import { can, isPlatformRole } from "@/lib/shared/permissions";
import { readJsonBody } from "@/lib/server/request-body";

/** Refus du service rendus tels quels, avec leur statut. */
const SERVICE_ERROR_STATUS: Readonly<Record<string, number>> = {
  USER_NOT_FOUND: 404,
  CANNOT_REMOVE_OWN_ADMIN: 400,
};

/**
 * Remplace l'ensemble des rôles de permission d'un utilisateur cible.
 *
 * Réservé aux administrateurs (rôle `ADMIN` ⇒ permission `roles`). Corps
 * attendu : `{ roles: PlatformRole[] }`.
 *
 * **Ses propres rôles** (ADMIN-SELF-ROLES) : un administrateur — colonne
 * `is_admin`, la seule qui fasse un administrateur — règle ses rôles cumulables
 * depuis « Mon profil », mais ne retire jamais son propre `ADMIN`
 * (`CANNOT_REMOVE_OWN_ADMIN`) : se retirer l'administration reste le geste d'un
 * autre administrateur, sans quoi le dernier d'entre eux fermerait la
 * plateforme. Tout autre compte reste refusé en `CANNOT_MODIFY_SELF`.
 *
 * Tout enregistrement réussi est noté au journal du staff
 * (`publishRolesChange` : anonyme sur Discord, nominatif dans pm2).
 *
 * @returns `200 { roles }` (liste normalisée), ou une erreur `401`
 *   (non authentifié), `403` (`FORBIDDEN` : non admin, ou administration
 *   retirée à l'auteur pendant l'enregistrement), `400`
 *   (`INVALID_ID` / `INVALID_PAYLOAD` / `CANNOT_MODIFY_SELF` /
 *   `CANNOT_REMOVE_OWN_ADMIN`) ou `404` (`USER_NOT_FOUND`).
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  // `can(user, "roles")` et non `user.isAdmin` : la permission n'est accordée
  // qu'à `ADMIN`, les deux tests sont donc équivalents — mais la règle du
  // projet est qu'un domaine se protège par sa permission (§1.4 de
  // `docs/AUTHORIZATION_RULES.md`), et la suppression d'un tournoi doit rester
  // le seul endroit qui déroge.
  if (!can(user, "roles")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) return fail("INVALID_ID", 400);

  const self = targetId === user.id;
  // Sur son propre compte, la colonne `is_admin` décide, pas le cumul lu par
  // `can()` : c'est elle que l'écriture conditionne (`setOwnPlatformRoles`).
  if (self && !user.isAdmin) return fail("CANNOT_MODIFY_SELF", 400);

  const body = (await readJsonBody(req).catch(() => null)) as { roles?: unknown } | null;
  if (!Array.isArray(body?.roles) || !body.roles.every(isPlatformRole)) {
    return fail("INVALID_PAYLOAD", 400);
  }
  if (self && !body.roles.includes("ADMIN")) return fail("CANNOT_REMOVE_OWN_ADMIN", 400);

  try {
    const roles = self ? await setOwnPlatformRoles(user.id, body.roles) : await setUserRoles(targetId, body.roles, user.id);
    publishRolesChange({ id: user.id, pseudo: user.pseudo }, targetId, roles);
    return ok({ roles });
  } catch (e) {
    const msg = (e as Error).message;
    // Administration retirée par un autre entre la lecture de la session et
    // l'écriture — sur son compte comme sur celui d'un autre : le geste n'est
    // plus permis, il se refuse comme tel.
    if (msg === "NOT_ADMIN") return fail("FORBIDDEN", 403);
    return Object.hasOwn(SERVICE_ERROR_STATUS, msg)
      ? fail(msg, SERVICE_ERROR_STATUS[msg])
      : fail("ROLES_UPDATE_FAILED", 500);
  }
}
