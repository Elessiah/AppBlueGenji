import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/server/auth";
import { DOCUMENT_REQUEST_HEADER } from "@/lib/shared/locales";

/**
 * Une mise en page de l'espace connecté doit-elle sérialiser son dictionnaire
 * anglais ? Seulement pour un **chargement complet** de page (et non une
 * requête du routeur : navigation, préchargement de lien, `router.refresh()`)
 * **d'un lecteur connecté**. `DOCUMENT_REQUEST_HEADER` est posé par le
 * middleware ; absent, chargement complet.
 *
 * Revue de performance du lot 9-2 : une réponse du routeur n'est jamais mise
 * en cache par le navigateur — la renvoyer à chaque navigation, préchargement
 * ou rafraîchissement la ferait payer chaque fois ; le client charge alors
 * l'anglais par son morceau (`english-loaders*.ts`), immuable et gardé par le
 * cache HTTP. Et sans session, `(secured)/layout.tsx` rend la carte « Connexion
 * requise » à la place des pages : Next rend tout de même les mises en page
 * filles, dont le dictionnaire partirait pour rien. `getCurrentUser` est
 * mémoïsé par requête : aucune lecture de plus.
 */
export async function isDocumentLoad(): Promise<boolean> {
  if ((await headers()).get(DOCUMENT_REQUEST_HEADER) === "0") return false;
  return (await getCurrentUser()) !== null;
}
