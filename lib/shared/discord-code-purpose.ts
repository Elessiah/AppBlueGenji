/**
 * Usage d'un code Discord envoyé en message privé : la connexion (`login`), ou
 * la certification / le changement de tag (`handle`), dont le message dit que
 * le code ne connecte pas. Partagé par le client du bot et le stockage des défis.
 */
export type DiscordCodePurpose = "login" | "handle";

/** Valeur de `bg_discord_login_challenges.purpose` pour chaque usage. */
export const DISCORD_CODE_PURPOSE_COLUMN: Readonly<Record<DiscordCodePurpose, "LOGIN" | "HANDLE">> = {
  login: "LOGIN",
  handle: "HANDLE",
};
