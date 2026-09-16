import { toDiskUploadPath } from "./uploads";

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
 * Vrai si l'avatar est un fichier que **nous** servons.
 *
 * `bg_users.avatar_url` porte deux formes : le chemin d'un fichier que le site
 * a écrit (`/uploads/avatars/…` en base ancienne, `/api/uploads/avatars/…`
 * depuis que l'import passe par un route handler) et — c'est le cas à fermer —
 * l'URL de la photo de profil d'un compte Google, stockée telle quelle au
 * premier `createOrGetGoogleUser`.
 *
 * `toDiskUploadPath` rend déjà `null` pour tout ce qui n'est ni l'une ni
 * l'autre de nos deux formes : c'est exactement la question posée ici, et la
 * reposer autrement aurait fait deux règles pour un seul fait.
 */
export function isLocalAvatarUrl(avatarUrl: string | null | undefined): boolean {
  return toDiskUploadPath(avatarUrl) !== null;
}

/**
 * L'avatar s'il vient de chez nous, `null` sinon.
 *
 * `visibleAvatarUrl` n'est pas la seule porte : `getCurrentUser` en est une
 * seconde, et elle **n'a pas à consulter la visibilité** — c'est son propre
 * avatar que le titulaire voit dans la barre de navigation et dans l'en-tête
 * public. Elle doit en revanche poser la même règle d'origine, sans quoi la
 * seule chose que la correction aurait changée pour un compte Google est que
 * `next/image` **lève** au lieu de laisser fuiter : le drapeau `unoptimized`
 * partant, une URL étrangère n'est plus tolérée par le rendu, elle le casse.
 *
 * D'où cette fonction plutôt qu'un second test recopié : la question « cette
 * adresse est-elle la nôtre » ne doit avoir qu'une réponse.
 */
export function localAvatarUrl(avatarUrl: string | null | undefined): string | null {
  return isLocalAvatarUrl(avatarUrl) ? (avatarUrl as string) : null;
}

/**
 * L'avatar qu'un lecteur a le droit de voir, **et qui vient de chez nous**.
 *
 * Deux règles, au même endroit parce qu'elles gardent la même porte — c'est la
 * dernière que franchit un avatar avant d'atteindre un client.
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
 * La seconde est celle des logos partenaires, appliquée aux comptes : **le
 * `src` d'une image est toujours une adresse du site**
 * (`docs/features/SPONSOR_LOGO_PROXY.md`). La photo de profil d'un compte
 * Google était rendue depuis `lh3.googleusercontent.com`, si bien que chaque
 * page portant cet avatar annonçait l'IP du **visiteur** à Google — pas celle
 * du titulaire du compte, celle de qui regarde. Le
 * `referrerPolicy="no-referrer"` déjà posé ne couvrait que le référent.
 *
 * Une URL étrangère rend donc `null`, et l'écran retombe sur la pastille à
 * initiale. Ce n'est pas un pis-aller : c'est ce qui rend la règle **totale**,
 * là où filtrer au rendu l'aurait laissée dépendre du prochain écran écrit.
 * Les comptes concernés retrouvent leur photo à leur prochaine connexion, qui
 * la copie chez nous (`lib/server/user-avatar-import.ts`) — et tout de suite
 * pour qui lance `npm run backfill:avatars`.
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
  const local = localAvatarUrl(avatarUrl);
  if (!local) return null;
  return visibleAvatar || isSelf ? local : null;
}
