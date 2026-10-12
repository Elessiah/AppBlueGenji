import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/server/auth";
import { messagesFor } from "@/lib/server/i18n-messages";
import { DOCUMENT_REQUEST_HEADER, type Locale } from "@/lib/shared/locales";
import type { Messages } from "@/lib/shared/i18n-messages";

/**
 * Une mise en page de l'espace connecté doit-elle sérialiser son dictionnaire
 * anglais ? Seulement pour un **chargement complet** de page (et non une
 * requête du routeur : navigation, préchargement de lien, `router.refresh()`)
 * **d'un lecteur connecté**. `DOCUMENT_REQUEST_HEADER` est posé par le
 * middleware ; il faut qu'il dise `"1"` : absent ou autre, rien n'est
 * sérialisé (revue de sécurité du lot 9-2). Une requête qui échappe au
 * `matcher` (préchargement d'une route française) garde ses en-têtes tels que
 * le client les a écrits : un `"1"` forgé n'y fait recevoir, à lui seul, que le
 * dictionnaire public de la langue qu'il a lui-même forgée — rien de privé.
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
  if ((await headers()).get(DOCUMENT_REQUEST_HEADER) !== "1") return false;
  return (await getCurrentUser()) !== null;
}

/**
 * Le dictionnaire anglais qu'une mise en page de l'espace connecté sérialise :
 * `pick(messages)` sous `/en` au chargement complet d'un lecteur connecté
 * ({@link isDocumentLoad}), `undefined` sinon — le client lit alors son
 * français, ou charge l'anglais par son morceau. Seule porte d'entrée, pour
 * qu'aucun écran n'oublie la règle.
 */
export async function englishOnDocumentLoad<T>(locale: Locale, pick: (messages: Messages) => T): Promise<T | undefined> {
  if (locale !== "en" || !(await isDocumentLoad())) return undefined;
  return pick(messagesFor("en"));
}
