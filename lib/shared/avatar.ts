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

/**
 * L'avatar qu'un lecteur a le droit de voir.
 *
 * `visible_avatar` est un réglage de profil : à `0`, l'image ne sort pas du
 * compte — sauf pour son propriétaire, qui doit continuer de voir la sienne.
 * La règle vivait dans `applyVisibility` (`lib/server/users-service.ts`), et
 * elle n'y voyait que les deux lectures de profil : le **roster** d'une équipe
 * — carte d'annuaire comme fiche — et le **logo d'une entrée solo** lisaient
 * `bg_users.avatar_url` sans jamais la consulter, si bien qu'un avatar masqué
 * restait affiché à tout le site, et jusque sur la vitrine publique par la
 * carte du match en direct.
 *
 * D'où cette fonction, pure et partagée : quatre lectures posent la même
 * question, et quatre copies auraient divergé au premier réglage — la première
 * l'avait déjà fait en ne se posant pas la question du tout.
 *
 * @param avatarUrl Valeur brute de `bg_users.avatar_url`.
 * @param visibleAvatar Réglage `visible_avatar` du compte.
 * @param isSelf Le lecteur est le propriétaire du compte.
 */
export function visibleAvatarUrl(
  avatarUrl: string | null | undefined,
  visibleAvatar: boolean,
  isSelf = false,
): string | null {
  if (!avatarUrl) return null;
  return visibleAvatar || isSelf ? avatarUrl : null;
}
