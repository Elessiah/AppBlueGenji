import type {
  BotStats,
  BotStatus,
  BotKpis,
  BotServersPayload,
  BotActivity,
  BotModulesPayload,
  SiteVisitStats,
} from "@/lib/shared/types";

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
    return directUrl.replace(/\/+$/, "");
  }

  const host = process.env.BOT_INTERNAL_HOST?.trim() || DEFAULT_BOT_INTERNAL_HOST;
  const port = process.env.BOT_INTERNAL_PORT?.trim() || DEFAULT_BOT_INTERNAL_PORT;
  return `http://${host}:${port}`;
}

function emptyBotStats(): BotStats {
  return {
    affiliatedServers: 0,
    affiliatedChannels: 0,
    messagesLast30Days: 0,
    relayedMessagesLast30Days: 0,
    uniqueUsersLast30Days: 0,
  };
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
    return (await response.json()) as BotStats;
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
 */
export async function resolveDiscordUser(handle: string): Promise<string> {
  const trimmed = handle.trim();

  // Repli : ID numérique direct, pas besoin d'un serveur commun avec le bot.
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
  } catch {
    throw new Error("BOT_INTERNAL_UNREACHABLE");
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
 * `discordId` n'est renseigné que pour les comptes liés par code Discord ; le
 * `handle` (tag) suffit au bot, qui retrouve le membre **sur le serveur
 * BlueGenji** — la seule population qu'il démarche. Un joueur qui n'y est pas
 * ne reçoit aucune tentative d'envoi, et revient dans `unresolved`.
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
 * @returns Le bilan du bot, ou `null` s'il est injoignable.
 */
export async function pushRefereeAlert(
  message: string,
  context: string,
): Promise<DiscordDeliveryReport | null> {
  return postDiscordNotification(
    "/internal/notify/referees",
    { message, context },
    { timeoutMs: BOT_REFEREE_FETCH_TIMEOUT_MS, honourCircuit: false },
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
    return (await response.json()) as BotServersPayload;
  } catch {
    recordFailure();
    return null;
  }
}

export async function fetchBotActivity(
  range: "7j" | "30j" | "90j"
): Promise<BotActivity | null> {
  if (isCircuitOpen()) {
    return null;
  }

  const baseUrl = resolveBotInternalUrl();

  try {
    const url = new URL(`${baseUrl}/internal/activity`);
    url.searchParams.set("range", range);

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

export async function fetchBotModules(guildId: string): Promise<BotModulesPayload | null> {
  if (isCircuitOpen()) {
    return null;
  }

  const baseUrl = resolveBotInternalUrl();

  try {
    const response = await fetch(`${baseUrl}/internal/servers/${guildId}/modules`, {
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
    return (await response.json()) as BotModulesPayload;
  } catch {
    recordFailure();
    return null;
  }
}

