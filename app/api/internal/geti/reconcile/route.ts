import { getDatabase } from "@/lib/server/database";
import { GETI_INGEST_BODY_MAX_BYTES, handleGetiIngest } from "@/lib/server/geti/ingest-route";
import { reconcileGetiChannel } from "@/lib/server/geti/posts";
import { parseReconcileBody } from "@/lib/server/geti/wire";

/**
 * `POST /api/internal/geti/reconcile` — appelé par le bot seul, à la fin du
 * rattrapage d'un salon : `{ channelId, since, until, ids }`, tous les
 * messages que Discord porte encore entre `since` et `until`. Une annonce
 * gardée sur cette fenêtre et absente de `ids` a été supprimée pendant que le
 * bot n'écoutait pas : elle est retirée. Rend `{ removed }`.
 */
export function POST(req: Request) {
  return handleGetiIngest(req, GETI_INGEST_BODY_MAX_BYTES, async (body) => {
    const parsed = parseReconcileBody(body);
    if (typeof parsed === "string") return parsed;
    return { removed: await reconcileGetiChannel(await getDatabase(), parsed) };
  });
}
