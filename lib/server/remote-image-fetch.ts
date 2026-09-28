import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  acceptedRemoteImageContentType,
  isPrivateImageHostname,
  parseRemoteImageUrl,
} from "@/lib/shared/remote-image";
import { pinnedHttpsGet } from "@/lib/server/pinned-https";

/**
 * Aller chercher une image sur une origine étrangère, sans lui laisser le
 * volant.
 *
 * Deux appelants, un seul code : le **relais des logos partenaires**
 * (`/api/landing/sponsors/[id]/logo`, à chaque affichage) et l'**import de la
 * photo d'un compte Google** (`user-avatar-import.ts`, une fois à la
 * connexion). La fonction vivait dans la route du relais ; deux copies auraient
 * divergé, et la divergence se serait vue du mauvais côté — celui où une garde
 * manque.
 *
 * Elle rend `null` au moindre accroc, jamais une exception : pour l'appelant,
 * « l'hôte a refusé », « ce n'est pas une image » et « c'est trop gros » sont
 * le même fait — il n'y a pas d'image à cette adresse.
 */

/** Même plafond de taille qu'à l'import (`lib/server/image-upload.ts`). */
export const MAX_REMOTE_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
/** Agent annoncé aux hébergeurs d'images. */
export const REMOTE_IMAGE_USER_AGENT = "BlueGenji-ImageRelay/1.0";
/**
 * Redirections suivies **à la main**, pour revalider l'hôte à chaque saut :
 * `fetch` les suit sinon jusqu'à n'importe quelle destination, ce qui rendrait
 * le filtre d'hôte contournable par une simple redirection.
 */
const MAX_REDIRECTS = 3;

export type FetchedRemoteImage = { body: ArrayBuffer; contentType: string };

/** Résout un nom d'hôte en toutes ses adresses. */
export type HostResolver = (hostname: string) => Promise<string[]>;

const resolveWithSystem: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

/**
 * Vrai si le nom d'hôte désigne une adresse **publique**, une fois résolu.
 *
 * Le filtre de `parseRemoteImageUrl` ne juge que ce qui est écrit dans l'URL :
 * un domaine public dont l'enregistrement DNS pointe vers `127.0.0.1` passait.
 * Chaque adresse rendue par le résolveur est donc jugée par le même prédicat —
 * une seule adresse interne suffit à refuser, le client HTTP pouvant choisir
 * n'importe laquelle. Une résolution qui échoue est un refus.
 *
 * Ce contrôle préalable refuse tôt, sans ouvrir de socket ; il ne suffirait
 * pas seul — un client HTTP qui résout **de nouveau** le nom en se connectant
 * laisserait un serveur DNS hostile répondre autre chose la seconde fois
 * (*rebinding*). D'où la connexion par `pinnedHttpsGet`, dont le socket
 * n'utilise que les adresses que ce même jugement vient d'accepter.
 */
export async function hostResolvesPublicly(
  hostname: string,
  resolve: HostResolver = resolveWithSystem,
): Promise<boolean> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  // Une adresse littérale a déjà été jugée par `parseRemoteImageUrl`.
  if (isIP(bare) !== 0) return !isPrivateImageHostname(bare);
  let addresses: string[];
  try {
    addresses = await resolve(bare);
  } catch {
    return false;
  }
  return addresses.length > 0 && addresses.every((address) => !isPrivateImageHostname(address));
}

export type FetchRemoteImageOptions = {
  /** Plafond de taille. Défaut : `MAX_REMOTE_IMAGE_BYTES`. */
  maxBytes?: number;
  /** Délai couvrant en-têtes **et** corps, par saut. Défaut : 5 s. */
  timeoutMs?: number;
  /** Redirections suivies au plus. Défaut : 3. */
  maxRedirects?: number;
  /** Résolveur DNS. Défaut : celui du système (`dns.lookup`). */
  resolveHost?: HostResolver;
};

/**
 * Va chercher l'image, en suivant au plus `maxRedirects` redirections et en
 * revalidant l'hôte à chacune — nom écrit **et** adresses résolues.
 *
 * @param url URL déjà passée par `parseRemoteImageUrl`.
 * @returns Les octets et le type retenu, ou `null` sur le moindre refus.
 */
export async function fetchRemoteImage(
  url: URL,
  options: FetchRemoteImageOptions = {},
): Promise<FetchedRemoteImage | null> {
  const maxBytes = options.maxBytes ?? MAX_REMOTE_IMAGE_BYTES;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const resolveHost = options.resolveHost ?? resolveWithSystem;

  let target = url;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!(await hostResolvesPublicly(target.hostname, resolveHost))) return null;
    const controller = new AbortController();
    // Le minuteur couvre **aussi la lecture du corps**, et pas seulement les
    // en-têtes : un hôte qui répond aussitôt puis distille ses octets sans fin
    // tiendrait sinon le gestionnaire indéfiniment — le plafond de taille n'est
    // vérifié qu'une fois la lecture achevée, il n'aurait jamais l'occasion de
    // servir. D'où un unique `clearTimeout`, en sortie de saut.
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res: Response;
      try {
        // Pas le `fetch` intégré : il résoudrait le nom une seconde fois en se
        // connectant. `pinnedHttpsGet` connecte le socket à l'adresse que le
        // jugement vient d'accepter, et ne suit aucune redirection.
        res = await pinnedHttpsGet(target, {
          signal: controller.signal,
          // `node:https` n'envoie aucun `User-Agent`, là où `fetch` envoyait
          // `node` : certains hébergeurs (Wikimedia, des règles Cloudflare)
          // refusent une requête qui n'en porte pas, et le logo disparaîtrait
          // sans bruit.
          headers: { Accept: "image/*", "User-Agent": REMOTE_IMAGE_USER_AGENT },
          resolve: resolveHost,
          isAllowedAddress: (address) => !isPrivateImageHostname(address),
        });
      } catch {
        return null;
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
        const revalidated = parseRemoteImageUrl(next.toString());
        if (!revalidated) return null;
        target = revalidated;
        continue;
      }

      if (!res.ok) return null;

      const contentType = acceptedRemoteImageContentType(res.headers.get("content-type"));
      if (!contentType) return null;

      // Refus avant lecture quand le serveur annonce la taille ; le contrôle
      // après lecture reste nécessaire, un en-tête absent ou menteur étant
      // possible.
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) return null;

      let body: ArrayBuffer;
      try {
        body = await res.arrayBuffer();
      } catch {
        return null;
      }
      if (body.byteLength === 0 || body.byteLength > maxBytes) return null;

      return { body, contentType };
    } finally {
      clearTimeout(timer);
      // Referme le saut, quoi qu'il advienne. Sur les chemins de refus (statut
      // non 2xx, type non image, taille annoncée excessive, redirection sans
      // destination) la réponse est abandonnée sans que son corps ait été lu :
      // la connexion resterait occupée jusqu'au ramasse-miettes, et c'est le
      // chemin le plus chaud — un logo distant qui répond 404 y passe à chaque
      // page vue, l'optimiseur ne mettant pas les erreurs amont en cache. Sur
      // le chemin nominal, le corps est déjà entièrement matérialisé :
      // abandonner le flux après coup ne coûte rien.
      controller.abort();
    }
  }

  return null;
}
