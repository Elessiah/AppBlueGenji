import { renderPageShareImage } from "@/lib/server/page-share-image";
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
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: Readonly<{ params: Promise<{ locale: string; card: string }> }>,
): Promise<Response> {
  const { locale, card } = await params;
  const parsed = parseShareImageSegments(locale, card);
  const image = parsed ? await renderPageShareImage(parsed.key, parsed.locale) : null;
  return image ?? new Response(null, { status: 404 });
}
