/**
 * Le focus est-il perdu ? Quand le bouton focalisé disparaît du DOM, le
 * navigateur le rend à `<body>` (ou, selon le moteur, à `<html>`) : aucun
 * élément n'est plus actif. Un focus resté sur un champ, un lien ou une
 * liste n'est jamais « perdu » : on ne le reprend pas.
 */
export function isFocusLost(doc: Pick<Document, "activeElement" | "body" | "documentElement">): boolean {
  const active = doc.activeElement;
  return active === null || active === doc.body || active === doc.documentElement;
}
