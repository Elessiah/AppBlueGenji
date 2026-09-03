/**
 * Repli d'avatar : l'initiale d'un pseudo.
 *
 * Le site n'a **pas** de fichier d'avatar par défaut — il en référençait un
 * (`/vercel.svg`, reste du gabarit Next.js) qui n'existe plus dans `public/`,
 * si bien que tout compte sans avatar affichait une image cassée. Le repli est
 * donc une pastille à initiale, celle-là même que dessinent déjà les cartes
 * d'annuaire : rien à télécharger, rien à manquer.
 *
 * Volontairement tolérant sur l'entrée. Un pseudo peut être vide (compte
 * anonymisé) ou commencer par une espace, et `pseudo[0]` rendait alors
 * `undefined` — donc une pastille vide, ou un plantage au `.toUpperCase()`.
 * Le découpage passe par `Array.from` pour compter en **caractères** et non en
 * unités UTF-16 : un pseudo commençant par un emoji perdait sinon la moitié de
 * son point de code.
 */
export function avatarInitial(pseudo: string | null | undefined): string {
  const first = Array.from((pseudo ?? "").trim())[0];
  return first === undefined ? "?" : first.toUpperCase();
}
