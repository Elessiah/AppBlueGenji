import { storeImageBuffer } from "./image-upload";
import { fetchRemoteImage } from "./remote-image-fetch";
import { isLocalAvatarUrl } from "@/lib/shared/avatar";
import { parseRemoteImageUrl } from "@/lib/shared/remote-image";
import { toServedUploadUrl } from "@/lib/shared/uploads";

/**
 * Copier chez nous la photo de profil d'un compte Google.
 *
 * `createOrGetGoogleUser` rangeait l'URL de `picture` telle quelle dans
 * `bg_users.avatar_url`, et les écrans la rendaient en `unoptimized` — donc
 * chaque page portant cet avatar faisait partir une requête du navigateur du
 * **visiteur** vers `lh3.googleusercontent.com`. Ce n'est pas l'IP du titulaire
 * du compte qui fuitait, c'est celle de qui regarde, et à chaque vue.
 *
 * La règle du site est pourtant écrite depuis les logos partenaires : **le
 * `src` d'une image est toujours une adresse du site**
 * (`docs/features/SPONSOR_LOGO_PROXY.md`). Restaient deux façons de la tenir —
 * relayer à chaque affichage, comme pour les partenaires, ou copier une fois.
 *
 * **Copier l'emporte ici**, et pour des raisons que les partenaires n'ont pas :
 * un logo partenaire est modifiable à tout moment par le staff et doit suivre,
 * quand une photo de profil est acquise à la connexion ; ils sont six quand les
 * comptes sont des milliers, donc un relais par affichage ferait un aller-retour
 * serveur par avatar et par page ; et un avatar est déjà **soumis à un réglage
 * de visibilité**, qu'une route publique `/api/users/<id>/avatar` aurait dû
 * réimplémenter — une seconde porte à tenir, là où `visibleAvatarUrl` est
 * justement l'unique passage. Copié, l'avatar redevient un fichier d'upload
 * ordinaire : même service, même cache, même optimisation que celui qu'un
 * membre téléverse.
 */

/**
 * Faut-il aller chercher la photo distante de ce compte ?
 *
 * Seulement si l'avatar en place n'est **pas** un fichier à nous : compte sans
 * avatar, ou compte dont `avatar_url` porte encore une URL Google d'avant cette
 * correction — qui se répare donc à la première connexion.
 *
 * Le corollaire est le plus important : un avatar **téléversé** n'est jamais
 * écrasé. L'ancien code réécrivait `avatar_url = COALESCE(?, avatar_url)` à
 * chaque connexion Google, si bien qu'un membre qui choisissait sa photo sur
 * `/profil` la voyait remplacée par celle de Google au prochain passage par le
 * bouton de connexion. Le défaut préexistait ; il ne pouvait pas survivre à
 * cette correction, qui écrit un fichier là où l'ancienne ne changeait qu'un
 * pointeur — resservir Google à chaque connexion aurait laissé un fichier
 * orphelin par connexion, et l'effacer aurait détruit la photo choisie.
 *
 * Contrepartie assumée : une photo changée **côté Google** ne se propage plus
 * au site. Elle se change sur `/profil`, où l'on choisit déjà la sienne.
 */
export function shouldImportGoogleAvatar(currentAvatarUrl: string | null | undefined): boolean {
  return !isLocalAvatarUrl(currentAvatarUrl);
}

/**
 * Télécharge la photo et la range dans `public/uploads/avatars`.
 *
 * Ne lève **jamais** : une connexion ne doit pas échouer parce qu'un CDN
 * d'images est indisponible, qu'il répond un format que nous n'acceptons pas
 * (`fetchRemoteImage` admet GIF et AVIF, que `storeImageBuffer` refuse), ou que
 * le disque est plein. Le compte est alors simplement sans avatar, et l'écran
 * retombe sur sa pastille à initiale — la connexion, elle, aboutit.
 *
 * @param remoteUrl URL de la photo, telle que fournie par le fournisseur.
 * @param userId Compte destinataire ; repris dans le nom du fichier.
 * @returns L'URL servie (`/api/uploads/avatars/…`), ou `null` si rien n'a pu
 *   être copié.
 */
export async function importRemoteAvatar(
  remoteUrl: string | null | undefined,
  userId: number,
): Promise<string | null> {
  const url = parseRemoteImageUrl(remoteUrl);
  if (!url) return null;

  try {
    const fetched = await fetchRemoteImage(url);
    if (!fetched) return null;

    const diskPath = await storeImageBuffer(
      Buffer.from(fetched.body),
      fetched.contentType,
      "avatar",
      userId,
    );
    return toServedUploadUrl(diskPath);
  } catch {
    return null;
  }
}
