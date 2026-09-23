/**
 * server-only — lit `process.env` (variables non exposées au navigateur).
 *
 * Construit l'URL OAuth2 d'invitation du bot Discord à partir de la config
 * d'environnement, plutôt que d'un client_id codé en dur.
 *
 * - `DISCORD_BOT_CLIENT_ID`  : identifiant de l'application Discord (obligatoire
 *   pour produire un lien fonctionnel).
 * - `DISCORD_BOT_PERMISSIONS`: bitfield de permissions (optionnel ; défaut =
 *   `DEFAULT_BOT_PERMISSIONS`). Les scopes `bot` et `applications.commands`
 *   voyagent à part, dans `scope` : le défaut, lui, ne demande que le bit 40
 *   (`MODERATE_MEMBERS`) — valeur héritée de la maquette, que la carte
 *   d'invitation affiche désormais telle quelle (`decodeDiscordPermissions`).
 *
 * Si aucun client_id n'est configuré, la fonction renvoie `"#"` : le bouton
 * reste présent mais inerte, plutôt que de pointer vers un bot fictif.
 */
export const DEFAULT_BOT_PERMISSIONS = "1099511627776";

/**
 * Les scopes OAuth de l'invitation. Écrits une fois : la page les affiche à
 * côté du bouton, et une copie à la main annoncerait encore l'ancienne liste
 * le jour où l'URL en demanderait une autre.
 */
export const BOT_INVITE_SCOPES = ["bot", "applications.commands"] as const;

/** Les scopes tels que la page les affiche (`BOT + APPLICATIONS.COMMANDS`). */
export function botInviteScopesLabel(): string {
  return BOT_INVITE_SCOPES.map((s) => s.toUpperCase()).join(" + ");
}

/**
 * Le champ de bits réellement envoyé à Discord. Lu à un seul endroit : la carte
 * d'invitation l'affiche, et deux lectures de la variable pourraient diverger
 * sur un défaut.
 */
export function botInvitePermissions(): string {
  return process.env.DISCORD_BOT_PERMISSIONS?.trim() || DEFAULT_BOT_PERMISSIONS;
}

export function botInviteUrl(): string {
  const clientId = process.env.DISCORD_BOT_CLIENT_ID?.trim();
  if (!clientId) return "#";

  const permissions = botInvitePermissions();

  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("permissions", permissions);
  url.searchParams.set("scope", BOT_INVITE_SCOPES.join(" "));
  return url.toString();
}
