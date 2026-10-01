/**
 * Ce qu'une image venue d'ailleurs doit franchir avant d'entrer chez nous.
 *
 * Deux endroits du site vont chercher une image sur une origine étrangère, et
 * ils n'ont rien d'autre en commun : le **relais des logos partenaires**
 * (`/api/landing/sponsors/[id]/logo`, à chaque affichage) et l'**import de la
 * photo d'un compte Google** (`lib/server/user-avatar-import.ts`, une fois à la
 * connexion). Les deux posent pourtant les mêmes questions — cette URL est-elle
 * exploitable, cet hôte est-il le nôtre, ce type est-il bien une image — et les
 * règles vivaient dans `sponsor-logo.ts`, sous des noms qui parlaient de logos.
 *
 * Elles sont ici, sous des noms qui parlent d'images distantes ;
 * `sponsor-logo.ts` les réexporte sous ses anciens noms, si bien que rien de ce
 * qui s'appuyait dessus n'a bougé.
 *
 * Le danger qu'elles couvrent est propre à ce sens de circulation : la requête
 * part **du serveur**, là où le navigateur la faisait depuis le poste du
 * visiteur. Une adresse interne devient donc joignable, ce qu'elle n'était pas.
 */

/**
 * Hôtes qu'une image distante ne peut pas désigner.
 *
 * Le filtre porte sur le **nom d'hôte littéral** ; l'adresse que ce nom résout
 * est contrôlée à part, au moment d'aller la chercher
 * (`lib/server/remote-image-fetch.ts`), par le même prédicat.
 *
 * Une adresse IPv6 est **analysée**, jamais reconnue à sa forme écrite : le
 * parseur d'URL réécrit `[::ffff:127.0.0.1]` en `[::ffff:7f00:1]`, et une regex
 * qui attendait la forme pointée laissait passer la seconde — donc la machine
 * elle-même. D'où `parseIpv6`, qui ramène toutes les écritures d'une adresse
 * aux mêmes huit groupes, et des plages jugées sur ces groupes.
 */
export function isPrivateImageHostname(hostname: string): boolean {
  // `localhost.` (point final) est le même nom que `localhost` pour le résolveur.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, ""); // NOSONAR typescript:S8786 — nom d'hôte déjà analysé par URL, court
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return true;

  if (host.includes(":")) {
    const groups = parseIpv6(host);
    // Une adresse IPv6 illisible n'est pas une adresse qu'on sait juger.
    return groups === null ? true : isPrivateIpv6(groups);
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateIpv4(host);
  return false;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // lien-local, dont le service de métadonnées cloud
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 0) return true; // réservé IETF
  if (a === 198 && (b === 18 || b === 19)) return true; // bancs d'essai
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast et réservé
  return false;
}

/** IPv4 portée par deux groupes de 16 bits d'une adresse IPv6. */
function embeddedIpv4(high: number, low: number): string {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

/**
 * Verdict des familles IPv6 qui portent (ou remplacent) une IPv4 : `null`
 * quand l'adresse n'appartient à aucune d'elles.
 */
function embeddedFamilyVerdict(g: number[]): boolean | null {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
  const zeroPrefix = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  // `::/96` : indéterminée, bouclage et IPv4 « compatible » (`::7f00:1`),
  // toutes obsolètes ou locales — rien de public ne s'y écrit.
  if (zeroPrefix && g5 === 0) return true;
  // `::ffff:0:0/96` : IPv4 encapsulée, jugée sur l'IPv4 qu'elle porte.
  if (zeroPrefix && g5 === 0xffff) return isPrivateIpv4(embeddedIpv4(g6, g7));
  // `64:ff9b::/96` : NAT64 bien connu, jugé sur l'IPv4 traduite ; et
  // `64:ff9b:1::/48`, sa variante d'usage local.
  if (g0 === 0x64 && g1 === 0xff9b) {
    if (g2 === 1) return true;
    if (g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isPrivateIpv4(embeddedIpv4(g6, g7));
  }
  // `2002::/16` : 6to4, l'IPv4 suit le préfixe.
  if (g0 === 0x2002) return isPrivateIpv4(embeddedIpv4(g1, g2));
  return null;
}

function isPrivateIpv6(g: number[]): boolean {
  const embedded = embeddedFamilyVerdict(g);
  if (embedded !== null) return embedded;
  const [g0, g1, g2, g3] = g;
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // `100::/64`, poubelle
  if ((g0 & 0xfe00) === 0xfc00) return true; // `fc00::/7`, adresses uniques locales
  if ((g0 & 0xffc0) === 0xfe80) return true; // `fe80::/10`, lien-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // `fec0::/10`, site-local (obsolète)
  if ((g0 & 0xff00) === 0xff00) return true; // `ff00::/8`, multicast
  return false;
}

/**
 * Les huit groupes de 16 bits d'une adresse IPv6, ou `null` si elle est
 * illisible. Accepte l'abréviation `::`, une IPv4 pointée en queue et un
 * identifiant de zone (`%eth0`), ignoré.
 */
export function parseIpv6(raw: string): number[] | null {
  let text = raw.toLowerCase();
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  // IPv4 pointée en queue : convertie en deux groupes.
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    const parts = dotted[2].split(".").map(Number);
    if (parts.some((p) => p > 255)) return null;
    text = `${dotted[1]}${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (side === "") return [];
    const out: number[] = [];
    for (const group of side.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(Number.parseInt(group, 16));
    }
    return out;
  };
  const head = parseSide(halves[0]);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = parseSide(halves[1]);
  if (!tail) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/**
 * URL distante exploitable, ou `null`.
 *
 * `https` seulement : une image chargée en clair déclencherait de toute façon un
 * avertissement de contenu mixte côté navigateur, et nous n'avons pas à aller
 * chercher en clair ce que le site sert en chiffré.
 */
export function parseRemoteImageUrl(rawUrl: string | null | undefined): URL | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (isPrivateImageHostname(url.hostname)) return null;
  return url;
}

/**
 * Types d'image acceptés d'une origine étrangère.
 *
 * SVG en est **volontairement absent** : un SVG est un document scriptable, et
 * le servir depuis notre origine reviendrait à laisser un tiers exécuter du
 * script sur `bluegenji-esport.fr`. Le format n'a jamais été accepté à l'import
 * non plus (`lib/server/image-upload.ts`).
 */
export const REMOTE_IMAGE_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

/** Type d'image exploitable, ou `null` si l'en-tête ne convient pas. */
export function acceptedRemoteImageContentType(header: string | null | undefined): string | null {
  if (!header) return null;
  const type = header.split(";")[0].trim().toLowerCase();
  return (REMOTE_IMAGE_CONTENT_TYPES as readonly string[]).includes(type) ? type : null;
}
