import { getHighlightedAd } from "@/lib/server/recruitment-service";

// L'annonce mise en avant change rarement et la réponse est identique pour tous
// les visiteurs : on autorise une mise en cache publique courte (navigateur/CDN)
// pour éviter une requête DB à chaque chargement de page. `stale-while-revalidate`
// sert l'ancienne valeur pendant le rafraîchissement en arrière-plan. Un
// changement admin est donc répercuté en ~1 min au plus.
const CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

/**
 * Renvoie l'annonce urgente à mettre en avant sur le site (banderole ou modale),
 * ou `null`. Public, consommé par le composant client `RecruitmentHighlight`.
 */
export async function GET() {
  try {
    const ad = await getHighlightedAd();
    return Response.json({ ad }, { headers: { "Cache-Control": CACHE_CONTROL } });
  } catch (error) {
    console.error("Failed to fetch highlighted recruitment ad:", error);
    // En erreur, on ne met pas en cache pour ne pas figer un état dégradé.
    return Response.json({ ad: null }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
