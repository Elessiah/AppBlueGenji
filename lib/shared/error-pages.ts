/**
 * Textes des pages d'erreur du site (`app/not-found.tsx`, `app/error.tsx`,
 * `app/global-error.tsx`).
 *
 * Sans ces fichiers, Next rendait ses propres pages : en anglais (« This page
 * could not be found. », « Application error »), sur un fond blanc imposé en
 * thème clair, sans en-tête ni lien de retour — un cul-de-sac. Les phrases
 * vivent dans les messages de la coquille (`shell.errorPages`, français et
 * anglais) ; ce module les assemble, pur, pour être partagé et testé sans rendu.
 */

import { SITE_NAME } from "./share-metadata";
import { shellText, type ShellKey, type ShellTranslate } from "./shell-text";

/** Le français, langue d'une page sans préfixe — repli des fonctions ci-dessous. */
const FRENCH: ShellTranslate = shellText("fr").t;

export interface ErrorPageLink {
  href: string;
  labelKey: ShellKey;
}

export interface ErrorPageCopy {
  /** Sur-titre en capitales (code ou nature de l'erreur). */
  eyebrow: string;
  title: string;
  message: string;
}

/** Textes de la page introuvable. */
export function notFoundCopy(t: ShellTranslate = FRENCH): ErrorPageCopy {
  return {
    eyebrow: t("errorPages.notFound.eyebrow"),
    title: t("errorPages.notFound.title"),
    message: t("errorPages.notFound.message"),
  };
}

/**
 * Textes d'une erreur d'exécution selon qu'une référence l'accompagne : seule
 * une erreur **serveur** en porte une (le `digest` de Next) — une erreur levée
 * dans le navigateur n'en a pas, et la phrase ne doit pas renvoyer à une
 * référence absente.
 */
export function runtimeErrorCopy(reference: string | null, t: ShellTranslate = FRENCH): ErrorPageCopy {
  return {
    eyebrow: t("errorPages.runtime.eyebrow"),
    title: t("errorPages.runtime.title"),
    message: t(reference ? "errorPages.runtime.messageWithReference" : "errorPages.runtime.message"),
  };
}

/** Destinations proposées depuis une page introuvable, dans l'ordre d'affichage. */
export const NOT_FOUND_LINKS: readonly ErrorPageLink[] = [
  { href: "/", labelKey: "errorPages.links.home" },
  { href: "/tournois", labelKey: "errorPages.links.tournaments" },
  { href: "/regles", labelKey: "errorPages.links.rules" },
];

/**
 * Référence de l'erreur à citer dans un signalement : l'empreinte (`digest`)
 * que Next joint à une erreur serveur, seule chose qui la relie aux journaux —
 * le message, lui, est masqué en production. `null` sans empreinte exploitable.
 */
export function errorReference(digest: string | null | undefined): string | null {
  if (typeof digest !== "string") return null;
  const trimmed = digest.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(trimmed) ? trimmed : null;
}

/**
 * Titre d'onglet d'une page d'erreur, au gabarit du site. Une limite d'erreur
 * est un composant client et ne peut pas exporter de métadonnées : elle rend ce
 * titre dans un `<title>`, que React remonte dans `<head>`.
 */
export function errorPageTitle(copy: ErrorPageCopy, t: ShellTranslate = FRENCH): string {
  return t("errorPages.documentTitle", { title: copy.title, site: SITE_NAME });
}
