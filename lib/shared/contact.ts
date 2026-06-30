/**
 * Coordonnées de contact de l'association, personnalisables par les admins et
 * stockées en base (table clé/valeur `bg_settings`). Trois canaux, tous
 * facultatifs : email, tag Discord, lien (invitation) Discord. Les valeurs par
 * défaut servent de secours tant que rien n'a été enregistré. Partagé
 * client/serveur.
 */
export type ContactInfo = {
  email: string;
  discordTag: string;
  discordUrl: string;
};

/** Clés de stockage dans la table `bg_settings`. */
export const CONTACT_EMAIL_KEY = "contact_email";
export const CONTACT_DISCORD_TAG_KEY = "contact_discord_tag";
export const CONTACT_DISCORD_URL_KEY = "contact_discord_url";

export const DEFAULT_CONTACT: ContactInfo = {
  email: "presse@bluegenji-esport.fr",
  discordTag: "",
  discordUrl: "https://discord.gg/bluegenji",
};

export const EMAIL_MAX = 254;
export const DISCORD_TAG_MAX = 64;
export const DISCORD_URL_MAX = 200;

// Email : un seul `@`, deux côtés non vides, un point dans le domaine. Volontairement
// permissif pour ne pas rejeter d'adresses exotiques valides.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Tag Discord : pas d'espace (les pseudos Discord n'en contiennent pas).
const DISCORD_TAG_RE = /^\S+$/;
// Hôtes acceptés pour le lien Discord.
const DISCORD_HOSTS = ["discord.gg", "discord.com", "discordapp.com"];

export type ContactValidationResult =
  | { ok: true; value: ContactInfo }
  | { ok: false; error: string };

/** Valide une adresse email facultative. Renvoie la valeur normalisée (trim + minuscules). */
export function validateEmail(input: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const email = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (!email) return { ok: true, value: "" };
  if (email.length > EMAIL_MAX) return { ok: false, error: "EMAIL_TOO_LONG" };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "EMAIL_INVALID" };
  return { ok: true, value: email };
}

/** Valide un tag Discord facultatif (sans espace). */
export function validateDiscordTag(input: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const tag = typeof input === "string" ? input.trim() : "";
  if (!tag) return { ok: true, value: "" };
  if (tag.length > DISCORD_TAG_MAX) return { ok: false, error: "DISCORD_TAG_TOO_LONG" };
  if (!DISCORD_TAG_RE.test(tag)) return { ok: false, error: "DISCORD_TAG_INVALID" };
  return { ok: true, value: tag };
}

/** Valide un lien Discord facultatif (http(s) vers un domaine Discord). */
export function validateDiscordUrl(input: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const url = typeof input === "string" ? input.trim() : "";
  if (!url) return { ok: true, value: "" };
  if (url.length > DISCORD_URL_MAX) return { ok: false, error: "DISCORD_URL_TOO_LONG" };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "DISCORD_URL_INVALID" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "DISCORD_URL_INVALID" };
  }
  const host = parsed.hostname.toLowerCase();
  const isDiscord = DISCORD_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (!isDiscord) return { ok: false, error: "DISCORD_URL_INVALID" };

  return { ok: true, value: parsed.toString() };
}

/**
 * Valide et normalise l'ensemble des coordonnées de contact. Chaque canal est
 * facultatif (chaîne vide = non renseigné), mais s'il est fourni il doit être
 * valide.
 */
export function validateContactInfo(input: Partial<ContactInfo>): ContactValidationResult {
  const email = validateEmail(input.email);
  if (!email.ok) return email;
  const discordTag = validateDiscordTag(input.discordTag);
  if (!discordTag.ok) return discordTag;
  const discordUrl = validateDiscordUrl(input.discordUrl);
  if (!discordUrl.ok) return discordUrl;

  return {
    ok: true,
    value: { email: email.value, discordTag: discordTag.value, discordUrl: discordUrl.value },
  };
}
