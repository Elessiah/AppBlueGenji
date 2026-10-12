import { headers } from "next/headers";
import { DOCUMENT_REQUEST_HEADER } from "@/lib/shared/locales";

/**
 * La requête est-elle un **chargement complet** de page (et non une requête du
 * routeur : navigation, préchargement de lien, `router.refresh()`) ?
 * `DOCUMENT_REQUEST_HEADER` est posé par le middleware ; absent, oui.
 *
 * Une mise en page qui sérialise un dictionnaire ne le fait qu'au chargement
 * complet (revue de performance du lot 9-2) : une réponse du routeur n'est
 * jamais mise en cache par le navigateur, et la renvoyer à chaque navigation,
 * préchargement ou rafraîchissement la ferait payer chaque fois. Le client
 * charge alors l'anglais par son morceau (`english-loaders.ts`), un fichier
 * immuable que le cache HTTP garde d'une visite à l'autre, et ne le charge
 * qu'une fois par session.
 */
export async function isDocumentLoad(): Promise<boolean> {
  return (await headers()).get(DOCUMENT_REQUEST_HEADER) !== "0";
}
