/**
 * Lecture **bornée** du corps d'une requête.
 *
 * `req.json()` et `req.formData()` lisent tout le corps en mémoire avant le
 * moindre contrôle : le plafond de 5 Mo d'une image n'était vérifié qu'après
 * lecture complète du multipart, et une route anonyme (`/api/csp-report`,
 * `/api/visits`, `/api/reports`, la connexion) acceptait n'importe quelle
 * taille — sur un Raspberry Pi. La seule borne était `client_max_body_size`
 * dans nginx, configuration non versionnée, partagée avec un autre site, et
 * forcément assez large pour les images.
 *
 * Deux gardes, parce qu'un corps se présente de deux façons :
 *
 * - un `Content-Length` annoncé au-delà de la borne est refusé **sans rien
 *   lire** ;
 * - le corps est ensuite lu **en flux**, et la lecture s'arrête — flux annulé —
 *   dès qu'elle dépasse la borne : un envoi fragmenté (`Transfer-Encoding:
 *   chunked`), qui n'annonce aucune taille, ne passe pas davantage.
 *
 * Le refus est une exception `PAYLOAD_TOO_LARGE` : les routes qui avalaient
 * déjà un corps illisible (`.catch(() => ({}))`) l'avalent de la même façon, et
 * le traitent comme un corps vide — ce qui est exactement ce qu'on veut d'un
 * corps qu'on a refusé de lire.
 */
import { enforceRateLimit, IMAGE_UPLOAD_RULE } from "@/lib/server/api-guard";
import { fail } from "@/lib/server/http";
import { UNSUPPORTED_CONTENT_TYPE, isJsonContentType } from "@/lib/shared/request-origin";

/** Code d'erreur levé au-delà de la borne. */
export const PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE";

/**
 * Borne par défaut d'un corps JSON. Aucune route n'en attend autant — le plus
 * gros champ libre est la description d'un tournoi, stockée en `TEXT`
 * (64 Kio) — mais une borne trop juste casserait une saisie légitime sans bruit.
 */
export const JSON_BODY_MAX_BYTES = 256 * 1024;

/**
 * Borne des corps JSON des routes **anonymes** (connexion, visites, rapports
 * CSP, signalements) : quelques champs courts, la plus longue saisie étant la
 * description d'un signalement (4 000 caractères).
 */
export const SMALL_JSON_BODY_MAX_BYTES = 32 * 1024;

/**
 * Borne d'un téléversement d'image : le plafond du fichier
 * (`IMAGE_UPLOAD_MAX_BYTES`, 5 Mio) plus l'enveloppe du multipart (limites,
 * en-têtes de partie, champ de recadrage). C'est aussi la valeur minimale de
 * `client_max_body_size` dans nginx (`docs/DEPLOYMENT.md`).
 */
export const IMAGE_UPLOAD_BODY_MAX_BYTES = 5 * 1024 * 1024 + 256 * 1024;

function payloadTooLarge(): Error {
  return new Error(PAYLOAD_TOO_LARGE);
}

/**
 * Lit le corps brut, au plus `maxBytes` octets.
 *
 * @throws PAYLOAD_TOO_LARGE Taille annoncée ou lue au-delà de la borne.
 */
export async function readBodyBytes(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) throw payloadTooLarge();
  if (!req.body) return new Uint8Array(new ArrayBuffer(0));

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Annuler plutôt que drainer : le reste du corps n'est jamais lu.
      await reader.cancel().catch(() => undefined);
      throw payloadTooLarge();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * `req.json()`, borné. Rejette comme lui sur un corps illisible — et sur un
 * corps qui n'est pas **déclaré** en JSON (`isJsonContentType`), sans rien lire.
 *
 * `req.json()` ne regardait pas le `Content-Type` : un
 * `<form enctype=text/plain>` dont le nom de champ reconstitue un JSON était
 * lu comme un envoi de l'écran. Le contrôle de provenance du middleware ferme
 * déjà ce formulaire sur tout navigateur qui pose `Sec-Fetch-Site` ou
 * `Origin` ; celui-ci le ferme même sans eux, là où le corps est lu.
 *
 * @throws PAYLOAD_TOO_LARGE Au-delà de `maxBytes`.
 * @throws UNSUPPORTED_CONTENT_TYPE Corps non déclaré en JSON.
 */
export async function readJsonBody(req: Request, maxBytes: number = JSON_BODY_MAX_BYTES): Promise<unknown> {
  if (!isJsonContentType(req.headers.get("content-type"))) throw new Error(UNSUPPORTED_CONTENT_TYPE);
  const bytes = await readBodyBytes(req, maxBytes);

  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * `req.formData()`, borné. Le corps lu est rendu à l'analyseur de la
 * plateforme avec son `Content-Type` (qui porte la limite du multipart).
 *
 * @throws PAYLOAD_TOO_LARGE Au-delà de `maxBytes`.
 */
export async function readFormDataBody(
  req: Request,
  maxBytes: number = IMAGE_UPLOAD_BODY_MAX_BYTES,
): Promise<FormData> {
  const bytes = await readBodyBytes(req, maxBytes);
  const contentType = req.headers.get("content-type") ?? "";
  return new Response(bytes, { headers: { "content-type": contentType } }).formData();
}

/** Vrai si l'erreur est le refus d'un corps trop lourd. */
export function isPayloadTooLarge(error: unknown): boolean {
  return error instanceof Error && error.message === PAYLOAD_TOO_LARGE;
}

/**
 * Le formulaire d'un **téléversement d'image**, ou la réponse de refus à rendre
 * telle quelle : plafond de débit par compte (`IMAGE_UPLOAD_RULE`), puis
 * lecture bornée. Un corps trop lourd se dit `IMAGE_TOO_LARGE`, comme un
 * fichier trop lourd — c'est le même fait pour la personne qui l'envoie, et
 * l'écran le traduit déjà ; un corps illisible reste `FILE_MISSING`.
 */
export async function readImageUploadForm(req: Request, userId: number): Promise<FormData | Response> {
  const limited = enforceRateLimit(IMAGE_UPLOAD_RULE, userId);
  if (limited) return limited;
  try {
    return await readFormDataBody(req);
  } catch (error) {
    return fail(isPayloadTooLarge(error) ? "IMAGE_TOO_LARGE" : "FILE_MISSING", 400);
  }
}
