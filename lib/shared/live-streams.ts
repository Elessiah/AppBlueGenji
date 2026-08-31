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
import { matchStartAtTime } from "./match-schedule";
import type { MatchStatus } from "./types";

/**
 * Mode de passage à l'antenne d'un match casté.
 * - `AUTO` — le direct s'ouvre dès que le match devient jouable.
 * - `START_TIME` — le direct s'ouvre à la **date de début du match**
 *   (`lib/shared/match-schedule.ts`), une fois le match jouable. C'est le mode
 *   d'un plateau annoncé à l'avance : l'antenne suit le programme publié, sans
 *   que personne n'ait à cliquer à l'heure dite.
 * - `MANUAL` — le direct s'ouvre au clic, ce qui convient aux tournois étalés
 *   sur plusieurs jours où un match peut être jouable des heures avant le cast.
 */
export type MatchLiveTrigger = "AUTO" | "START_TIME" | "MANUAL";

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

/** Modes de déclenchement, dans un ordre d'affichage stable. */
export const MATCH_LIVE_TRIGGERS: readonly MatchLiveTrigger[] = ["AUTO", "START_TIME", "MANUAL"];

/** Libellés FR des modes de déclenchement. */
export const MATCH_LIVE_TRIGGER_LABELS: Record<MatchLiveTrigger, string> = {
  AUTO: "Automatique au démarrage du match",
  START_TIME: "À la date de début du match",
  MANUAL: "Manuel (bouton d'antenne)",
};

/**
 * Ce mode a-t-il besoin d'une date de début sur le match ?
 *
 * Seul `START_TIME` en dépend, et il en dépend totalement : sans date, il n'a
 * aucune frontière à franchir et le match resterait indéfiniment « programmé ».
 */
export function requiresMatchStartAt(trigger: MatchLiveTrigger | null): boolean {
  return trigger === "START_TIME";
}

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
  return value === "AUTO" || value === "START_TIME" || value === "MANUAL";
}

/** Vue minimale d'un match, commune aux lignes SQL et au type `BracketMatch`. */
export type MatchLiveInput = {
  status: MatchStatus;
  /** `null` = match non casté. */
  liveTrigger: MatchLiveTrigger | null;
  /** Ouverture d'antenne (mode `MANUAL`) ; `null` = antenne fermée. */
  liveStartedAt: string | Date | null;
  /**
   * Date de début programmée du match (mode `START_TIME`) ; `null` = aucune.
   * Facultative pour que les appelants qui n'en ont pas — un match reconstruit
   * de mémoire dans un test, une ligne d'un flux antérieur — restent valides.
   * Accepte aussi l'instant en millisecondes (`matchStartAtTime`).
   */
  startAt?: string | Date | number | null;
};

/**
 * État de diffusion d'un match, à l'instant `now`.
 *
 * Ordre des règles, du plus fort au plus faible :
 * 1. pas de mode de déclenchement → le match n'est pas casté ;
 * 2. le match a quitté `READY`/`PENDING` → **un score a été saisi** (report en
 *    attente ou score validé) : le direct est terminé ;
 * 3. le match n'est pas encore jouable → annoncé, pas encore à l'antenne ;
 * 4. `AUTO` → à l'antenne dès que le match est jouable ;
 * 5. `START_TIME` → à l'antenne une fois la date de début atteinte. Une date
 *    absente laisse le match « programmé » indéfiniment : c'est une impasse,
 *    mais une impasse **visible et réversible** — préférable à un direct qui
 *    s'ouvrirait sur une heure qu'on n'a pas donnée ;
 * 6. `MANUAL` → à l'antenne si et seulement si elle a été ouverte.
 *
 * `now` est un paramètre et non un appel à l'horloge, pour que le serveur, le
 * client et les tests puissent tous se placer au même instant.
 */
export function resolveMatchLiveState(
  match: MatchLiveInput,
  now: number = Date.now(),
): MatchLiveState {
  if (match.liveTrigger === null) return "OFF";
  if (match.status === "AWAITING_CONFIRMATION" || match.status === "COMPLETED") return "OFF";
  if (match.status === "PENDING") return "SCHEDULED";
  if (match.liveTrigger === "AUTO") return "LIVE";
  if (match.liveTrigger === "START_TIME") {
    const startAt = matchStartAtTime({ startAt: match.startAt });
    return startAt !== null && now >= startAt ? "LIVE" : "SCHEDULED";
  }
  return match.liveStartedAt ? "LIVE" : "SCHEDULED";
}

/** Vrai si le match est à l'antenne à l'instant `now`. */
export function isMatchLive(match: MatchLiveInput, now: number = Date.now()): boolean {
  return resolveMatchLiveState(match, now) === "LIVE";
}

/**
 * Instant du prochain changement d'état **par le seul passage du temps**, ou
 * `null` s'il n'y en a pas.
 *
 * Seul `START_TIME` en produit un : les autres modes ne bougent qu'à la suite
 * d'une écriture, que le flux temps réel pousse déjà. Sert à programmer un
 * unique `setTimeout` côté client — même principe que
 * `nextTournamentStateChangeAt` — pour que le badge bascule à la seconde dite
 * sans sondage ni rechargement.
 *
 * On vérifie que la frontière change réellement l'état plutôt que de la
 * renvoyer d'office : un match encore `PENDING` à son heure de début reste
 * « programmé », et se réveiller pour redessiner à l'identique serait du gâchis.
 */
export function nextMatchLiveChangeAt(
  match: MatchLiveInput,
  now: number = Date.now(),
): number | null {
  if (match.liveTrigger !== "START_TIME") return null;

  const startAt = matchStartAtTime({ startAt: match.startAt });
  if (startAt === null || startAt <= now) return null;

  const current = resolveMatchLiveState(match, now);
  return resolveMatchLiveState(match, startAt) === current ? null : startAt;
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

/**
 * Ce match peut-il encore passer à l'antenne un jour ?
 *
 * Seul un score déjà saisi ferme définitivement la porte : le match dérivera
 * `OFF` quoi qu'on configure, et lui proposer une diffusion serait une impasse
 * — la case se cocherait, s'enregistrerait, et ne produirait jamais rien. Cela
 * écarte du même coup les byes, que le moteur crée directement en `COMPLETED`.
 *
 * Un match **pas encore apparié** reste castable, lui : c'est tout l'objet de
 * l'état `SCHEDULED`. On doit pouvoir annoncer la finale comme castée avant de
 * savoir qui la jouera — c'est même le cas le plus courant d'une diffusion
 * préparée à l'avance.
 */
export function isMatchCastable(match: MatchLiveInput): boolean {
  return match.status !== "COMPLETED" && match.status !== "AWAITING_CONFIRMATION";
}

/**
 * Faut-il exposer la configuration de diffusion à un porteur de `live` ?
 *
 * On l'ouvre aussi sur un match déjà marqué mais devenu non castable, sans quoi
 * une diffusion posée par erreur deviendrait ineffaçable.
 */
export function canConfigureLive(match: MatchLiveInput): boolean {
  return isMatchCastable(match) || match.liveTrigger !== null;
}
