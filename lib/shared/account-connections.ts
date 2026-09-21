/**
 * Les moyens de connexion d'un compte : ce qu'on peut ajouter, ce qu'on ne peut
 * pas retirer.
 *
 * **Le site n'a pas de mot de passe.** Un compte n'est atteignable que par les
 * identités OAuth rattachées — et, pour Discord, par le code reçu en message
 * privé, qui passe par le *même* `discord_id`. Détacher la dernière ne « délie »
 * donc pas un compte : elle le **ferme définitivement**, sans recours possible,
 * puisqu'il n'existe aucun chemin de récupération par courriel. C'est la seule
 * règle que ce module porte, et elle vaut d'être écrite une fois : l'écran qui
 * grise le bouton et la route qui refuse en 409 doivent dire la même chose, sans
 * quoi le bouton mène à un mur.
 *
 * Module **pur** : la liste des rattachements est un fait que l'appelant a déjà
 * établi (le serveur en base, le client depuis la réponse de l'API).
 */
import { OAUTH_PROVIDERS, OAUTH_PROVIDER_LABELS, type OAuthProvider } from "./oauth-providers";

/** L'état d'une porte d'entrée pour un compte donné. */
export type AccountConnection = {
  provider: OAuthProvider;
  /** Une identité de ce fournisseur est-elle rattachée au compte ? */
  linked: boolean;
  /**
   * Le nom que le fournisseur donne à cette identité — tag Discord, BattleTag.
   *
   * `null` quand le fournisseur n'en donne aucun (Google) ou quand rien n'est
   * rattaché. Ce n'est **jamais** l'identifiant opaque : un `sub` affiché ne
   * renseigne personne, et le montrer reviendrait à publier une donnée de plus
   * pour rien.
   */
  handle: string | null;
};

/**
 * Pourquoi un détachement est refusé.
 *
 * Deux cas seulement, et le second est le seul qui compte : `LAST_CONNECTION`
 * dit qu'on s'apprête à murer la porte par laquelle on est entré.
 */
export type ConnectionUnlinkRefusal = "NOT_LINKED" | "LAST_CONNECTION";

/** Nombre de fournisseurs effectivement rattachés. */
export function linkedConnectionCount(connections: readonly AccountConnection[]): number {
  return connections.filter((connection) => connection.linked).length;
}

/**
 * Ce compte peut-il détacher ce fournisseur ? `null` = oui.
 *
 * Le seuil est **un**, et non deux : il reste toujours au moins un moyen
 * d'entrer. Le refus ne dépend pas du fournisseur visé — aucune porte n'est
 * « principale », elles se valent toutes.
 */
export function checkConnectionUnlink(
  connections: readonly AccountConnection[],
  provider: OAuthProvider,
): ConnectionUnlinkRefusal | null {
  const target = connections.find((connection) => connection.provider === provider);
  if (!target || !target.linked) return "NOT_LINKED";
  if (linkedConnectionCount(connections) <= 1) return "LAST_CONNECTION";
  return null;
}

/**
 * Le refus, dit au joueur.
 *
 * Vit ici et non dans l'écran : c'est la phrase qui accompagne la règle, et une
 * copie côté client aurait cessé de la décrire au premier ajustement.
 */
export function connectionUnlinkRefusalMessage(
  refusal: ConnectionUnlinkRefusal,
  provider: OAuthProvider,
): string {
  const label = OAUTH_PROVIDER_LABELS[provider];
  if (refusal === "NOT_LINKED") return `Aucun compte ${label} n'est rattaché.`;
  return `Impossible de retirer ${label} : c'est ton dernier moyen de connexion. Ajoutes-en un autre d'abord.`;
}

/**
 * Une liste complète à partir de ce que la base détient.
 *
 * Complète : **tous** les fournisseurs y figurent, rattachés ou non. L'écran
 * doit pouvoir proposer d'ajouter ce qui manque, et un tableau qui ne
 * contiendrait que l'existant l'obligerait à reconstruire le complément — donc
 * à connaître la liste, qu'il vient justement de recevoir.
 */
export function buildAccountConnections(
  linked: Partial<Record<OAuthProvider, { subject: string | null; handle?: string | null }>>,
): AccountConnection[] {
  return OAUTH_PROVIDERS.map((provider) => {
    const entry = linked[provider];
    const isLinked = Boolean(entry?.subject);
    return {
      provider,
      linked: isLinked,
      handle: isLinked ? (entry?.handle ?? null) : null,
    };
  });
}
