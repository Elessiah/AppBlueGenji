import { getDatabase } from "@/lib/server/database";
import { notifyGetiAlerts, type GetiAlertPost } from "@/lib/server/geti/alerts";
import { GETI_INGEST_BODY_MAX_BYTES, handleGetiIngest } from "@/lib/server/geti/ingest-route";
import { upsertGetiPosts } from "@/lib/server/geti/posts";
import { parseUpsertBody } from "@/lib/server/geti/wire";

/**
 * `POST /api/internal/geti/posts` — appelé par le bot seul (jeton
 * `SITE_INTERNAL_TOKEN`, boucle locale) : un lot d'annonces des six salons
 * sources, créées, modifiées ou relues au rattrapage. Chacune est analysée ici
 * et remplace la version gardée. Rend des **nombres** : `stored`, `emptied`
 * (sans texte), `expired` (hors de la durée de garde de sa catégorie : 7 jours pour un scrim, 14 sinon), `rejected` (forme
 * inattendue). Les annonces récentes sont ensuite confrontées aux alertes
 * (`docs/features/GETI_INFO.md` § Alertes).
 */
export function POST(req: Request) {
  return handleGetiIngest(req, GETI_INGEST_BODY_MAX_BYTES, async (body) => {
    const parsed = parseUpsertBody(body);
    if (typeof parsed === "string") return parsed;
    const stored: GetiAlertPost[] = [];
    const outcome = await upsertGetiPosts(await getDatabase(), parsed.posts, Date.now(), (post, analysis) => {
      stored.push({
        messageId: post.messageId,
        category: post.category,
        parsed: analysis,
        postedAt: post.postedAt,
        editedAt: post.editedAt,
      });
    });
    // Les alertes partent après la réponse : le bot n'attend pas un push ni un
    // message privé (`notifyGetiAlerts` ne lève jamais).
    if (stored.length > 0) void notifyGetiAlerts(stored);
    return { ...outcome, rejected: parsed.rejected };
  });
}
