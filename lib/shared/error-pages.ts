/**
 * Textes des pages d'erreur du site (`app/not-found.tsx`, `app/error.tsx`,
 * `app/global-error.tsx`).
 *
 * Sans ces fichiers, Next rendait ses propres pages : en anglais (« This page
 * could not be found. », « Application error »), sur un fond blanc imposé en
 * thème clair, sans en-tête ni lien de retour — un cul-de-sac. Les textes sont
 * réunis ici, purs, pour être partagés et testés sans rendu.
 */

import { SITE_NAME } from "./share-metadata";

export interface ErrorPageLink {
  href: string;
  label: string;
}

export interface ErrorPageCopy {
  /** Sur-titre en capitales (code ou nature de l'erreur). */
  eyebrow: string;
  title: string;
  message: string;
}

export const NOT_FOUND_COPY: ErrorPageCopy = {
  eyebrow: "ERREUR 404",
  title: "Page introuvable",
  message:
    "Cette adresse ne mène à aucune page du site : le lien est peut-être erroné, ou la page a été déplacée ou retirée.",
};

export const RUNTIME_ERROR_COPY: ErrorPageCopy = {
  eyebrow: "ERREUR",
  title: "Un problème est survenu",
  message:
    "La page n'a pas pu s'afficher. Réessaie dans un instant ; si le problème persiste, signale-le avec la référence ci-dessous.",
};

/** Destinations proposées depuis une page introuvable, dans l'ordre d'affichage. */
export const NOT_FOUND_LINKS: readonly ErrorPageLink[] = [
  { href: "/", label: "Retour à l'accueil" },
  { href: "/tournois", label: "Voir les tournois" },
  { href: "/regles", label: "Lire les règles" },
];

/** Libellé du bouton qui relance le rendu après une erreur d'exécution. */
export const RETRY_LABEL = "Réessayer";

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
export function errorPageTitle(copy: ErrorPageCopy): string {
  return `${copy.title} · ${SITE_NAME}`;
}
