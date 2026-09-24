import { getRecruitmentSpotlight } from "@/lib/server/recruitment-service";

// La mise en avant change rarement et la réponse est identique pour tous les
// visiteurs : on autorise une mise en cache publique courte (navigateur/CDN)
// pour éviter une requête DB à chaque appel. `stale-while-revalidate` sert
// l'ancienne valeur pendant le rafraîchissement en arrière-plan. Un changement
// admin est donc répercuté en ~1 min au plus.
const CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

/**
 * Renvoie les annonces mises en avant sur le site : `modal` (prioritaires,
 * modale d'arrivée) et `banner` (prioritaires puis importantes, banderole).
 * Public. Le premier rendu ne passe plus par ici — la mise en page racine lit
 * le service directement —, la route reste pour qui veut l'état sans page.
 */
export async function GET() {
  try {
    const spotlight = await getRecruitmentSpotlight();
    return Response.json(spotlight, { headers: { "Cache-Control": CACHE_CONTROL } });
  } catch (error) {
    console.error("Failed to fetch recruitment spotlight:", error);
    // En erreur, on ne met pas en cache pour ne pas figer un état dégradé.
    return Response.json(
      { modal: [], banner: [] },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
