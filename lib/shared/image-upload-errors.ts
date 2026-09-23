/**
 * Les refus d'un **téléversement d'image**, dits en français.
 *
 * Ils naissent tous au même endroit (`processAndStoreImage`,
 * `lib/server/image-upload.ts`), quel que soit l'écran qui envoie le fichier :
 * logo d'équipe, avatar de profil. Chaque écran les traduisait donc — ou ne les
 * traduisait pas : la fiche d'équipe les disait en français pendant que
 * `/profil` affichait `IMAGE_TOO_LARGE` en capitales dans sa notification, pour
 * le même fichier refusé par la même fonction.
 *
 * Une seule rédaction, consultée par les registres de chaque écran **avant**
 * leur repli : ce que le joueur doit corriger (le poids, le format) ne dépend
 * pas de la page où il a choisi son image.
 *
 * Module **pur**. Les bornes sont celles du serveur (`lib/shared/uploads.ts`),
 * jamais recopiées : une phrase qui annonce « 5 Mo » doit suivre la limite.
 */

import { IMAGE_UPLOAD_MAX_BYTES, IMAGE_UPLOAD_MIME_TYPES } from "./uploads";

const ACCEPTED_TYPES: ReadonlySet<string> = new Set(IMAGE_UPLOAD_MIME_TYPES);

const IMAGE_UPLOAD_ERRORS: Record<string, string> = {
  FILE_MISSING: "Aucune image reçue. Choisis un fichier.",
  IMAGE_TOO_LARGE: `Image trop lourde : ${IMAGE_UPLOAD_MAX_BYTES / (1024 * 1024)} Mo au maximum.`,
  IMAGE_FORMAT_INVALID: "Format non reconnu : PNG, JPEG ou WebP seulement.",
  IMAGE_DIMENSIONS_INVALID: "Dimensions d'image non prises en charge.",
  IMAGE_ANIMATED_NOT_SUPPORTED: "Les images animées ne sont pas acceptées.",
};

/**
 * La phrase d'un refus d'image, ou `null` si le code n'en est pas un.
 *
 * `null` et non un repli : c'est à l'écran de dire ce qui a échoué quand ce
 * n'est pas l'image — un envoi de logo et un envoi d'avatar ne ratent pas de la
 * même façon.
 */
export function imageUploadErrorMessage(code: string | null | undefined): string | null {
  return isImageUploadError(code) ? IMAGE_UPLOAD_ERRORS[code] : null;
}

/**
 * Le code est-il un refus d'image nommé ?
 *
 * Sert aux routes de téléversement, qui ne laissent sortir que ces codes-là :
 * tout autre échec (décodage, disque) porte un message interne qui n'a rien à
 * faire dans une réponse.
 */
export function isImageUploadError(code: string | null | undefined): code is string {
  // `code in` remonterait la chaîne de prototypes (« constructor »).
  return !!code && Object.prototype.hasOwnProperty.call(IMAGE_UPLOAD_ERRORS, code);
}

/**
 * Le refus qu'un fichier choisi recevrait du serveur, décidé **avant** l'envoi.
 *
 * Le contrôle client ne remplace pas celui du serveur (qui relit l'image
 * elle-même, pas son type déclaré) ; il épargne un aller-retour, et surtout il
 * dit **laquelle** des deux conditions manque — « trop lourde ou format non
 * supporté » laissait le joueur deviner.
 */
export function precheckImageUpload(file: { type: string; size: number }): string | null {
  if (!ACCEPTED_TYPES.has(file.type)) return "IMAGE_FORMAT_INVALID";
  if (file.size > IMAGE_UPLOAD_MAX_BYTES) return "IMAGE_TOO_LARGE";
  return null;
}
