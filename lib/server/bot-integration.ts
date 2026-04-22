import type { BotStats } from "@/lib/shared/types";

const DEFAULT_BOT_INTERNAL_HOST = "127.0.0.1";
const DEFAULT_BOT_INTERNAL_PORT = "4400";

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
  const baseUrl = resolveBotInternalUrl();

  try {
    const response = await fetch(`${baseUrl}/internal/stats`, {
      method: "GET",
      headers: getInternalHeaders(),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Bot stats error: ${response.status}`);
    }

    return (await response.json()) as BotStats;
  } catch {
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
      signal: AbortSignal.timeout(8000),
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
  const baseUrl = resolveBotInternalUrl();

  try {
    await fetch(`${baseUrl}/internal/log`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...getInternalHeaders(),
      },
      body: JSON.stringify({ message }),
      cache: "no-store",
    });
  } catch {
    // Best effort: tournament flow should not crash if bot log endpoint is unavailable.
  }
}
