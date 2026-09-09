import { enforceRateLimit, LANDING_READ_RULE, requestClientIp } from "@/lib/server/api-guard";
import { getSponsorLogoUrl } from "@/lib/server/sponsors-service";
import {
  acceptedLogoContentType,
  isStoredSponsorLogo,
  parseRemoteLogoUrl,
} from "@/lib/shared/sponsor-logo";

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
 */
export const dynamic = "force-dynamic";

/** Même plafond de taille qu'à l'import (`lib/server/image-upload.ts`). */
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
/**
 * Redirections suivies **à la main**, pour revalider l'hôte à chaque saut :
 * `fetch` les suit sinon jusqu'à n'importe quelle destination, ce qui rendrait
 * le filtre d'hôte contournable par une simple redirection.
 */
const MAX_REDIRECTS = 3;
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

  const fetched = await fetchLogo(remote);
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

type FetchedLogo = { body: ArrayBuffer; contentType: string };

/**
 * Va chercher l'image, en suivant au plus `MAX_REDIRECTS` redirections et en
 * revalidant l'hôte à chacune. Rend `null` sur le moindre accroc — délai
 * dépassé, hôte refusé, type non image, taille excessive.
 */
async function fetchLogo(url: URL): Promise<FetchedLogo | null> {
  let target = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(target, {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "image/*" },
        cache: "no-store",
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      let next: URL;
      try {
        next = new URL(location, target);
      } catch {
        return null;
      }
      const revalidated = parseRemoteLogoUrl(next.toString());
      if (!revalidated) return null;
      target = revalidated;
      continue;
    }

    if (!res.ok) return null;

    const contentType = acceptedLogoContentType(res.headers.get("content-type"));
    if (!contentType) return null;

    // Refus avant lecture quand le serveur annonce la taille ; le contrôle après
    // lecture reste nécessaire, un en-tête absent ou menteur étant possible.
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_LOGO_BYTES) return null;

    let body: ArrayBuffer;
    try {
      body = await res.arrayBuffer();
    } catch {
      return null;
    }
    if (body.byteLength === 0 || body.byteLength > MAX_LOGO_BYTES) return null;

    return { body, contentType };
  }

  return null;
}
