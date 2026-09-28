/**
 * Notifications push du navigateur (Web Push) — la règle, sans réseau ni base.
 *
 * **Un registre, un point d'entrée, un composant.** Toute notification que le
 * site produit est un **sujet** de {@link PUSH_TOPICS} ; le serveur la distribue
 * par un seul chemin (`lib/server/notify.ts`, qui envoie aussi le message privé
 * Discord quand il y en a un) ; et l'écran de réglages (`PushNotificationsPanel`)
 * se construit depuis ce registre. Ajouter une notification demain, c'est donc
 * une entrée ici : le réglage apparaît de lui-même sur `/profil`, et un balayage
 * (`tests/lib/server/notification-channels.test.ts`) refuse tout message privé
 * Discord envoyé hors du point d'entrée — une notification qui passerait à côté
 * n'arriverait jamais en push.
 *
 * Le consentement est double et ne se confond pas : **l'appareil** s'abonne (le
 * navigateur demande la permission, le joueur l'accorde), puis **le compte**
 * choisit ses sujets. Un sujet est actif par défaut une fois l'appareil abonné —
 * s'abonner *est* demander à être prévenu —, et se coupe un par un.
 *
 * Module pur : serveur (qui distribue et valide) et interface (qui affiche les
 * sujets) lisent la même règle.
 */

import { can, type Permission, type PlatformRole } from "./permissions";

/**
 * Qui peut recevoir un sujet : tout joueur (`null`), ou seulement le staff qui
 * détient la permission — une alerte d'arbitrage ne concerne pas un joueur, et
 * lui montrer la case serait promettre un message qui ne viendra jamais.
 */
type PushTopicDefinition = {
  label: string;
  description: string;
  audience: Permission | null;
};

/**
 * Tous les sujets, dans l'ordre d'affichage. **L'ordre des clés est l'ordre de
 * l'écran** : du plus pressant (ton match commence) au plus administratif.
 */
export const PUSH_TOPICS = {
  MATCH_START: {
    label: "Départ de match",
    description: "Ton match entre en lancement : déclare-toi prêt, ou il vient d'être lancé.",
    audience: null,
  },
  SCORE_TO_CONFIRM: {
    label: "Score à confirmer",
    description: "L'équipe adverse a saisi un score que tu dois confirmer ou contester.",
    audience: null,
  },
  TOURNAMENT_START: {
    label: "Coup d'envoi d'un tournoi",
    description: "Un tournoi où ton équipe est inscrite vient de commencer.",
    audience: null,
  },
  MATCH_REMINDER: {
    label: "Rappels de match",
    description: "Une semaine, 24 h puis 1 h avant un match programmé, et l'annonce de son horaire.",
    audience: null,
  },
  TEAM_JOIN_REQUEST: {
    label: "Demandes d'adhésion",
    description: "Un joueur demande à rejoindre une équipe que tu gères.",
    audience: null,
  },
  CONTENT_REPORT: {
    label: "Signalements te concernant",
    description: "Un signalement vise ton compte ou ton équipe : tu peux le contester.",
    audience: null,
  },
  MODERATION: {
    label: "Décisions de modération",
    description: "Ton avatar ou le logo de ton équipe a été masqué, supprimé ou rétabli.",
    audience: null,
  },
  PRIVACY_CHANGE: {
    label: "Traitement de tes données",
    description: "Le site change ce qu'il collecte ou la façon dont il le garde.",
    audience: null,
  },
  REFEREE_ALERT: {
    label: "Alertes d'arbitrage",
    description: "Un conflit de score, un report non tranché ou un problème signalé attend un arbitre.",
    audience: "tournaments",
  },
  STAFF_REPORT: {
    label: "Signalements reçus",
    description: "Un nouveau signalement, ou une contestation, arrive à la modération.",
    audience: "moderation",
  },
} as const satisfies Record<string, PushTopicDefinition>;

export type PushTopic = keyof typeof PUSH_TOPICS;

export const PUSH_TOPIC_KEYS = Object.keys(PUSH_TOPICS) as PushTopic[];

export function isPushTopic(value: unknown): value is PushTopic {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PUSH_TOPICS, value);
}

type Viewer = { roles?: readonly PlatformRole[]; isAdmin?: boolean } | null | undefined;

/** Le lecteur peut-il recevoir ce sujet ? */
export function canReceivePushTopic(viewer: Viewer, topic: PushTopic): boolean {
  const audience: Permission | null = PUSH_TOPICS[topic].audience;
  return audience === null || can(viewer, audience);
}

/** Les sujets à montrer à ce lecteur, dans l'ordre du registre. */
export function visiblePushTopics(viewer: Viewer): PushTopic[] {
  return PUSH_TOPIC_KEYS.filter((topic) => canReceivePushTopic(viewer, topic));
}

/**
 * Sujets coupés, tels que le client les envoie : on ne garde que des sujets
 * connus, sans doublon, dans l'ordre du registre — l'entrée vient du réseau.
 */
export function sanitizeDisabledTopics(input: unknown): PushTopic[] {
  if (!Array.isArray(input)) return [];
  const set = new Set(input.filter(isPushTopic));
  return PUSH_TOPIC_KEYS.filter((topic) => set.has(topic));
}

// ─────────────────────────────────────────────────────────────────────────────
// Ce qu'une notification affiche
// ─────────────────────────────────────────────────────────────────────────────

/** Contenu d'une notification, avant mise en forme. */
export type PushContent = {
  title: string;
  body: string;
  /** Chemin du site ouvert au clic (`/tournois/12#match-40`). */
  url: string;
  /**
   * Étiquette de regroupement : une notification de même étiquette **remplace**
   * la précédente au lieu de s'empiler (le lancement puis le départ d'un même
   * match). Défaut : le sujet.
   */
  tag?: string;
};

/** Ce que le service worker reçoit, chiffré, dans le corps du push. */
export type PushPayload = {
  topic: PushTopic;
  title: string;
  body: string;
  url: string;
  tag: string;
};

export const PUSH_TITLE_MAX = 80;
export const PUSH_BODY_MAX = 240;
export const PUSH_TAG_MAX = 64;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(clean);
  return chars.length <= max ? clean : `${chars.slice(0, max - 1).join("")}…`;
}

/**
 * Chemin sûr à ouvrir au clic. Un **chemin du site** seulement — une URL
 * absolue vers le site est ramenée à son chemin, tout le reste retombe sur
 * l'accueil : la notification s'affiche sous le nom du site, elle ne doit pas
 * mener ailleurs.
 */
export function pushTargetPath(url: string, siteOrigin: string | null = null): string {
  let path = url.trim();
  if (siteOrigin && path.startsWith(siteOrigin)) path = path.slice(siteOrigin.length) || "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(path)) return "/";
  return path;
}

/**
 * Met en forme le contenu : textes bornés (un service de push refuse au-delà
 * de 4 Ko chiffrés, et un titre de trois lignes ne se lit pas), chemin filtré.
 */
export function buildPushPayload(
  topic: PushTopic,
  content: PushContent,
  siteOrigin: string | null = null,
): PushPayload {
  return {
    topic,
    title: clip(content.title, PUSH_TITLE_MAX) || "BlueGenji Esport",
    body: clip(content.body, PUSH_BODY_MAX),
    url: pushTargetPath(content.url, siteOrigin),
    tag: clip(content.tag ?? topic, PUSH_TAG_MAX) || topic,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Abonnement d'un appareil
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Services de push auxquels le serveur accepte d'écrire. L'adresse d'un
 * abonnement vient du navigateur, donc du client : sans liste, `POST
 * /api/push/subscriptions` ferait du serveur un relais de requêtes vers
 * n'importe quel hôte (réseau interne compris). Ce sont les services des
 * navigateurs du marché — Chrome, Edge, Opera, Brave, Samsung (FCM), Firefox
 * (Mozilla), Edge ancien (WNS), Safari (Apple).
 */
export const PUSH_SERVICE_HOSTS: readonly string[] = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
];

export const PUSH_ENDPOINT_MAX = 1024;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > PUSH_ENDPOINT_MAX) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** Décodage base64url tolérant (avec ou sans remplissage) ; `null` si invalide. */
export function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value)) return null;
  const base64 = value.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  if (base64.length % 4 === 1) return null;
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * La clé avec laquelle le navigateur a pris un abonnement
 * (`PushSubscription.options.applicationServerKey`) est-elle la clé publique
 * **actuelle** du site ? Un abonnement pris sous une ancienne paire reste dans
 * le navigateur, mais chaque envoi y est refusé : il faut le refaire. Clé
 * inconnue d'un côté ou de l'autre → on ne conclut rien (`true`) : mieux vaut
 * garder un abonnement qu'en détruire un sain.
 */
export function isSameServerKey(current: ArrayBuffer | null, publicKey: string): boolean {
  const expected = decodeBase64Url(publicKey);
  if (!current || !expected) return true;
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((byte, index) => byte === expected[index]);
}

export type PushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushSubscriptionError =
  | "INVALID_PUSH_SUBSCRIPTION"
  | "PUSH_SERVICE_NOT_ALLOWED";

/**
 * Valide un abonnement tel que `PushSubscription.toJSON()` le rend. La clé
 * publique doit être un point P-256 non compressé (65 octets, `0x04` en tête),
 * le secret d'authentification 16 octets (RFC 8291) : sans eux le chiffrement
 * du message est impossible, autant refuser à l'abonnement qu'échouer à chaque
 * envoi.
 */
export function parsePushSubscription(
  input: unknown,
): { ok: true; value: PushSubscriptionInput } | { ok: false; error: PushSubscriptionError } {
  const invalid = { ok: false as const, error: "INVALID_PUSH_SUBSCRIPTION" as const };
  if (!input || typeof input !== "object") return invalid;
  const raw = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null };
  if (typeof raw.endpoint !== "string" || !raw.keys || typeof raw.keys !== "object") return invalid;
  const { p256dh, auth } = raw.keys;
  if (typeof p256dh !== "string" || typeof auth !== "string") return invalid;
  const publicKey = decodeBase64Url(p256dh);
  const secret = decodeBase64Url(auth);
  if (!publicKey || publicKey.length !== 65 || publicKey[0] !== 0x04) return invalid;
  if (!secret || secret.length !== 16) return invalid;
  if (!isAllowedPushEndpoint(raw.endpoint)) {
    return { ok: false, error: "PUSH_SERVICE_NOT_ALLOWED" };
  }
  return { ok: true, value: { endpoint: raw.endpoint, p256dh, auth } };
}

export const PUSH_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  INVALID_PUSH_SUBSCRIPTION: "Cet appareil a rendu un abonnement illisible. Réessaie, ou change de navigateur.",
  PUSH_SERVICE_NOT_ALLOWED: "Le service de notifications de ce navigateur n'est pas pris en charge.",
  PUSH_NOT_CONFIGURED: "Les notifications push ne sont pas encore activées sur le site.",
  PUSH_PERMISSION_DENIED:
    "Ton navigateur bloque les notifications de ce site. Autorise-les dans ses réglages, puis réessaie.",
  PUSH_UNSUPPORTED: "Ce navigateur ne sait pas recevoir de notifications push.",
  INVALID_PUSH_TOPICS: "Réglages de notifications illisibles.",
  PUSH_LOAD_FAILED: "Les réglages de notifications n'ont pas pu être lus.",
};

export function pushErrorMessage(code: string | null | undefined): string {
  return (code && PUSH_ERROR_MESSAGES[code]) || "Les notifications n'ont pas pu être réglées. Réessaie dans un instant.";
}

/**
 * Durée au-delà de laquelle un abonnement qui n'a rien reçu est oublié — un
 * appareil perdu ne prévient pas le site. Déclarée au registre des traitements,
 * d'où l'import par le serveur : le registre ne peut annoncer une durée que le
 * code ne tient pas.
 */
export const PUSH_SUBSCRIPTION_RETENTION_DAYS = 180;

/** Chemin du service worker — à la racine, pour que sa portée couvre tout le site. */
export const PUSH_SERVICE_WORKER_PATH = "/push-sw.js";

// ─────────────────────────────────────────────────────────────────────────────
// Ce que le navigateur sait faire
// ─────────────────────────────────────────────────────────────────────────────

/**
 * - `UNSUPPORTED` : pas de service worker ou pas d'API Push ;
 * - `IOS_NEEDS_INSTALL` : iPhone ou iPad hors de l'écran d'accueil — Safari ne
 *   livre les notifications qu'au site **ajouté à l'écran d'accueil**, et
 *   n'expose même pas l'API avant : sans ce cas, le panneau dirait « navigateur
 *   non compatible » à qui n'a qu'un geste à faire ;
 * - `DENIED` : le joueur a bloqué les notifications du site dans son navigateur
 *   — seul lui peut les rouvrir, dans les réglages ; un bouton n'y peut rien ;
 * - `AVAILABLE` : on peut s'abonner.
 */
export type PushSupport = "UNSUPPORTED" | "IOS_NEEDS_INSTALL" | "DENIED" | "AVAILABLE";

export function pushSupport(env: {
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  permission: "default" | "granted" | "denied" | null;
  ios: boolean;
  standalone: boolean;
}): PushSupport {
  if (env.ios && !env.standalone) return "IOS_NEEDS_INSTALL";
  if (!env.serviceWorker || !env.pushManager || !env.notification) return "UNSUPPORTED";
  if (env.permission === "denied") return "DENIED";
  return "AVAILABLE";
}

/** iPhone, iPad (qui se déclare Macintosh tactile depuis iPadOS 13) ou iPod. */
export function isIosUserAgent(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

export const PUSH_SUPPORT_NOTICES: Record<Exclude<PushSupport, "AVAILABLE">, string> = {
  UNSUPPORTED: "Ce navigateur ne sait pas recevoir de notifications push.",
  IOS_NEEDS_INSTALL:
    "Sur iPhone et iPad, ajoute d'abord le site à l'écran d'accueil (bouton Partager, puis « Sur l'écran d'accueil »), puis ouvre-le depuis son icône.",
  DENIED:
    "Tu as bloqué les notifications de ce site dans ton navigateur. Autorise-les dans ses réglages (icône à gauche de l'adresse), puis recharge la page.",
};
