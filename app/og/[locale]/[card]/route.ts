import { renderEmbedShareImage } from "@/lib/server/embed-share-image";
import { renderPageShareImage } from "@/lib/server/page-share-image";
import { isLocale } from "@/lib/shared/locales";
import { parseShareImageSegments } from "@/lib/shared/page-share-cards";

/**
 * Image d'aperçu d'une page : `/og/<langue>/<clé>.png`
 * (`docs/features/SHARE_METADATA.md` § « Une carte par page »).
 *
 * Une route unique plutôt qu'un `opengraph-image` par dossier : la convention
 * de Next résout l'adresse de l'image sur le segment de la route, le même sous
 * `/regles` et sous `/en/regles` (réécriture) — la page anglaise aurait pointé
 * sur la carte française. Ici la langue est dans le chemin, et
 * `pageMetadata({ shareCard, locale })` désigne la bonne.
 *
 * L'extension `.png` fait aussi passer la requête à côté du middleware (son
 * `matcher` écarte les images) : pas de nonce ni de CSP à fabriquer pour un
 * robot d'aperçu. Clé ou langue inconnue : 404.
 *
 * Un tournoi (`tournament-<id>`) ou un match (`tournament-<tid>-match-<mid>`) partagé a
 * sa propre carte, tirée de la réponse publique (`SHARE_EMBEDS.md`).
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: Readonly<{ params: Promise<{ locale: string; card: string }> }>,
): Promise<Response> {
  const { locale, card } = await params;
  if (isLocale(locale) && card.endsWith(".png")) {
    // `null` : pas une clé de tournoi ni de match (la clé n'est lue qu'une fois, ici).
    // `?v=` ne décide que de l'en-tête de cache (`renderEmbedShareImage`).
    const requested = new URL(request.url).searchParams.get("v");
    const embed = await renderEmbedShareImage(card.slice(0, -".png".length), locale, requested);
    if (embed) return embed;
  }
  const parsed = parseShareImageSegments(locale, card);
  const image = parsed ? await renderPageShareImage(parsed.key, parsed.locale) : null;
  return image ?? new Response(null, { status: 404 });
}
