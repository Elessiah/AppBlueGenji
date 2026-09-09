import { toServedUploadUrl } from "./uploads";

/**
 * Adresse du logo d'un partenaire — **toujours** une adresse du site.
 *
 * Un logo est posé de deux façons : **importé** (normalisé en WebP 600×200 sous
 * `public/uploads/sponsors`, servi par `/api/uploads/...`) ou **collé** — une URL
 * quelconque saisie par le staff `showcase` dans le champ « … ou colle une URL ».
 * Les seconds étaient rendus tels quels, et c'est ce qui faisait tomber la note
 * « Bonnes pratiques » de l'accueil : quatre `<img>` vers quatre CDN étrangers
 * sur la page la plus vue du site, donc des **cookies tiers** posés au passage
 * (`__cf_bm`, `_cfuvid` de Cloudflare), des images livrées à leur taille
 * d'origine dans un emplacement de 400 px, dans un format que nous ne
 * choisissons pas, et une durée de cache décidée par autrui.
 *
 * `sponsorLogoSrc` est la porte unique : elle rend le chemin d'upload pour un
 * logo importé, et le chemin du relais (`/api/landing/sponsors/<id>/logo`) pour
 * un logo distant. Dans les deux cas l'image devient une image du site, donc
 * optimisable par `next/image` (redimensionnement, WebP, cache long) et sans
 * requête vers un tiers.
 *
 * Le relais est **borné par la base** : il ne prend qu'un identifiant de
 * partenaire et relit l'URL en base. Ce n'est donc pas un relais d'images
 * ouvert — l'espace des adresses atteignables est exactement celui des lignes
 * que le staff a créées.
 */

const UPLOAD_DISK_PREFIX = "/uploads/";
const UPLOAD_SERVED_PREFIX = "/api/uploads/";

/**
 * Chemin du relais pour le logo distant d'un partenaire.
 *
 * Le `?v=` n'est pas décoratif et la route l'ignore : c'est l'**optimiseur
 * d'images et le navigateur** qui le lisent, tous deux mettant en cache par
 * URL. Sans lui, le chemin ne dépendrait que de l'identifiant, qui ne change
 * pas quand le staff change l'URL du logo — la page continuerait d'afficher
 * l'ancienne image pendant les vingt-quatre heures annoncées par le relais,
 * alors même que la liste, elle, est rafraîchie sur-le-champ
 * (`invalidateShowcase`). Le rendu direct d'avant n'avait pas ce défaut :
 * l'adresse *était* le logo.
 */
export function sponsorLogoProxyPath(sponsorId: number, logoUrl: string): string {
  return `/api/landing/sponsors/${sponsorId}/logo?v=${logoVersion(logoUrl)}`;
}

/**
 * Empreinte courte et stable d'une URL de logo — FNV-1a 32 bits en base 36.
 *
 * Aucune propriété cryptographique n'est demandée : deux URL différentes
 * doivent seulement donner deux adresses différentes. Une collision se paierait
 * d'un logo périmé pendant une journée, jamais d'une fuite.
 */
export function logoVersion(logoUrl: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < logoUrl.length; i += 1) {
    hash ^= logoUrl.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Vrai si l'URL désigne un fichier que nous avons nous-mêmes stocké. */
export function isStoredSponsorLogo(logoUrl: string | null | undefined): boolean {
  if (!logoUrl) return false;
  return logoUrl.startsWith(UPLOAD_DISK_PREFIX) || logoUrl.startsWith(UPLOAD_SERVED_PREFIX);
}

/**
 * Adresse à mettre dans le `src` du logo, ou `null` s'il n'y en a pas.
 *
 * **Jamais une origine étrangère** : c'est tout l'objet du module, et ce n'est
 * une garantie que si elle vaut sur *toutes* les branches. Les partenaires de
 * secours (`FALLBACK_SPONSORS`, identifiants négatifs) ne sont pas en base, donc
 * le relais ne saurait rien y relire — la fonction rend `null`, et la case
 * retombe sur la plaque hachurée portant le nom, ce que font déjà les six.
 * Rendre l'URL brute les aurait fait passer à `next/image`, qui **lève** au
 * rendu faute de `remotePatterns` : donner un logo à un partenaire de secours
 * ressemble à une édition d'une ligne, elle aurait emporté l'accueil entier.
 */
export function sponsorLogoSrc(sponsor: { id: number; logoUrl: string | null }): string | null {
  const logoUrl = sponsor.logoUrl?.trim();
  if (!logoUrl) return null;
  if (isStoredSponsorLogo(logoUrl)) return toServedUploadUrl(logoUrl);
  if (!Number.isInteger(sponsor.id) || sponsor.id <= 0) return null;
  return sponsorLogoProxyPath(sponsor.id, logoUrl);
}

/**
 * Hôtes qu'un logo distant ne peut pas désigner.
 *
 * Le relais fait une requête **depuis le serveur**, là où le navigateur la
 * faisait depuis le poste du visiteur : une adresse interne devient donc
 * joignable, ce qu'elle n'était pas. L'URL vient du staff `showcase`, mais la
 * confiance qu'on lui accorde porte sur la vitrine, pas sur le réseau de la
 * machine — d'où ce filtre, posé sur le nom d'hôte littéral.
 */
export function isPrivateLogoHostname(hostname: string): boolean {
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
 * URL distante exploitable par le relais, ou `null`.
 *
 * `https` seulement : une image chargée en clair déclencherait de toute façon un
 * avertissement de contenu mixte côté navigateur, et le relais n'a pas à aller
 * chercher en clair ce que le site sert en chiffré.
 */
export function parseRemoteLogoUrl(logoUrl: string | null | undefined): URL | null {
  if (!logoUrl) return null;
  let url: URL;
  try {
    url = new URL(logoUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (isPrivateLogoHostname(url.hostname)) return null;
  return url;
}

/**
 * Types d'image que le relais accepte de renvoyer.
 *
 * SVG en est **volontairement absent** : un SVG est un document scriptable, et
 * le servir depuis notre origine reviendrait à laisser un tiers exécuter du
 * script sur `bluegenji-esport.fr`. Le format n'a jamais été accepté à l'import
 * non plus (`lib/server/image-upload.ts`).
 */
export const SPONSOR_LOGO_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

/** Type d'image renvoyable par le relais, ou `null` si l'en-tête ne convient pas. */
export function acceptedLogoContentType(header: string | null | undefined): string | null {
  if (!header) return null;
  const type = header.split(";")[0].trim().toLowerCase();
  return (SPONSOR_LOGO_CONTENT_TYPES as readonly string[]).includes(type) ? type : null;
}
