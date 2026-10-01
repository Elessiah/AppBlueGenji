/**
 * Requête HTTPS dont l'adresse de connexion est **celle qu'on a jugée**.
 *
 * Le `fetch` intégré à Node résout le nom d'hôte lui-même, en se connectant :
 * le juger avant (`hostResolvesPublicly`) laisse une fenêtre, un serveur DNS
 * hostile à durée de vie nulle pouvant rendre une adresse publique au contrôle
 * puis `127.0.0.1` à la connexion (*DNS rebinding*). Le fermer demande de fixer
 * l'adresse dans l'agent HTTP, ce que `fetch` n'expose pas sans la dépendance
 * `undici`. `node:https` l'expose, par l'option `lookup` : la **même** fonction
 * résout le nom, juge chaque adresse, et c'est l'adresse qu'elle rend que le
 * socket utilise — il n'y a plus de seconde résolution.
 *
 * Le certificat est toujours vérifié contre le **nom** (SNI et contrôle du
 * certificat se font sur l'hôte de l'URL, pas sur l'adresse) : fixer l'adresse
 * ne relâche rien du chiffrement.
 *
 * Seuls les usages du relais d'images passent par ici — un GET, sans corps
 * envoyé, sans suivi de redirection (l'appelant les suit à la main), sans
 * décompression (aucun `Accept-Encoding` n'est envoyé).
 */
import { request } from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import { Readable } from "node:stream";

/** Résout un nom d'hôte en toutes ses adresses. */
export type AddressResolver = (hostname: string) => Promise<string[]>;

/** Code de l'erreur rendue quand une adresse résolue est refusée. */
export const PINNED_ADDRESS_REFUSED = "PINNED_ADDRESS_REFUSED";

export type PinnedRequestInit = {
  headers: Record<string, string>;
  signal: AbortSignal;
  /** Résolveur du nom. */
  resolve: AddressResolver;
  /** Vrai si l'adresse peut être contactée. Une seule refusée refuse tout. */
  isAllowedAddress: (address: string) => boolean;
};

/** Statuts qui n'ont jamais de corps : `Response` refuse d'en recevoir un. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/** Famille d'adresses demandée par le socket ; `0` = indifférente. */
function requestedFamily(family: number | string | undefined): 0 | 4 | 6 {
  if (family === 4 || family === "IPv4") return 4;
  if (family === 6 || family === "IPv6") return 6;
  return 0;
}

/**
 * La fonction `lookup` confiée au socket : résolution, jugement, puis
 * l'adresse (ou toutes, quand le socket tente plusieurs familles).
 */
export function pinnedLookup(
  resolve: AddressResolver,
  isAllowedAddress: (address: string) => boolean,
): LookupFunction {
  type LookupCallback = (error: unknown, address: string | { address: string; family: number }[], family?: number) => void;
  return ((hostname: string, options: { all?: boolean; family?: number | string }, callback: LookupCallback) => {
    const bare = hostname.replace(/^\[|\]$/g, "");
    resolve(bare).then(
      (addresses) => {
        if (addresses.length === 0 || !addresses.every(isAllowedAddress)) {
          const refused = Object.assign(new Error(PINNED_ADDRESS_REFUSED), { code: "EACCES" });
          callback(refused, options.all ? [] : "", 4);
          return;
        }
        const family = requestedFamily(options.family);
        const entries = addresses
          .map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 }))
          .filter((entry) => family === 0 || entry.family === family);
        if (entries.length === 0) {
          const missing = Object.assign(new Error(PINNED_ADDRESS_REFUSED), { code: "ENOTFOUND" });
          callback(missing, options.all ? [] : "", 4);
          return;
        }
        if (options.all) callback(null, entries);
        else callback(null, entries[0].address, entries[0].family);
      },
      (error: unknown) => callback(error, options.all ? [] : "", 4),
    );
  }) as unknown as LookupFunction;
}

/**
 * GET HTTPS, adresse de connexion fixée par `pinnedLookup`. Rend une `Response`
 * ordinaire, dont le corps est lu en flux ; l'abandon du signal détruit la
 * connexion, corps compris.
 */
export function pinnedHttpsGet(url: URL, init: PinnedRequestInit): Promise<Response> {
  return new Promise<Response>((resolveResponse, reject) => {
    const req = request(url, {
      method: "GET",
      headers: init.headers,
      signal: init.signal,
      lookup: pinnedLookup(init.resolve, init.isAllowedAddress),
      // Un agent par requête : un socket gardé en réserve par l'agent global
      // pourrait resservir une connexion ouverte sous d'autres conditions.
      agent: false,
    });
    req.on("response", (res) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(res.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) for (const item of value) headers.append(name, item);
        else headers.set(name, value);
      }
      const status = res.statusCode ?? 502;
      if (NULL_BODY_STATUSES.has(status)) {
        res.resume();
        resolveResponse(new Response(null, { status, headers }));
        return;
      }
      const body = Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>;
      try {
        resolveResponse(new Response(body, { status, headers }));
      } catch (error) {
        res.destroy();
        reject(error);
      }
    });
    req.on("error", reject);
    req.end();
  });
}
