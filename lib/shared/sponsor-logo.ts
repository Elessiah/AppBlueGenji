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
 * Les gardes ci-dessous ne sont plus écrites ici.
 *
 * Elles ne parlaient de logos que par accident de naissance : un import de
 * photo de profil Google (`lib/server/user-avatar-import.ts`) pose exactement
 * les mêmes questions — cette URL est-elle exploitable, cet hôte est-il le
 * nôtre, ce type est-il bien une image. Elles vivent donc dans
 * `lib/shared/remote-image.ts`, sous des noms qui parlent d'images distantes.
 *
 * Les anciens noms restent exportés d'ici : c'est le vocabulaire du relais
 * partenaires, que sa route et ses tests emploient, et rien n'obligeait à le
 * réécrire pour déplacer une implémentation.
 */
export {
  isPrivateImageHostname as isPrivateLogoHostname,
  parseRemoteImageUrl as parseRemoteLogoUrl,
  acceptedRemoteImageContentType as acceptedLogoContentType,
  REMOTE_IMAGE_CONTENT_TYPES as SPONSOR_LOGO_CONTENT_TYPES,
} from "./remote-image";
