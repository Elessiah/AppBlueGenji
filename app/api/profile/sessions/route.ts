/**
 * Les autres sessions ouvertes du compte connecté.
 *
 * `GET` les compte, `DELETE` les ferme toutes sauf celle qui fait la demande —
 * le « déconnecter mes autres appareils » de `/profil`. Une session volée
 * restait sinon valide trente jours sans que la victime ait de quoi la fermer.
 */
import { countOtherSessions, getCurrentUser, revokeOtherSessions } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  try {
    return ok({ otherSessions: await countOtherSessions(user.id) });
  } catch (error) {
    console.error("[sessions] lecture impossible", error);
    return fail("SESSIONS_READ_FAILED", 500);
  }
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  try {
    return ok({ revoked: await revokeOtherSessions(user.id) });
  } catch (error) {
    console.error("[sessions] fermeture impossible", error);
    return fail("SESSIONS_REVOKE_FAILED", 500);
  }
}
