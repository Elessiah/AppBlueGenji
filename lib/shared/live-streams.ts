/**
 * Diffusion en direct des tournois et des matchs.
 *
 * Deux niveaux, volontairement indépendants :
 * - le **tournoi** porte le lien de sa chaîne officielle (`liveUrl`) ;
 * - chaque **match** peut être marqué comme casté, avec sa propre chaîne — il
 *   n'hérite jamais de celle du tournoi, parce qu'un match peut être diffusé par
 *   un streamer indépendant, et qu'un lien hérité renverrait le spectateur vers
 *   une antenne qui ne montre pas ce match.
 *
 * L'état de diffusion d'un match n'est **pas stocké** : il est dérivé, comme le
 * verrouillage de score (`lib/shared/match-lock.ts`) ou le rejeu de la Survie.
 * Seules trois entrées sont persistées — le mode de déclenchement, le lien, et
 * l'horodatage d'ouverture d'antenne en mode manuel. Conséquence voulue :
 * l'arrêt du direct à la saisie du score ne demande aucune écriture, et une
 * correction de score le défait d'elle-même.
 *
 * Module pur : le serveur (garde-fous, résolution du bouton d'accueil) et
 * l'interface (badges, boutons) appliquent exactement la même règle.
 */
import type { MatchStatus } from "./types";

/**
 * Mode de passage à l'antenne d'un match casté.
 * - `AUTO` — le direct s'ouvre dès que le match devient jouable.
 * - `MANUAL` — le direct s'ouvre au clic, ce qui convient aux tournois étalés
 *   sur plusieurs jours où un match peut être jouable des heures avant le cast.
 */
export type MatchLiveTrigger = "AUTO" | "MANUAL";

/**
 * État de diffusion d'un match, dérivé.
 * - `OFF` — non casté, ou direct terminé (score saisi).
 * - `SCHEDULED` — annoncé comme casté, antenne pas encore ouverte.
 * - `LIVE` — en direct.
 */
export type MatchLiveState = "OFF" | "SCHEDULED" | "LIVE";

/** Libellés FR des états visibles (`OFF` ne s'affiche pas). */
export const MATCH_LIVE_STATE_LABELS: Record<Exclude<MatchLiveState, "OFF">, string> = {
  SCHEDULED: "Programmé en direct",
  LIVE: "En direct",
};

/** Libellés FR des modes de déclenchement. */
export const MATCH_LIVE_TRIGGER_LABELS: Record<MatchLiveTrigger, string> = {
  AUTO: "Automatique au démarrage du match",
  MANUAL: "Manuel (bouton d'antenne)",
};

/**
 * Plateformes de diffusion acceptées.
 *
 * Liste blanche assumée : le champ est saisi par du staff mais réaffiché à tous
 * les visiteurs, et un lien libre ferait du site un tremplin de redirection. Y
 * ajouter une plateforme = ajouter une entrée ici.
 */
export const LIVE_PLATFORMS = ["twitch.tv", "youtube.com", "youtu.be", "kick.com"] as const;

export type LivePlatform = (typeof LIVE_PLATFORMS)[number];

/**
 * Sous-domaines tolérés devant un domaine de la liste blanche. Volontairement
 * fermé : accepter « tout sous-domaine de twitch.tv » ouvrirait la porte à un
 * hôte contrôlé par un tiers, et `twitch.tv.exemple.com` doit rester refusé.
 */
const ALLOWED_SUBDOMAINS = ["", "www.", "m."] as const;

/** Longueur maximale de l'URL normalisée (taille de la colonne SQL). */
export const MAX_STREAM_URL_LENGTH = 255;

const ALLOWED_HOSTS: ReadonlySet<string> = new Set(
  LIVE_PLATFORMS.flatMap((platform) =>
    ALLOWED_SUBDOMAINS.map((subdomain) => `${subdomain}${platform}`),
  ),
);

/** Plateforme d'un lien déjà normalisé, pour l'affichage (`null` si inconnue). */
export function streamPlatform(url: string | null | undefined): LivePlatform | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return LIVE_PLATFORMS.find((platform) => host === platform || host.endsWith(`.${platform}`)) ?? null;
}

/** Libellé lisible de la plateforme, pour les boutons (« Regarder sur Twitch »). */
export const PLATFORM_LABELS: Record<LivePlatform, string> = {
  "twitch.tv": "Twitch",
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "kick.com": "Kick",
};

/**
 * Valide et normalise une URL de diffusion.
 *
 * Renvoie l'URL normalisée (schéma `https`, hôte en minuscules) ou `null` si
 * elle est inexploitable. Un schéma manquant est toléré — le staff colle
 * volontiers `twitch.tv/bluegenji` — mais tout le reste est refusé : hôte hors
 * liste blanche, identifiants dans l'URL, port explicite, longueur excessive.
 */
export function normalizeStreamUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Garde-fou de coût : `new URL` sur une chaîne démesurée ne sert à rien, et la
  // normalisation ne raccourcit jamais assez pour rattraper un tel écart.
  if (trimmed.length > MAX_STREAM_URL_LENGTH * 4) return null;

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // `https://user:pass@twitch.tv/...` passerait la liste blanche tout en
  // affichant un hôte trompeur dans certains clients.
  if (url.username || url.password) return null;
  if (url.port) return null;
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;

  // Toutes les plateformes acceptées servent en HTTPS : on remonte le schéma
  // plutôt que de renvoyer le visiteur en clair.
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase();

  const normalized = url.toString();
  return normalized.length > MAX_STREAM_URL_LENGTH ? null : normalized;
}

/** Vrai si `input` est une URL de diffusion exploitable. */
export function isValidStreamUrl(input: unknown): boolean {
  return normalizeStreamUrl(input) !== null;
}

/** Vrai si `value` est un mode de déclenchement connu. */
export function isMatchLiveTrigger(value: unknown): value is MatchLiveTrigger {
  return value === "AUTO" || value === "MANUAL";
}

/** Vue minimale d'un match, commune aux lignes SQL et au type `BracketMatch`. */
export type MatchLiveInput = {
  status: MatchStatus;
  /** `null` = match non casté. */
  liveTrigger: MatchLiveTrigger | null;
  /** Ouverture d'antenne (mode `MANUAL`) ; `null` = antenne fermée. */
  liveStartedAt: string | Date | null;
};

/**
 * État de diffusion d'un match.
 *
 * Ordre des règles, du plus fort au plus faible :
 * 1. pas de mode de déclenchement → le match n'est pas casté ;
 * 2. le match a quitté `READY`/`PENDING` → **un score a été saisi** (report en
 *    attente ou score validé) : le direct est terminé ;
 * 3. le match n'est pas encore jouable → annoncé, pas encore à l'antenne ;
 * 4. `AUTO` → à l'antenne dès que le match est jouable ;
 * 5. `MANUAL` → à l'antenne si et seulement si elle a été ouverte.
 */
export function resolveMatchLiveState(match: MatchLiveInput): MatchLiveState {
  if (match.liveTrigger === null) return "OFF";
  if (match.status === "AWAITING_CONFIRMATION" || match.status === "COMPLETED") return "OFF";
  if (match.status === "PENDING") return "SCHEDULED";
  if (match.liveTrigger === "AUTO") return "LIVE";
  return match.liveStartedAt ? "LIVE" : "SCHEDULED";
}

/** Vrai si le match est à l'antenne. */
export function isMatchLive(match: MatchLiveInput): boolean {
  return resolveMatchLiveState(match) === "LIVE";
}

/**
 * Le bouton d'antenne a-t-il un sens sur ce match ?
 *
 * Seul le mode `MANUAL` en expose un : en `AUTO` l'état ne dépend que du statut
 * du match, et un bouton n'aurait rien à basculer.
 */
export function canToggleOnAir(match: MatchLiveInput): boolean {
  if (match.liveTrigger !== "MANUAL") return false;
  return match.status === "READY";
}
