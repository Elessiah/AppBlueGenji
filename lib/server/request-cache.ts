import * as React from "react";

// `cache` de React n'est fourni qu'au runtime (React Server Components / Next) ;
// le paquet `react` résolu sous Jest ne l'expose pas. On retombe alors sur
// l'identité (pas de mémoïsation en test, comportement inchangé).
const reactCache = (React as {
  cache?: <T extends (...args: never[]) => unknown>(fn: T) => T;
}).cache;

/**
 * Mémoïse `fn` **pour la requête en cours** (`cache` de React) : les lecteurs
 * d'un même rendu — mise en page, encart, contrôle 404 — partagent une seule
 * lecture par jeu d'arguments (comparés par identité : passer des primitives).
 * Serveur seulement.
 */
export const requestCache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof reactCache === "function" ? reactCache : (fn) => fn;
