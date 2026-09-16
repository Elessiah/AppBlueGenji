import { enforceRateLimit, LANDING_READ_RULE, requestClientIp } from "@/lib/server/api-guard";
import { fetchRemoteImage } from "@/lib/server/remote-image-fetch";
import { getSponsorLogoUrl } from "@/lib/server/sponsors-service";
import { isStoredSponsorLogo, parseRemoteLogoUrl } from "@/lib/shared/sponsor-logo";

/**
 * Relais du logo distant d'un partenaire — la seule façon dont une image
 * hébergée ailleurs entre dans la page d'accueil.
 *
 * Le staff `showcase` peut coller une URL quelconque en guise de logo. Rendue
 * telle quelle, elle faisait quatre requêtes vers quatre CDN étrangers sur la
 * page la plus vue du site : cookies tiers posés au passage, images à leur
 * taille d'origine dans un emplacement de 400 px, durée de cache décidée par
 * autrui. Relayée ici, la même image devient une image du site — donc
 * redimensionnée et convertie par `next/image`, et sans requête vers un tiers.
 *
 * Ce n'est **pas** un relais d'images ouvert : la route ne prend qu'un
 * identifiant de partenaire et relit l'URL en base. L'espace des adresses
 * atteignables est exactement celui des lignes que le staff a créées.
 *
 * Tout refus est un **404**, jamais un 500 : une ligne dont l'URL ne convient
 * pas et un identifiant qui n'existe pas sont, pour le navigateur, le même fait
 * — il n'y a pas d'image à cette adresse.
 *
 * Le téléchargement lui-même vit dans `lib/server/remote-image-fetch.ts` : la
 * photo de profil d'un compte Google passe par les mêmes gardes, et deux copies
 * auraient divergé.
 */
export const dynamic = "force-dynamic";

/**
 * Durée de cache annoncée à l'optimiseur d'images, qui la respecte : un logo
 * distant n'est donc rechargé qu'une fois par jour et par variante, et non à
 * chaque visite — sans quoi le relais aurait remplacé quatre requêtes du
 * navigateur par quatre requêtes du serveur, à chaque page vue.
 *
 * Ce qu'elle ne retarde **pas**, c'est l'édition : le `?v=` posé par
 * `sponsorLogoProxyPath` change avec l'URL du logo, donc un logo remplacé
 * s'affiche aussitôt sous une autre adresse. La route, elle, ignore ce
 * paramètre — c'est l'optimiseur et le navigateur qui le lisent.
 */
const CACHE_SECONDS = 86_400;

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const throttled = enforceRateLimit(LANDING_READ_RULE, requestClientIp(req));
  if (throttled) return throttled;

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return notFound();

  let logoUrl: string | null;
  try {
    logoUrl = await getSponsorLogoUrl(id);
  } catch {
    return notFound();
  }
  // Un logo importé est déjà servi par `/api/uploads/...` : `sponsorLogoSrc` y
  // renvoie directement, et le relais n'a rien à faire d'un fichier à nous.
  if (!logoUrl || isStoredSponsorLogo(logoUrl)) return notFound();

  const remote = parseRemoteLogoUrl(logoUrl);
  if (!remote) return notFound();

  const fetched = await fetchRemoteImage(remote);
  if (!fetched) return notFound();

  return new Response(new Uint8Array(fetched.body), {
    headers: {
      "Content-Type": fetched.contentType,
      "Content-Length": String(fetched.body.byteLength),
      "Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
      // L'octet vient d'un tiers : on interdit au navigateur de deviner un type
      // plus permissif que celui qu'on annonce, et on prive la ressource de tout
      // droit (script, requête) si elle venait à être ouverte directement.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
