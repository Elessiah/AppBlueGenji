/**
 * Lecture d'un champ de bits de permissions Discord.
 *
 * La carte d'invitation de `/bot` affichait cinq permissions écrites en dur
 * (« Envoyer des messages », « Mentionner @everyone »…) **au-dessus** de
 * l'entier réellement envoyé à Discord — et les deux ne se correspondaient pas :
 * la valeur par défaut, `1099511627776`, est le seul bit 40 (« Exclure
 * temporairement des membres »), qu'aucune ligne de la liste ne nommait. Le
 * joueur lisait une promesse et l'écran de consentement de Discord lui en
 * montrait une autre. La liste se **déduit** désormais de l'entier : elle ne
 * peut plus dire autre chose que lui.
 *
 * Module pur : l'entier vient d'une variable d'environnement lue côté serveur,
 * le décodage se teste sans elle.
 */

export type DiscordPermission = {
  /** Rang du bit dans le champ (`1n << bit`). */
  bit: number;
  /** Nom de la permission dans la documentation de Discord. */
  flag: string;
  /** Libellé affiché, en français. */
  label: string;
};

/**
 * Registre des permissions de serveur connues, par rang de bit — les rangs
 * 47 et 48 ne désignent aucune permission publiée.
 */
export const DISCORD_PERMISSIONS: readonly DiscordPermission[] = [
  { bit: 0, flag: "CREATE_INSTANT_INVITE", label: "Créer une invitation" },
  { bit: 1, flag: "KICK_MEMBERS", label: "Expulser des membres" },
  { bit: 2, flag: "BAN_MEMBERS", label: "Bannir des membres" },
  { bit: 3, flag: "ADMINISTRATOR", label: "Administrateur" },
  { bit: 4, flag: "MANAGE_CHANNELS", label: "Gérer les salons" },
  { bit: 5, flag: "MANAGE_GUILD", label: "Gérer le serveur" },
  { bit: 6, flag: "ADD_REACTIONS", label: "Ajouter des réactions" },
  { bit: 7, flag: "VIEW_AUDIT_LOG", label: "Voir les logs du serveur" },
  { bit: 8, flag: "PRIORITY_SPEAKER", label: "Voix prioritaire" },
  { bit: 9, flag: "STREAM", label: "Vidéo" },
  { bit: 10, flag: "VIEW_CHANNEL", label: "Voir les salons" },
  { bit: 11, flag: "SEND_MESSAGES", label: "Envoyer des messages" },
  { bit: 12, flag: "SEND_TTS_MESSAGES", label: "Envoyer des messages de synthèse vocale" },
  { bit: 13, flag: "MANAGE_MESSAGES", label: "Gérer les messages" },
  { bit: 14, flag: "EMBED_LINKS", label: "Intégrer des liens" },
  { bit: 15, flag: "ATTACH_FILES", label: "Joindre des fichiers" },
  { bit: 16, flag: "READ_MESSAGE_HISTORY", label: "Lire l'historique des messages" },
  { bit: 17, flag: "MENTION_EVERYONE", label: "Mentionner @everyone" },
  { bit: 18, flag: "USE_EXTERNAL_EMOJIS", label: "Utiliser des émojis externes" },
  { bit: 19, flag: "VIEW_GUILD_INSIGHTS", label: "Voir les statistiques du serveur" },
  { bit: 20, flag: "CONNECT", label: "Se connecter en vocal" },
  { bit: 21, flag: "SPEAK", label: "Parler en vocal" },
  { bit: 22, flag: "MUTE_MEMBERS", label: "Rendre des membres muets" },
  { bit: 23, flag: "DEAFEN_MEMBERS", label: "Mettre des membres en sourdine" },
  { bit: 24, flag: "MOVE_MEMBERS", label: "Déplacer des membres" },
  { bit: 25, flag: "USE_VAD", label: "Utiliser la détection de la voix" },
  { bit: 26, flag: "CHANGE_NICKNAME", label: "Changer de pseudo" },
  { bit: 27, flag: "MANAGE_NICKNAMES", label: "Gérer les pseudos" },
  { bit: 28, flag: "MANAGE_ROLES", label: "Gérer les rôles" },
  { bit: 29, flag: "MANAGE_WEBHOOKS", label: "Gérer les webhooks" },
  { bit: 30, flag: "MANAGE_GUILD_EXPRESSIONS", label: "Gérer les expressions" },
  { bit: 31, flag: "USE_APPLICATION_COMMANDS", label: "Utiliser les commandes d'application" },
  { bit: 32, flag: "REQUEST_TO_SPEAK", label: "Demander la parole" },
  { bit: 33, flag: "MANAGE_EVENTS", label: "Gérer les évènements" },
  { bit: 34, flag: "MANAGE_THREADS", label: "Gérer les fils" },
  { bit: 35, flag: "CREATE_PUBLIC_THREADS", label: "Créer des fils publics" },
  { bit: 36, flag: "CREATE_PRIVATE_THREADS", label: "Créer des fils privés" },
  { bit: 37, flag: "USE_EXTERNAL_STICKERS", label: "Utiliser des autocollants externes" },
  { bit: 38, flag: "SEND_MESSAGES_IN_THREADS", label: "Envoyer des messages dans les fils" },
  { bit: 39, flag: "USE_EMBEDDED_ACTIVITIES", label: "Utiliser les activités" },
  { bit: 40, flag: "MODERATE_MEMBERS", label: "Exclure temporairement des membres" },
  { bit: 41, flag: "VIEW_CREATOR_MONETIZATION_ANALYTICS", label: "Voir les statistiques de monétisation" },
  { bit: 42, flag: "USE_SOUNDBOARD", label: "Utiliser la soundboard" },
  { bit: 43, flag: "CREATE_GUILD_EXPRESSIONS", label: "Créer des expressions" },
  { bit: 44, flag: "CREATE_EVENTS", label: "Créer des évènements" },
  { bit: 45, flag: "USE_EXTERNAL_SOUNDS", label: "Utiliser des sons externes" },
  { bit: 46, flag: "SEND_VOICE_MESSAGES", label: "Envoyer des messages vocaux" },
  { bit: 49, flag: "SEND_POLLS", label: "Créer des sondages" },
  { bit: 50, flag: "USE_EXTERNAL_APPS", label: "Utiliser des applications externes" },
  { bit: 51, flag: "PIN_MESSAGES", label: "Épingler des messages" },
];

const BY_BIT = new Map(DISCORD_PERMISSIONS.map((p) => [p.bit, p]));

/**
 * Décode un champ de bits (écrit en décimal, comme dans une URL d'invitation)
 * en permissions nommées, par rang de bit croissant.
 *
 * Rend `null` sur une valeur qui n'est pas un entier décimal positif : Discord
 * la refuserait aussi, et la carte doit le dire plutôt que d'annoncer « aucune
 * permission ». Un bit que le registre ne connaît pas n'est **jamais** tu — il
 * est rendu sous son rang, une permission demandée ne pouvant pas disparaître
 * de la liste au seul motif qu'elle est récente.
 */
export function decodeDiscordPermissions(bitfield: string): DiscordPermission[] | null {
  const raw = bitfield.trim();
  if (!/^\d{1,30}$/.test(raw)) return null;

  // `BigInt(…)` plutôt que des littéraux `0n` : la cible de compilation
  // (ES2017) ne les admet pas. Un `Number` perdrait les bits au-delà de 2⁵³,
  // or les permissions récentes y sont déjà.
  const zero = BigInt(0);
  const one = BigInt(1);
  const value = BigInt(raw);
  const out: DiscordPermission[] = [];
  for (let bit = 0; value >> BigInt(bit) > zero; bit++) {
    if (((value >> BigInt(bit)) & one) === zero) continue;
    out.push(BY_BIT.get(bit) ?? { bit, flag: `BIT_${bit}`, label: `Permission inconnue (bit ${bit})` });
  }
  return out;
}
