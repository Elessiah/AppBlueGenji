import { getDatabase } from "@/lib/server/database";
import { handleGetiIngest } from "@/lib/server/geti/ingest-route";
import { deleteGetiPosts } from "@/lib/server/geti/posts";
import { parseDeleteBody } from "@/lib/server/geti/wire";
import { SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";

/**
 * `POST /api/internal/geti/posts/delete` — appelé par le bot seul : les
 * messages supprimés sur Discord (un seul, ou une suppression en masse)
 * quittent le site aussitôt. Rend `{ removed }`, le nombre d'annonces
 * retirées ; un identifiant inconnu n'est pas une erreur.
 */
export function POST(req: Request) {
  return handleGetiIngest(req, SMALL_JSON_BODY_MAX_BYTES, async (body) => {
    const parsed = parseDeleteBody(body);
    if (typeof parsed === "string") return parsed;
    return { removed: await deleteGetiPosts(await getDatabase(), parsed.ids) };
  });
}
