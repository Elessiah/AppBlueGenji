import type {
  BotStats,
  BotStatus,
  BotKpis,
  BotServersPayload,
  BotActivity,
  SiteVisitStats,
} from "@/lib/shared/types";
import { normalizeBotServersPayload, normalizeBotStats } from "@/lib/shared/bot-message-window";
import type { LiveMentionTarget } from "@/lib/shared/live-announcements";

const DEFAULT_BOT_INTERNAL_HOST = "127.0.0.1";
const DEFAULT_BOT_INTERNAL_PORT = "4400";

const BOT_FETCH_TIMEOUT_MS = 1500; // degradation gracieuse : 1.5 s max
const BOT_LOGIN_FETCH_TIMEOUT_MS = 3000; // login = action utilisateur, on tolère un peu moins
// Une distribution de messages privés enchaîne un appel Discord par
// destinataire : la fenêtre des lectures (1,5 s) la couperait en plein envoi.
const BOT_NOTIFY_FETCH_TIMEOUT_MS = 15_000;
// Alerter les arbitres suppose en plus de récupérer les membres de leur rôle,
// dont le coût dépend de la taille du serveur : on laisse plus de temps encore,
// pour ne pas répondre « pas envoyé » à un signalement qui partira.
const BOT_REFEREE_FETCH_TIMEOUT_MS = 30_000;

// Circuit breaker simple : si N échecs consécutifs, on court-circuite pendant T ms
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;

function isCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

/**
 * `true` tant que le coupe-circuit est ouvert : le bot vient d'échouer
 * plusieurs fois d'affilée et rien ne part.
 *
 * Exporté pour les appelants qui **réservent** un envoi avant de le faire
 * (`lib/server/tournaments/bot-logs.ts`) : réserver ce qu'on sait ne pas
 * pouvoir envoyer, puis rendre la réservation, ferait tourner une pompe
 * d'`INSERT`/`DELETE` pendant toute la panne.
 */
export function isBotCircuitOpen(): boolean {
  return isCircuitOpen();
}

function recordFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    consecutiveFailures = 0;
  }
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

function getInternalHeaders(): HeadersInit {
  const token = process.env.BOT_INTERNAL_TOKEN;
  return token ? { "x-internal-token": token } : {};
}

function resolveBotInternalUrl(): string {
  const directUrl = process.env.BOT_INTERNAL_URL?.trim();
  if (directUrl) {
    return directUrl.replace(/\/+$/, ""); // NOSONAR typescript:S8786 — configuration du serveur, pas une entrée utilisateur
  }

  const host = process.env.BOT_INTERNAL_HOST?.trim() || DEFAULT_BOT_INTERNAL_HOST;
  const port = process.env.BOT_INTERNAL_PORT?.trim() || DEFAULT_BOT_INTERNAL_PORT;
  return `http://${host}:${port}`;
}

function emptyBotStats(): BotStats {
  return {
    affiliatedServers: 0,
    affiliatedChannels: 0,
    messagesLast7Days: 0,
    relayedMessagesLast7Days: 0,
    uniqueUsersLast7Days: 0,
  };
}

/**
 * Le code d'une **résolution de tag** qui n'a pas abouti côté réseau.
 *
 * Deux faits différents, que le site confondait : le bot n'a pas répondu du
 * tout (connexion refusée — `BOT_INTERNAL_UNREACHABLE`), ou il a reçu la
 * demande mais n'a pas répondu à temps (`BOT_RESOLVE_TIMEOUT`). Le second était
 * le cas ordinaire d'un tag absent des serveurs du bot, qu'il balayait alors un
 * à un : rendu en « bot non joignable », il faisait passer un joueur absent de
 * ces serveurs pour une panne. Le bot interroge désormais ses serveurs de front,
 * sous un délai plus court que le nôtre, et répond lui-même `504
 * BOT_RESOLVE_TIMEOUT` à l'échéance (voir {@link resolveDiscordUser}) : ce
 * chemin-ci ne reste que pour un bot trop chargé pour répondre du tout, ou d'une
 * version antérieure.
 *
 * Réservé à la résolution, et le nom le dit : un envoi de code qui dépasse son
 * délai survient **après** une résolution réussie — le tag n'y est pour rien, et
 * le message privé est peut-être parti. Il garde donc son code d'origine.
 */
function resolveFailureCode(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError"
    ? "BOT_RESOLVE_TIMEOUT"
    : "BOT_INTERNAL_UNREACHABLE";
}

async function safeReadError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // ignore json parse failures and fallback to plain text
  }

  try {
    const text = (await response.text()).trim();
    return text || "BOT_INTERNAL_REQUEST_FAILED";
  } catch {
    return "BOT_INTERNAL_REQUEST_FAILED";
  }
}

export async function fetchBotStats(): Promise<BotStats> {
  if (isCircuitOpen()) {
    return emptyBotStats(); // court-circuit, retour immédiat
  }

  const baseUrl = resolveBotInternalUrl();

  try {
    const response = await fetch(`${baseUrl}/internal/stats`, {
      method: "GET",
      headers: getInternalHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(BOT_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      recordFailure();
      return emptyBotStats();
    }

    recordSuccess();
    return normalizeBotStats(await response.json());
  } catch {
    recordFailure();
    return emptyBotStats();
  }
}

/**
 * Résout un identifiant Discord fourni par l'utilisateur en Discord ID numérique.
 * - Un ID numérique (5–32 chiffres) est renvoyé tel quel, sans solliciter le bot (option de repli).
 * - Un tag (`pseudo` ou legacy `pseudo#1234`) est résolu par le bot s'il partage un serveur
 *   avec l'utilisateur, sinon `DISCORD_USER_NOT_FOUND` est levé.
 *
 * Le repli par ID ne saute que la **recherche** : l'envoi qui suit exige quand
 * même un serveur commun, Discord refusant un message privé d'un bot à qui n'en
 * partage aucun avec lui (`DISCORD_DM_FAILED`).
 */
export async function resolveDiscordUser(handle: string): Promise<string> {
  const trimmed = handle.trim();

  // Repli : ID numérique direct, sans balayer les serveurs du bot.
  if (/^\d{5,32}$/.test(trimmed)) {
    return trimmed;
  }

  const baseUrl = resolveBotInternalUrl();

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/internal/auth/resolve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...getInternalHeaders(),
      },
      body: JSON.stringify({ handle: trimmed }),
      cache: "no-store",
      signal: AbortSignal.timeout(BOT_LOGIN_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(resolveFailureCode(error));
  }

  if (response.ok) {
    const payload = (await response.json()) as { discordId?: string };
    if (payload.discordId && /^\d{5,32}$/.test(payload.discordId)) {
      return payload.discordId;
    }
    throw new Error("DISCORD_USER_NOT_FOUND");
  }

  if (response.status === 401) {
    throw new Error("BOT_INTERNAL_UNAUTHORIZED");
  }
  if (response.status === 404) {
    throw new Error("DISCORD_USER_NOT_FOUND");
  }
  // Le bot borne sa recherche et répond 504 quand des serveurs n'ont pas
  // répondu à temps : le joueur y est peut-être, ce n'est pas un « introuvable ».
  // Lu sur le statut et non sur le corps, qu'un relais pourrait réécrire.
  if (response.status === 504) {
    throw new Error("BOT_RESOLVE_TIMEOUT");
  }

  throw new Error(await safeReadError(response));
}

export async function sendDiscordLoginCode(discordId: string, code: string): Promise<void> {
  const baseUrl = resolveBotInternalUrl();

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/internal/auth/send-code`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...getInternalHeaders(),
      },
      body: JSON.stringify({ discordId, code }),
      cache: "no-store",
      signal: AbortSignal.timeout(BOT_LOGIN_FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new Error("BOT_INTERNAL_UNREACHABLE");
  }

  if (response.ok) return;

  if (response.status === 401) {
    throw new Error("BOT_INTERNAL_UNAUTHORIZED");
  }

  const upstreamError = await safeReadError(response);
  if (upstreamError === "DISCORD_DM_FAILED") {
    throw new Error("DISCORD_DM_FAILED");
  }

  throw new Error(upstreamError);
}

export async function sendBotLog(message: string): Promise<void> {
  if (isCircuitOpen()) return; // best-effort : on skip silencieusement

  const baseUrl = resolveBotInternalUrl();

  try {
    const response = await fetch(`${baseUrl}/internal/log`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...getInternalHeaders(),
      },
      body: JSON.stringify({ message }),
      cache: "no-store",
      signal: AbortSignal.timeout(BOT_FETCH_TIMEOUT_MS),
    });
    if (response.ok) recordSuccess();
    else recordFailure();
  } catch {
    recordFailure();
    // Best-effort : on ne propage pas l'erreur.
  }
}

/**
 * Pousse la fréquentation du site au bot Discord, qui la conserve et la sert à
 * sa commande `/stats-site`.
 *
 * Passe par le canal interne déjà en place (même URL, même `x-internal-token`,
 * même coupe-circuit) : le bot n'a donc jamais besoin d'appeler le site en
 * retour ni d'accéder à MySQL. Meilleur effort — un bot injoignable laisse
 * simplement le dernier instantané en place.
 */
export async function pushSiteVisitStats(stats: SiteVisitStats): Promise<void> {
  if (isCircuitOpen()) return;

  const baseUrl = resolveBotInternalUrl();

  try {
    const response = await fetch(`${baseUrl}/internal/site-visits`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...getInternalHeaders(),
      },
      body: JSON.stringify(stats),
      cache: "no-store",
      signal: AbortSignal.timeout(BOT_FETCH_TIMEOUT_MS),
    });
    if (response.ok) recordSuccess();
    else recordFailure();
  } catch {
    recordFailure();
    // Best-effort : la fréquentation ne doit jamais faire échouer une visite.
  }
}

/**
 * Destinataire d'un message privé Discord, tel que le site le connaît.
 *
 * `discordId` est renseigné pour tout compte entré ou certifié par Discord
 * (OAuth ou code), et prime ; à défaut, le `handle` (tag) suffit. Dans les deux
 * cas, le bot ne cherche le membre que **sur le serveur BlueGenji** — la seule
 * population qu'il démarche. Un joueur qui n'y est pas ne reçoit aucune
 * tentative d'envoi, et revient dans `unresolved`.
 */
export type DiscordRecipient = {
  discordId: string | null;
  handle: string | null;
  label: string;
};

/** Bilan d'une distribution, tel que le bot le rend. */
export type DiscordDeliveryReport = {
  sent: number;
  unresolved: string[];
  failed: string[];
};

/**
 * Bilan vide. Une fabrique, pas une constante partagée : les deux tableaux
 * seraient sinon la même instance dans tous les bilans rendus.
 */
function emptyDelivery(): DiscordDeliveryReport {
  return { sent: 0, unresolved: [], failed: [] };
}

async function postDiscordNotification(
  path: string,
  body: unknown,
  options: { timeoutMs: number; honourCircuit: boolean },
): Promise<DiscordDeliveryReport | null> {
  if (options.honourCircuit && isCircuitOpen()) return null;

  const baseUrl = resolveBotInternalUrl();

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...getInternalHeaders(),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs),
    });

    if (!response.ok) {
      recordFailure();
      return null;
    }

    recordSuccess();
    return { ...emptyDelivery(), ...((await response.json()) as Partial<DiscordDeliveryReport>) };
  } catch {
    recordFailure();
    return null;
  }
}

/**
 * Envoie un message privé Discord à une liste de joueurs.
 *
 * Meilleur effort, comme tout ce qui passe par le canal interne : un bot
 * injoignable ne doit pas faire échouer la lecture d'une page de tournoi, qui
 * est ce qui déclenche le balayage des rappels.
 *
 * @returns Le bilan du bot, ou `null` s'il est injoignable.
 */
export async function pushDiscordDirectMessages(
  message: string,
  recipients: DiscordRecipient[],
  context: string,
): Promise<DiscordDeliveryReport | null> {
  if (recipients.length === 0) return emptyDelivery();
  return postDiscordNotification(
    "/internal/notify/dm",
    { message, recipients, context },
    { timeoutMs: BOT_NOTIFY_FETCH_TIMEOUT_MS, honourCircuit: true },
  );
}

/**
 * Alerte les arbitres : canal de logs du bot **et** message privé à chaque
 * membre du rôle arbitre configuré côté Discord (`/set-referee-role`).
 *
 * Contrairement aux rappels, l'échec est **remonté à l'appelant** (`null`) : un
 * signalement est une action utilisateur, et lui répondre « c'est parti » quand
 * rien n'est parti serait un mensonge — le joueur attendrait un arbitre qui
 * n'a rien reçu.
 *
 * Le coupe-circuit est **ignoré ici**, comme pour l'envoi du code de connexion :
 * il protège le site d'un bot en panne quand le trafic de fond le sollicite en
 * boucle, mais un balayage de rappels qui vient de l'ouvrir refuserait alors le
 * signalement d'un joueur sans même essayer. Une action explicite mérite sa
 * tentative.
 *
 * Ce raisonnement vaut pour une **action utilisateur**, pas pour le trafic de
 * fond : les alertes que le moteur produit lui-même (conflit de score, report
 * expiré) passent `honourCircuit: true`, personne n'attendant leur réponse.
 * Sans cela, un bot éteint ferait patienter chaque flux d'arrière-plan sur la
 * fenêtre de 30 s que la recherche des membres du rôle impose.
 *
 * @param message Texte déjà rédigé, borné côté bot.
 * @param context Étiquette de journalisation côté bot (« issue-report », …).
 * @param options `honourCircuit` : respecter le coupe-circuit (défaut `false`).
 * @returns Le bilan du bot, ou `null` s'il est injoignable — jamais d'exception.
 */
export async function pushRefereeAlert(
  message: string,
  context: string,
  options: { honourCircuit?: boolean } = {},
): Promise<DiscordDeliveryReport | null> {
  return postDiscordNotification(
    "/internal/notify/referees",
    { message, context },
    {
      timeoutMs: BOT_REFEREE_FETCH_TIMEOUT_MS,
      honourCircuit: options.honourCircuit ?? false,
    },
  );
}

export async function fetchBotStatus(): Promise<BotStatus | null> {
  if (isCircuitOpen()) {
    return null;
  }

  const baseUrl = resolveBotInternalUrl();

  try {
    const response = await fetch(`${baseUrl}/internal/status`, {
      method: "GET",
      headers: getInternalHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(BOT_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      recordFailure();
      return null;
    }

    recordSuccess();
    return (await response.json()) as BotStatus;
  } catch {
    recordFailure();
    return null;
  }
}

export async function fetchBotKpis(): Promise<BotKpis | null> {
  if (isCircuitOpen()) {
    return null;
  }

  const baseUrl = resolveBotInternalUrl();

  try {
    const response = await fetch(`${baseUrl}/internal/kpis`, {
      method: "GET",
      headers: getInternalHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(BOT_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      recordFailure();
      return null;
    }

    recordSuccess();
    return (await response.json()) as BotKpis;
  } catch {
    recordFailure();
    return null;
  }
}

export async function fetchBotServers(limit: number = 8): Promise<BotServersPayload | null> {
  if (isCircuitOpen()) {
    return null;
  }

  const baseUrl = resolveBotInternalUrl();

  try {
    const url = new URL(`${baseUrl}/internal/servers`);
    url.searchParams.set("limit", limit.toString());
    url.searchParams.set("offset", "0");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: getInternalHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(BOT_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      recordFailure();
      return null;
    }

    recordSuccess();
    return normalizeBotServersPayload(await response.json());
  } catch {
    recordFailure();
    return null;
  }
}

/**
 * Activité du bot (relais et scrims par jour) sur **7 jours**.
 *
 * Le bot accepte aussi `30j` et `90j`, mais ses relais (`DPMsg`) sont purgés à
 * 7 jours sans compteur journalier qui les prolonge : au-delà, la série ne
 * valait que des zéros. Le site ne demande donc plus que la plage conservée.
 * @returns La charge du bot, ou `null` s'il est injoignable.
 */
export async function fetchBotActivity(): Promise<BotActivity | null> {
  if (isCircuitOpen()) {
    return null;
  }

  const baseUrl = resolveBotInternalUrl();

  try {
    const url = new URL(`${baseUrl}/internal/activity`);
    url.searchParams.set("range", "7j");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: getInternalHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(BOT_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      recordFailure();
      return null;
    }

    recordSuccess();
    return (await response.json()) as BotActivity;
  } catch {
    recordFailure();
    return null;
  }
}


/**
 * Alerte la direction de l'association : canal de logs du bot **et** message
 * privé au propriétaire (`OWNER_ID`) et au président (`PRESIDENT`), tels que
 * le bot les connaît — le site ne détient pas leurs identifiants Discord.
 *
 * Sert aux signalements (`lib/server/content-reports.ts`). Le coupe-circuit est
 * ignoré, comme pour l'alerte des arbitres : chaque appel suit l'action d'une
 * personne, qui mérite sa tentative.
 *
 * @param message Texte déjà rédigé, sans donnée nominative d'un joueur.
 * @param context Étiquette de journalisation côté bot.
 * @returns Le bilan du bot, ou `null` s'il est injoignable — jamais d'exception.
 */
export async function pushLeadershipAlert(
  message: string,
  context: string,
): Promise<DiscordDeliveryReport | null> {
  return postDiscordNotification(
    "/internal/notify/leadership",
    { message, context },
    { timeoutMs: BOT_NOTIFY_FETCH_TIMEOUT_MS, honourCircuit: false },
  );
}

/**
 * Issue d'une annonce de live poussée au bot :
 *
 * - `posted` — le bot a publié dans #live, avec la mention `@everyone` ;
 * - `posted-silent` — publié, mais **sans notifier** : le bot n'a pas la
 *   permission de mentionner tout le serveur dans #live (le bot le signale au
 *   canal de logs ; renvoyer reposterait le même message) ;
 * - `rejected` — le bot a refusé le corps (`400`) : le renvoyer tel quel ne
 *   changerait rien, l'annonce est abandonnée ;
 * - `channel-closed` — le bot a répondu `503` : salon #live introuvable ou
 *   fermé au bot (permission), rien n'est parti ;
 * - `discord-refused` — le bot a répondu `503` : une règle AutoMod a bloqué
 *   le message. Il serait bloqué de nouveau (et chaque essai alerterait la
 *   modération) : l'appelant **garde** sa réservation, comme sur un `400` ;
 * - `discord-held` — le bot a répondu `503` : Discord a refusé le message pour
 *   une raison qui peut se régler (état du salon), rien n'est parti ;
 * - `discord-unreachable` — le bot a répondu `503` : Discord n'a pas répondu
 *   en lisant le salon (panne passagère, qui touche tout envoi), rien n'est
 *   parti ;
 * - `uncertain` — le bot a répondu que Discord a lâché pendant l'envoi
 *   (`503`, `reason` `discord-down`) : l'annonce a pu partir, l'envoi est
 *   terminé ;
 * - `timed-out` — le bot n'a pas répondu à temps : son envoi peut **encore**
 *   être en cours (Discord lent, limite de débit) ;
 * - `interrupted` — la requête a atteint le bot, qui l'a lâchée sans bilan
 *   (connexion coupée, par exemple par un redémarrage pendant l'envoi) : il a
 *   pu publier avant.
 *
 * Sur `uncertain`, `timed-out` et `interrupted`, l'appelant **garde** sa
 * réservation : une
 * annonce perdue vaut mieux qu'un second `@everyone` à tout le serveur ;
 * - `unauthorized` — le bot a refusé le jeton interne (`401`), ou n'en a
 *   pas (`503` `INTERNAL_API_TOKEN_NOT_CONFIGURED`) : rien n'est parti, la
 *   configuration est en cause, pas le bot ;
 * - `unavailable` — rien n'est parti pour une autre raison (bot injoignable,
 *   coupe-circuit ouvert, bot d'une version antérieure, panne).
 *
 * Sur `channel-closed`, `discord-held`, `discord-unreachable`, `unauthorized`
 * et `unavailable`, l'appelant rend sa réservation et réessaiera.
 */
export type LiveAnnouncementOutcome =
  | "posted"
  | "posted-silent"
  | "rejected"
  | "channel-closed"
  | "discord-held"
  | "discord-unreachable"
  | "discord-refused"
  | "uncertain"
  | "timed-out"
  | "interrupted"
  | "unauthorized"
  | "unavailable";

/** Raisons d'un `503` du bot qui désignent le salon ou les permissions du bot. */
const CHANNEL_CLOSED_REASONS = new Set(["missing", "no-view", "no-send", "send-denied"]);

/** Raisons d'un `503` du bot qui disent qu'AutoMod a bloqué le message lui-même. */
const DISCORD_REFUSED_REASONS = new Set(["automod"]);

/**
 * Classe un `503` du bot par sa raison (`reason`). Un `503` d'annonce sans
 * raison (bot d'une version antérieure) est lu comme un salon fermé, comme
 * avant ; un autre `503` (configuration du bot) comme un bot indisponible.
 */
async function classifyUnavailable(
  response: Response,
): Promise<
  "channel-closed" | "discord-held" | "discord-unreachable" | "discord-refused" | "uncertain" | "timed-out" | "unauthorized" | "unavailable"
> {
  let body: { error?: unknown; reason?: unknown } | null;
  try {
    body = (await response.json()) as { error?: unknown; reason?: unknown } | null;
  } catch (error) {
    // Corps coupé ou illisible : il pouvait dire `discord-down` (l'annonce a pu
    // partir). Rendre la réservation risquerait un second `@everyone`.
    return isTimeoutError(error) ? "timed-out" : "uncertain";
  }
  if (body?.error === "INTERNAL_API_TOKEN_NOT_CONFIGURED") return "unauthorized";
  // Un autre `503` du bot (configuration) ne parle pas de #live.
  if (body?.error !== "LIVE_CHANNEL_UNAVAILABLE") return "unavailable";
  const reason = body.reason;
  if (typeof reason !== "string" || CHANNEL_CLOSED_REASONS.has(reason)) return "channel-closed";
  // Discord a lâché pendant l'envoi : le message a pu partir.
  if (reason === "discord-down") return "uncertain";
  // Bloqué par AutoMod : le renvoyer tel quel serait bloqué de nouveau, et
  // chaque essai alerterait la modération.
  if (DISCORD_REFUSED_REASONS.has(reason)) return "discord-refused";
  // Discord muet en lisant le salon : la panne vaut pour tout envoi.
  if (reason === "discord-unreachable") return "discord-unreachable";
  return "discord-held";
}

/** Vrai si `fetch` a échoué parce que le délai d'attente est écoulé. */
function isTimeoutError(error: unknown): boolean {
  // `DOMException` n'hérite pas toujours d'`Error` selon l'environnement : lu par son nom.
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Codes d'une connexion qui n'a pas abouti : la requête n'est jamais partie
 * (bot arrêté, hôte inconnu), rien n'a pu être publié.
 */
const NOT_CONNECTED_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/**
 * Vrai si `fetch` a échoué **avant** que la requête n'atteigne le bot. Une
 * erreur sans code de connexion (configuration illisible) n'a rien envoyé non
 * plus ; une connexion coupée en route (`ECONNRESET`, socket fermée), si : le
 * bot a pu publier avant de tomber.
 */
function failedBeforeSending(error: unknown): boolean {
  const cause = typeof error === "object" && error !== null ? (error as { cause?: unknown }).cause : undefined;
  const code = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  return typeof code !== "string" || NOT_CONNECTED_CODES.has(code);
}

/** Relâche un corps de réponse qu'on ne lira pas. Ne lève jamais. */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Flux déjà fermé : rien à relâcher.
  }
}

/** Identifiant de message Discord (snowflake) rendu par le bot. */
const DISCORD_MESSAGE_ID = /^\d{17,20}$/;

/**
 * Lit le bilan du bot : `mentionEveryone` (un corps illisible vaut une mention
 * faite) et l'identifiant du message publié ou modifié (`null` : bot d'une
 * version sans annonces de soirée, ou corps illisible).
 */
async function readAnnounceReport(response: Response): Promise<{ silent: boolean; messageId: string | null }> {
  try {
    const body = (await response.json()) as { mentionEveryone?: unknown; messageId?: unknown } | null;
    const messageId = typeof body?.messageId === "string" && DISCORD_MESSAGE_ID.test(body.messageId) ? body.messageId : null;
    return { silent: body?.mentionEveryone === false, messageId };
  } catch {
    return { silent: false, messageId: null };
  }
}

/** Corps d'une annonce de soirée (`POST /internal/announce/live`). */
export interface LiveEveningPush {
  /** Texte de `formatLiveEvening`, jetons `{{lien:N}}` compris. */
  message: string;
  /** Liens des jetons, dans l'ordre ; le premier est aussi `streamUrl`. */
  streamUrls: string[];
  /** Public : `everyone` (chaîne officielle) ou `stream-viewer`. */
  mention: LiveMentionTarget;
  context: string;
  /** Version sans pseudo, citée au canal de logs ; omise si identique. */
  logMessage?: string;
  /** Message de la soirée déjà publié : le bot le modifie, sans notifier. */
  editMessageId?: string;
}

/** Issue d'une annonce de soirée, et l'identifiant du message publié ou modifié. */
export interface LiveEveningPushResult {
  outcome: LiveAnnouncementOutcome;
  messageId: string | null;
}

/**
 * Demande au bot de publier — ou de modifier — l'annonce d'une soirée dans
 * #live. Mêmes issues que {@link pushLiveAnnouncement}, plus l'identifiant du
 * message, gardé par le site pour les modifications suivantes.
 */
export async function pushLiveEvening(request: LiveEveningPush): Promise<LiveEveningPushResult> {
  const { streamUrls, ...rest } = request;
  return postLiveAnnouncement({ ...rest, streamUrl: streamUrls[0], streamUrls });
}

/**
 * Demande au bot d'annoncer un live dans le salon #live du serveur BlueGenji
 * (`POST /internal/announce/live`) : il préfixe `@everyone` et ajoute le lien.
 *
 * Trafic de fond (le balayage des annonces) : le coupe-circuit est respecté,
 * et jamais d'exception.
 *
 * @param message Texte rédigé par `formatLiveAnnouncementGroup`, noms neutralisés.
 * @param streamUrl Lien déjà validé par la liste blanche.
 * @param context Étiquette de journalisation côté bot.
 * @param logMessage Version **sans pseudo** du texte, que le bot cite à la
 *   place de `message` dans son canal de logs quand l'annonce échoue : le
 *   pseudo d'une entrée individuelle n'a sa place que dans #live
 *   (`RGPD_LOGS_AND_VISITS.md`). Omise quand le texte ne nomme aucun joueur.
 */
export async function pushLiveAnnouncement(
  message: string,
  streamUrl: string,
  context: string,
  logMessage?: string,
): Promise<LiveAnnouncementOutcome> {
  const body = logMessage === undefined ? { message, streamUrl, context } : { message, streamUrl, context, logMessage };
  return (await postLiveAnnouncement(body)).outcome;
}

/** Envoi commun des annonces : issue classée et identifiant du message. */
async function postLiveAnnouncement(body: Record<string, unknown>): Promise<LiveEveningPushResult> {
  const outcome = (value: LiveAnnouncementOutcome, messageId: string | null = null): LiveEveningPushResult => ({
    outcome: value,
    messageId,
  });
  if (isCircuitOpen()) return outcome("unavailable");

  const baseUrl = resolveBotInternalUrl();
  try {
    const response = await fetch(`${baseUrl}/internal/announce/live`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...getInternalHeaders(),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(BOT_NOTIFY_FETCH_TIMEOUT_MS),
    });
    if (response.ok) {
      recordSuccess();
      const report = await readAnnounceReport(response);
      return outcome(report.silent ? "posted-silent" : "posted", report.messageId);
    }
    // Un refus du corps n'est pas une panne du bot : il a répondu.
    if (response.status === 400) {
      recordSuccess();
      await discardBody(response);
      return outcome("rejected");
    }
    // Un bot d'une version antérieure ne connaît pas la route, ou le salon
    // #live lui est fermé (`503`, permission retirée) : il a répondu, le
    // coupe-circuit n'a pas à s'ouvrir — il suspendrait les rappels et alertes
    // de fond pour un réglage de salon ; l'annonce attendra.
    if (response.status === 503) return outcome(await classifyUnavailable(response));
    // Jeton interne refusé : une configuration à corriger, pas un bot en
    // panne — le coupe-circuit des autres appels n'a pas à s'ouvrir.
    if (response.status === 401) {
      await discardBody(response);
      return outcome("unauthorized");
    }
    // Corps non lu : le relâcher rend la connexion au pool, au lieu de la
    // laisser occupée jusqu'au ramasse-miettes à chaque nouvel essai.
    await discardBody(response);
    if (response.status === 404) return outcome("unavailable");
    recordFailure();
    // Un `500` du bot (`LIVE_ANNOUNCEMENT_FAILED`) naît avant l'envoi : toute
    // erreur de l'envoi lui-même revient en `503` classé (`discord-down`…).
    return outcome("unavailable");
  } catch (error) {
    // Le délai écoulé ne dit pas que rien n'est parti : la requête a pu
    // atteindre le bot, qui publie encore (Discord lent ou limitant #live). Il
    // n'est pas compté comme une panne : quelques envois lents dans un salon ne
    // doivent pas suspendre les rappels et alertes de fond.
    if (isTimeoutError(error)) return outcome("timed-out");
    recordFailure();
    // Connexion coupée en route (bot redémarré par un déploiement après son
    // envoi, avant sa réponse) : l'annonce a pu partir.
    return outcome(failedBeforeSending(error) ? "unavailable" : "interrupted");
  }
}
