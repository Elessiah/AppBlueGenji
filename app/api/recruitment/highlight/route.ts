import { getHighlightedAd } from "@/lib/server/recruitment-service";

/**
 * Renvoie l'annonce urgente à mettre en avant sur le site (banderole ou modale),
 * ou `null`. Public, consommé par le composant client `RecruitmentHighlight`.
 */
export async function GET() {
  try {
    const ad = await getHighlightedAd();
    return Response.json({ ad });
  } catch (error) {
    console.error("Failed to fetch highlighted recruitment ad:", error);
    return Response.json({ ad: null }, { status: 500 });
  }
}
