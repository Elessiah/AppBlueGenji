import type {
  BotStats,
  BotStatus,
  BotKpis,
  BotServersPayload,
  BotActivity,
  BotModuleKey,
  BotModulesPayload,
} from "@/lib/shared/types";

const DEFAULT_BOT_INTERNAL_HOST = "127.0.0.1";
const DEFAULT_BOT_INTERNAL_PORT = "4400";

const BOT_FETCH_TIMEOUT_MS = 1500; // degradation gracieuse : 1.5 s max
const BOT_LOGIN_FETCH_TIMEOUT_MS = 3000; // login = action utilisateur, on tolère un peu moins

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

export async function toggleBotModule(
  guildId: string,
  moduleKey: BotModuleKey,
  enabled: boolean
): Promise<{ ok: boolean }> {
  if (isCircuitOpen()) {
    return { ok: false };
  }

  const baseUrl = resolveBotInternalUrl();

  try {
    const response = await fetch(`${baseUrl}/internal/servers/${guildId}/modules/${moduleKey}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...getInternalHeaders(),
      },
      body: JSON.stringify({ enabled }),
      cache: "no-store",
      signal: AbortSignal.timeout(BOT_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      recordFailure();
      return { ok: false };
    }

    recordSuccess();
    return { ok: true };
  } catch {
    recordFailure();
    return { ok: false };
  }
}
