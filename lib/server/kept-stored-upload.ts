import { isStoredUploadIn, type UploadFolder } from "@/lib/shared/uploads";
import { storedUploadExists } from "@/lib/server/stored-upload-cleanup";

/**
 * L'adresse d'image reçue par un ajout, gardée (rognée), sauf si elle
 * désigne un fichier de `folder` qui n'existe plus : rendue alors `null`. Un
 * ajout **rejoué** après la suppression de la ligne (qui a effacé son image)
 * la recréerait sinon sur une image absente, que plus rien n'effacerait.
 *
 * Vaut aussi pour un premier ajout : l'adresse d'un téléversement n'est rendue
 * au client qu'une fois le fichier écrit, une image du dossier absente du
 * disque ne s'afficherait donc nulle part — la garder ne servirait à rien.
 *
 * Le disque est consulté sur le chemin seul : une adresse servie avec une
 * requête ou une ancre (`?v=2`, copie anti-cache) désigne le même fichier.
 * Une adresse hors du dossier (ou qui en sort par `..`) n'est jamais lue sur
 * disque (`isStoredUploadIn`) : la validation de la ligne en décide.
 *
 * Reste la fenêtre propre au nettoyage des fichiers (`stored-upload-cleanup.ts`) :
 * une suppression qui a relu les références avant l'insertion efface le
 * fichier après ce contrôle — celle d'un geste du staff, acceptée là-bas.
 *
 * @returns l'adresse rognée si elle est gardée, sinon `null`.
 */
export async function keptStoredUpload(value: unknown, folder: UploadFolder): Promise<string | null> {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (!isStoredUploadIn(url, folder)) return url;
  const filePath = url.split(/[?#]/, 1)[0];
  return (await storedUploadExists(filePath, folder)) ? url : null;
}
