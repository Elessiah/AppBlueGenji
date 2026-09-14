import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { setUserRoles } from "@/lib/server/users-service";
import { can, isPlatformRole } from "@/lib/shared/permissions";

/**
 * Remplace l'ensemble des rôles de permission d'un utilisateur cible.
 *
 * Réservé aux administrateurs (rôle `ADMIN` ⇒ permission `roles`). Corps
 * attendu : `{ roles: PlatformRole[] }`. Un administrateur ne peut pas modifier
 * ses propres rôles afin d'éviter tout auto-verrouillage de la plateforme.
 *
 * @returns `200 { roles }` (liste normalisée), ou une erreur `401`
 *   (non authentifié), `403` (non admin), `400`
 *   (`INVALID_ID` / `INVALID_PAYLOAD` / `CANNOT_MODIFY_SELF`) ou `404`
 *   (`USER_NOT_FOUND`).
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

  // Un admin ne peut pas modifier ses propres rôles (évite tout auto-verrouillage).
  if (targetId === user.id) return fail("CANNOT_MODIFY_SELF", 400);

  const body = (await req.json().catch(() => null)) as { roles?: unknown } | null;
  if (!Array.isArray(body?.roles) || !body.roles.every(isPlatformRole)) {
    return fail("INVALID_PAYLOAD", 400);
  }

  try {
    const roles = await setUserRoles(targetId, body.roles);
    return ok({ roles });
  } catch (e) {
    const msg = (e as Error).message;
    const status = msg === "USER_NOT_FOUND" ? 404 : 500;
    return fail(msg || "ROLES_UPDATE_FAILED", status);
  }
}
