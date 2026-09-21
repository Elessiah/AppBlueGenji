/**
 * Ce que la suppression du compte connecté **ferait**.
 *
 * Lecture seule, et séparée de `GET /api/profile` par la même raison qui sépare
 * déjà l'état Discord : la réponse ne change pas quand la fiche change, et la
 * calculer à chaque chargement du profil ferait trois `EXISTS` pour une question
 * que presque personne ne pose. L'écran l'appelle sur le chemin de la
 * suppression, juste avant de demander confirmation.
 *
 * Aucun verbe d'écriture ici : la suppression reste `DELETE /api/profile`, qui
 * repose la question sur son propre instantané — cette route informe, elle ne
 * réserve rien.
 */
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { getAccountDeletionMode } from "@/lib/server/users-service";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  return ok({ mode: await getAccountDeletionMode(user.id) });
}
