/**
 * Le serveur Discord de BlueGenji : son invitation, écrite **une fois**.
 *
 * Elle était recopiée à la main dans neuf fichiers, et trois adresses
 * différentes y cohabitaient — `discord.gg/bluegenji` sur la vitrine,
 * `discord.gg/VPGZ4eBfwN` sur la page de connexion, `discord.gg/5kG9DDKx` dans
 * les pages légales du bot. C'est la panne la plus silencieuse qui soit : une
 * invitation périmée ou étrangère **fonctionne** — elle mène quelque part —, si
 * bien que rien ne casse, aucune page ne rend d'erreur, et personne ne voit que
 * le visiteur a atterri ailleurs que sur le serveur de l'association.
 *
 * D'où la constante unique. Changer de serveur, c'est changer cette ligne.
 *
 * Le **code** est isolé de l'URL parce qu'il sert deux fois : à composer le lien
 * qu'on affiche, et à interroger l'API publique des invitations pour le
 * compteur de membres (`lib/server/discord-community.ts`). Compter les membres
 * du serveur qu'on fait justement rejoindre, et pas ceux d'un identifiant de
 * guilde rangé à côté qui dériverait au premier changement d'invitation.
 *
 * Pur, donc importable de partout.
 */

/** Code d'invitation permanent du serveur BlueGenji. */
export const DISCORD_INVITE_CODE = "GB9ESEBZFW";

/** L'invitation, telle qu'elle s'écrit dans un `href`. */
export const DISCORD_INVITE_URL = `https://discord.gg/${DISCORD_INVITE_CODE}`;

/**
 * Les invitations que le site a portées avant celle-ci.
 *
 * Elles ne sont pas là par nostalgie : le lien Discord de la page contact est
 * une **donnée éditable** (`bg_settings.contact_discord_url`), pas une
 * constante. Corriger le code ne corrige donc pas une installation où l'ancienne
 * adresse a été enregistrée un jour — elle continuerait de s'afficher en pied de
 * page, et c'est précisément l'endroit qu'on ne relit jamais. Le rattrapage de
 * `lib/server/database.ts` remplace ces valeurs-là, **et seulement celles-là** :
 * une adresse que le staff a choisie n'a pas à être écrasée au démarrage.
 *
 * Une liste close : elle ne grandit que si l'invitation change encore.
 */
export const SUPERSEDED_DISCORD_INVITE_URLS: readonly string[] = [
  "https://discord.gg/bluegenji",
  "https://discord.gg/VPGZ4eBfwN",
  "https://discord.gg/5kG9DDKx",
];

/**
 * Fréquentation du serveur, telle que Discord la publie.
 *
 * Les deux nombres sont **approximatifs** — c'est le mot de Discord, pas une
 * précaution de notre part : ses champs s'appellent `approximate_member_count`
 * et `approximate_presence_count`. On les affiche tels quels, sans les
 * présenter comme un décompte exact.
 */
export type DiscordCommunityStats = {
  /** Membres du serveur, connectés ou non. */
  memberCount: number;
  /** Membres actuellement en ligne. */
  onlineCount: number;
};

/**
 * Lit la réponse de `GET /api/v10/invites/{code}?with_counts=true`.
 *
 * Séparé de l'appel réseau pour être éprouvé sans lui : tout ce qui peut mal
 * tourner dans cette fonction — champ absent, type inattendu, invitation
 * révoquée dont la réponse ne porte plus de compteur — se teste alors sans
 * simuler un serveur.
 *
 * Rend `null` plutôt qu'un objet à zéro : « Discord n'a rien dit » et « le
 * serveur est vide » ne sont pas le même fait, et le second est faux. Zéro
 * membre affiché sur l'accueil serait un mensonge que rien ne corrigerait.
 */
export function parseDiscordCommunityStats(payload: unknown): DiscordCommunityStats | null {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const memberCount = readCount(record.approximate_member_count);
  if (memberCount === null) return null;

  // La présence, elle, peut manquer sans que le reste soit inutilisable : on
  // garde le total et on se tait sur les connectés.
  return { memberCount, onlineCount: readCount(record.approximate_presence_count) ?? 0 };
}

/** Un compteur Discord : un entier fini et positif, rien d'autre. */
function readCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}
