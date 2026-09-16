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
 * Le filtre porte sur le **nom d'hôte littéral**. Il ne prétend pas résoudre le
 * nom : un domaine public qui pointe vers une adresse interne passerait. Ce
 * qu'il ferme, c'est l'adresse écrite en clair dans l'URL — la forme qu'a
 * toujours une tentative d'atteindre le réseau de la machine, service de
 * métadonnées compris.
 */
export function isPrivateImageHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return true;

  // IPv6 : bouclage, lien-local (fe80::/10) et adresses uniques locales (fc00::/7).
  if (host === "::1" || host === "::") return true;
  // Formes développées : `0:0:0:0:0:0:0:1` (bouclage) et `0:0:0:0:0:0:0:0`
  // (adresse indéterminée) ne correspondent à aucune abréviation ci-dessus.
  if (/^(0+:){7}0*1?$/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  // IPv4 encapsulée en IPv6 (`::ffff:127.0.0.1`).
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (mapped) return isPrivateIpv4(mapped[1]);

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateIpv4(host);
  return false;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // lien-local, dont le service de métadonnées cloud
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast et réservé
  return false;
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
