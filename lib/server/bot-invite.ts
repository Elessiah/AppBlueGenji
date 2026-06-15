/**
 * server-only — lit `process.env` (variables non exposées au navigateur).
 *
 * Construit l'URL OAuth2 d'invitation du bot Discord à partir de la config
 * d'environnement, plutôt que d'un client_id codé en dur.
 *
 * - `DISCORD_BOT_CLIENT_ID`  : identifiant de l'application Discord (obligatoire
 *   pour produire un lien fonctionnel).
 * - `DISCORD_BOT_PERMISSIONS`: bitfield de permissions (optionnel ; défaut =
 *   `DEFAULT_BOT_PERMISSIONS`, soit l'ensemble minimal bot + slash commands).
 *
 * Si aucun client_id n'est configuré, la fonction renvoie `"#"` : le bouton
 * reste présent mais inerte, plutôt que de pointer vers un bot fictif.
 */
export const DEFAULT_BOT_PERMISSIONS = "1099511627776";

export function botInviteUrl(): string {
  const clientId = process.env.DISCORD_BOT_CLIENT_ID?.trim();
  if (!clientId) return "#";

  const permissions = process.env.DISCORD_BOT_PERMISSIONS?.trim() || DEFAULT_BOT_PERMISSIONS;

  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("permissions", permissions);
  url.searchParams.set("scope", "bot applications.commands");
  return url.toString();
}
