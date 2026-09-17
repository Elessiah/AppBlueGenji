import { cached } from "@/lib/server/cache";
import {
  DISCORD_INVITE_CODE,
  parseDiscordCommunityStats,
  type DiscordCommunityStats,
} from "@/lib/shared/discord";

/**
 * Combien sommes-nous sur le Discord ?
 *
 * **Par l'invitation, pas par le bot.** `GET /api/v10/invites/{code}?with_counts=true`
 * est public : ni jeton, ni identifiant de guilde, ni bot présent sur le serveur.
 * Trois raisons de le préférer au canal interne (`bot-integration.ts`), qui
 * saurait pourtant répondre. Le bot peut être injoignable — il l'est en
 * développement, et l'accueil afficherait alors un trou là où il tient une
 * promesse de communauté. Le sens des appels resterait app → bot, mais on
 * ajouterait une route interne pour une donnée que Discord publie déjà. Et
 * surtout, on compte **le serveur que le bouton d'à côté fait rejoindre** : le
 * code de l'invitation est la seule chose que le site connaisse de ce serveur,
 * un identifiant de guilde rangé en parallèle dériverait au premier changement
 * d'invitation, et le site annoncerait la fréquentation d'un serveur vers
 * lequel il ne mène plus.
 *
 * **Jamais d'exception, jamais de zéro.** Discord en panne, Discord qui nous
 * plafonne, réseau coupé : la fonction rend `null` et l'accueil affiche le
 * bouton sans le chiffre — même règle que « Regarder le live », qui disparaît
 * plutôt que de mener vers une chaîne éteinte.
 */

/**
 * Hors du préfixe `landing:` — et ce n'est pas un détail.
 *
 * `invalidateLandingAggregates()` vide ce préfixe à **chaque écriture de
 * tournoi** : un score reporté jetterait donc le compteur Discord, qui n'a rien
 * à voir avec le tournoi, et relancerait un appel sortant. La clé vit à part
 * pour n'être gouvernée que par sa durée de vie.
 */
const CACHE_KEY = "discord:community";

/**
 * Cinq minutes. Un décompte de membres bouge de quelques unités par jour : le
 * tenir à la seconde n'apporterait rien, et l'accueil est rendu à chaque visite
 * (`force-dynamic`). Sans mutualisation, chaque visiteur ferait partir un appel
 * vers Discord, qui nous plafonnerait — et le compteur s'éteindrait pour tout
 * le monde au moment précis où il y a du monde.
 */
const TTL_MS = 5 * 60_000;

/**
 * Court, et volontairement : ce chiffre est un ornement de l'accueil. Discord
 * lent ne doit pas retarder le rendu de la page pour autant.
 */
const TIMEOUT_MS = 2_500;

const ENDPOINT = `https://discord.com/api/v10/invites/${encodeURIComponent(
  DISCORD_INVITE_CODE,
)}?with_counts=true&with_expiration=false`;

/**
 * Fréquentation du serveur, mutualisée entre tous les appels concurrents.
 *
 * **L'échec est mis en cache lui aussi**, et c'est voulu : `cached()` ne retient
 * pas une promesse rejetée, mais ici un refus se traduit par un `null` **résolu**,
 * donc conservé cinq minutes. C'est exactement ce qu'on veut d'un plafonnement —
 * retenter à chaque rendu de page ferait durer la sanction au lieu de la purger.
 */
export function getDiscordCommunity(): Promise<DiscordCommunityStats | null> {
  return cached(CACHE_KEY, TTL_MS, loadDiscordCommunity);
}

async function loadDiscordCommunity(): Promise<DiscordCommunityStats | null> {
  try {
    const response = await fetch(ENDPOINT, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseDiscordCommunityStats(await response.json());
  } catch {
    // Réseau, délai dépassé, JSON illisible : pour l'appelant, c'est le même
    // fait — on ne sait pas combien nous sommes.
    return null;
  }
}
