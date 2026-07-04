import { getCurrentUser } from "@/lib/server/auth";
import { fail } from "@/lib/server/http";
import { exportOwnData } from "@/lib/server/users-service";

/**
 * Export RGPD des données personnelles (droit à la portabilité, art. 20).
 * Réservé au propriétaire du compte : ne renvoie que les données de
 * l'utilisateur authentifié, jamais celles d'un tiers. Livré en pièce jointe
 * JSON téléchargeable.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  try {
    const data = await exportOwnData(user.id);
    const body = JSON.stringify(data, null, 2);
    const filename = `bluegenji-donnees-${user.id}.json`;

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "PROFILE_NOT_FOUND") return fail(message, 404);
    return fail(message || "EXPORT_FAILED", 400);
  }
}
