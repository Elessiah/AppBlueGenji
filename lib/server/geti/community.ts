/**
 * Fréquentation du serveur officiel de GETI, pour sa carte en tête de
 * `/geti-info` — `docs/features/GETI_INFO.md` § Page.
 *
 * Même porte que le compteur de notre serveur (`lib/server/discord-community.ts`) :
 * l'invitation publique, sans jeton ni bot. Le chiffre est un **agrément** :
 * Discord muet, plafonné ou invitation inconnue de l'API → `null`, et la carte
 * se rend sans lui. Un échec n'est jamais gardé aussi
 * longtemps qu'un succès : une courte fenêtre d'abstention (`FAILURE_TTL_MS`) épargne Discord, puis la page retente.
 */
import { cached, isCachedOrLoading } from "@/lib/server/cache";
import { parseDiscordCommunityStats, type DiscordCommunityStats } from "@/lib/shared/discord";
import { GETI_OFFICIAL_INVITE_CODE } from "@/lib/shared/geti/page";

const CACHE_KEY = "discord:geti-community";
const FAILURE_KEY = "discord:geti-community:failure";
/** Une minute sans réinterroger Discord après un échec : un à-coup ne cache pas le chiffre une demi-heure. */
const FAILURE_TTL_MS = 60_000;
/** Trente minutes : un ordre de grandeur suffit, et la page est rendue à chaque visite. */
const TTL_MS = 30 * 60_000;
/** Borne dure de l'appel sortant. */
const TIMEOUT_MS = 800;

const ENDPOINT = `https://discord.com/api/v10/invites/${encodeURIComponent(
  GETI_OFFICIAL_INVITE_CODE,
)}?with_counts=true&with_expiration=false`;

/** Discord n'a rien donné d'exploitable : un code court, jamais le texte de l'erreur. */
class CommunityUnavailable extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Lève quand Discord ne donne rien : `cached` ne garde jamais un échec. */
async function loadGetiCommunity(): Promise<DiscordCommunityStats> {
  const response = await fetch(ENDPOINT, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new CommunityUnavailable(`http-${response.status}`);
  const stats = parseDiscordCommunityStats(await response.json());
  if (!stats) throw new CommunityUnavailable("no-counts");
  return stats;
}

/** Fréquentation du serveur GETI, mutualisée ; `null` si Discord ne la donne pas. */
export async function getGetiCommunity(): Promise<DiscordCommunityStats | null> {
  if (isCachedOrLoading(FAILURE_KEY)) return null;
  try {
    return await cached(CACHE_KEY, TTL_MS, loadGetiCommunity);
  } catch (error) {
    // Une invitation inconnue de l'API se verrait ici, dans le journal, au lieu d'un chiffre qui manque sans trace.
    const code = error instanceof CommunityUnavailable ? error.code : "network";
    console.warn("[geti] member count unavailable:", code);
    await cached(FAILURE_KEY, FAILURE_TTL_MS, async () => true);
    return null;
  }
}
