/**
 * Le source sans ses commentaires, pour les balayages qui cherchent un motif
 * **dans le code** : un commentaire peut citer le motif refusé pour expliquer
 * pourquoi il l'est.
 *
 * Seuls les commentaires qui **ouvrent une ligne** sont retirés (`//`, `/*`,
 * et `{/*` en JSX). Un retrait non ancré couperait aussi dans une chaîne :
 * `accept="image/*"` suivi d'un `*\/` plus bas ferait disparaître tout le code
 * entre les deux, et un motif interdit qui s'y trouverait passerait le
 * balayage en silence. Le prix de l'ancrage — un commentaire en fin de ligne
 * reste balayé — ne peut produire qu'un faux positif, bruyant.
 */
export function stripLineComments(text: string): string {
  return text
    .replace(/^[ \t]*\{?\/\*[\s\S]*?\*\/\}?/gm, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}
