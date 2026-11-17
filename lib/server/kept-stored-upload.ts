import { isStoredUploadIn, type UploadFolder } from "@/lib/shared/uploads";
import { storedUploadExists } from "@/lib/server/stored-upload-cleanup";

/**
 * L'adresse d'image reçue par un ajout, gardée telle quelle, sauf si elle
 * désigne un fichier de `folder` qui n'existe plus : rendue alors `null`. Un
 * ajout **rejoué** après la suppression de la ligne (qui a effacé son image)
 * la recréerait sinon sur une image absente, que plus rien n'effacerait.
 *
 * Vaut aussi pour un premier ajout : l'adresse d'un téléversement n'est rendue
 * au client qu'une fois le fichier écrit, une image du dossier absente du
 * disque ne s'afficherait donc nulle part — la garder ne servirait à rien.
 *
 * @returns la valeur d'origine si c'est une chaîne gardée, sinon `null`.
 */
export async function keptStoredUpload(value: unknown, folder: UploadFolder): Promise<string | null> {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (isStoredUploadIn(url, folder) && !(await storedUploadExists(url, folder))) return null;
  return value;
}
