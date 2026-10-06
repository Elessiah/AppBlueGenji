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

import { FR_BOT_TEXT, type BotMessages, type BotText } from "@/lib/shared/bot-text";

/** Les permissions que les messages savent nommer (`unknown` est le repli, pas un drapeau). */
type KnownPermissionFlag = Exclude<keyof BotMessages["permissions"], "unknown">;

export type DiscordPermission = {
  /** Rang du bit dans le champ (`1n << bit`). */
  bit: number;
  /** Nom de la permission dans la documentation de Discord. */
  flag: string;
  /** Libellé affiché, dans la langue de la page (`bot.permissions.<flag>`). */
  label: string;
};

/** Une permission du registre : son libellé vient des messages `bot.permissions`. */
export type DiscordPermissionFlag = Readonly<{ bit: number; flag: KnownPermissionFlag }>;

/**
 * Registre des permissions de serveur connues, par rang de bit — calé sur
 * `PermissionFlagsBits` de `discord-api-types` (dépendance du bot, pas du
 * site). Le rang 47 ne désigne plus aucune permission publiée.
 */
export const DISCORD_PERMISSIONS: readonly DiscordPermissionFlag[] = [
  { bit: 0, flag: "CREATE_INSTANT_INVITE" },
  { bit: 1, flag: "KICK_MEMBERS" },
  { bit: 2, flag: "BAN_MEMBERS" },
  { bit: 3, flag: "ADMINISTRATOR" },
  { bit: 4, flag: "MANAGE_CHANNELS" },
  { bit: 5, flag: "MANAGE_GUILD" },
  { bit: 6, flag: "ADD_REACTIONS" },
  { bit: 7, flag: "VIEW_AUDIT_LOG" },
  { bit: 8, flag: "PRIORITY_SPEAKER" },
  { bit: 9, flag: "STREAM" },
  { bit: 10, flag: "VIEW_CHANNEL" },
  { bit: 11, flag: "SEND_MESSAGES" },
  { bit: 12, flag: "SEND_TTS_MESSAGES" },
  { bit: 13, flag: "MANAGE_MESSAGES" },
  { bit: 14, flag: "EMBED_LINKS" },
  { bit: 15, flag: "ATTACH_FILES" },
  { bit: 16, flag: "READ_MESSAGE_HISTORY" },
  { bit: 17, flag: "MENTION_EVERYONE" },
  { bit: 18, flag: "USE_EXTERNAL_EMOJIS" },
  { bit: 19, flag: "VIEW_GUILD_INSIGHTS" },
  { bit: 20, flag: "CONNECT" },
  { bit: 21, flag: "SPEAK" },
  { bit: 22, flag: "MUTE_MEMBERS" },
  { bit: 23, flag: "DEAFEN_MEMBERS" },
  { bit: 24, flag: "MOVE_MEMBERS" },
  { bit: 25, flag: "USE_VAD" },
  { bit: 26, flag: "CHANGE_NICKNAME" },
  { bit: 27, flag: "MANAGE_NICKNAMES" },
  { bit: 28, flag: "MANAGE_ROLES" },
  { bit: 29, flag: "MANAGE_WEBHOOKS" },
  { bit: 30, flag: "MANAGE_GUILD_EXPRESSIONS" },
  { bit: 31, flag: "USE_APPLICATION_COMMANDS" },
  { bit: 32, flag: "REQUEST_TO_SPEAK" },
  { bit: 33, flag: "MANAGE_EVENTS" },
  { bit: 34, flag: "MANAGE_THREADS" },
  { bit: 35, flag: "CREATE_PUBLIC_THREADS" },
  { bit: 36, flag: "CREATE_PRIVATE_THREADS" },
  { bit: 37, flag: "USE_EXTERNAL_STICKERS" },
  { bit: 38, flag: "SEND_MESSAGES_IN_THREADS" },
  { bit: 39, flag: "USE_EMBEDDED_ACTIVITIES" },
  { bit: 40, flag: "MODERATE_MEMBERS" },
  { bit: 41, flag: "VIEW_CREATOR_MONETIZATION_ANALYTICS" },
  { bit: 42, flag: "USE_SOUNDBOARD" },
  { bit: 43, flag: "CREATE_GUILD_EXPRESSIONS" },
  { bit: 44, flag: "CREATE_EVENTS" },
  { bit: 45, flag: "USE_EXTERNAL_SOUNDS" },
  { bit: 46, flag: "SEND_VOICE_MESSAGES" },
  { bit: 48, flag: "SET_VOICE_CHANNEL_STATUS" },
  { bit: 49, flag: "SEND_POLLS" },
  { bit: 50, flag: "USE_EXTERNAL_APPS" },
  { bit: 51, flag: "PIN_MESSAGES" },
  { bit: 52, flag: "BYPASS_SLOWMODE" },
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
export function decodeDiscordPermissions(bitfield: string, text: BotText = FR_BOT_TEXT): DiscordPermission[] | null {
  const raw = bitfield.trim();
  if (!/^\d{1,30}$/.test(raw)) return null;

  // `BigInt(…)` plutôt que des littéraux `0n` : la cible de compilation
  // (ES2017) ne les admet pas. Un `Number` perdrait les bits au-delà de 2⁵³,
  // et les permissions publiées atteignent déjà le bit 52 : la prochaine
  // passerait la limite.
  const zero = BigInt(0);
  const one = BigInt(1);
  const value = BigInt(raw);
  const out: DiscordPermission[] = [];
  for (let bit = 0; value >> BigInt(bit) > zero; bit++) {
    if (((value >> BigInt(bit)) & one) === zero) continue;
    const known = BY_BIT.get(bit);
    out.push(
      known
        ? { bit, flag: known.flag, label: text.t(`permissions.${known.flag}`) }
        : { bit, flag: `BIT_${bit}`, label: text.t("permissions.unknown", { bit }) },
    );
  }
  return out;
}
