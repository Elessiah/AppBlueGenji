/**
 * Fréquentation du serveur officiel de GETI, pour sa carte en tête de
 * `/geti-info` — `docs/features/GETI_INFO.md` § Page.
 *
 * Même porte que le compteur de notre serveur (`lib/server/discord-community.ts`) :
 * l'invitation publique, sans jeton ni bot. Le chiffre est un **agrément** :
 * Discord muet, plafonné ou invitation inconnue de l'API → `null`, et la carte
 * se rend sans lui. L'échec est mis en cache comme le succès.
 */
import { cached } from "@/lib/server/cache";
import { parseDiscordCommunityStats, type DiscordCommunityStats } from "@/lib/shared/discord";
import { GETI_OFFICIAL_INVITE_CODE } from "@/lib/shared/geti/page";

const CACHE_KEY = "discord:geti-community";
/** Trente minutes : un ordre de grandeur suffit, et la page est rendue à chaque visite. */
const TTL_MS = 30 * 60_000;
/** Borne dure de l'appel sortant. */
const TIMEOUT_MS = 1_200;

const ENDPOINT = `https://discord.com/api/v10/invites/${encodeURIComponent(
  GETI_OFFICIAL_INVITE_CODE,
)}?with_counts=true&with_expiration=false`;

async function loadGetiCommunity(): Promise<DiscordCommunityStats | null> {
  try {
    const response = await fetch(ENDPOINT, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseDiscordCommunityStats(await response.json());
  } catch {
    return null;
  }
}

/** Fréquentation du serveur GETI, mutualisée ; `null` si Discord ne la donne pas. */
export function getGetiCommunity(): Promise<DiscordCommunityStats | null> {
  return cached(CACHE_KEY, TTL_MS, loadGetiCommunity);
}
