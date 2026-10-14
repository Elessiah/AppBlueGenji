/**
 * Annonce d'un live sur Discord (#live du serveur BlueGenji) au début d'un
 * match diffusé : rédaction et choix du lien. Module pur.
 *
 * Le site rédige, le bot publie (`POST /internal/announce/live`) en préfixant
 * la mention `@everyone` et en ajoutant le lien seul sur sa ligne. Le texte est
 * en français : Discord reste en français (décision D6 de l'i18n).
 *
 * Vie privée : la règle de tout message Discord (`log-privacy.ts`) veut qu'un
 * nom d'équipe puisse partir, un joueur jamais. L'annonce #live en est la
 * **seule exception**, décidée par l'utilisateur (2026-10-14) : l'engagé d'une
 * entrée individuelle y est nommé par son **pseudo public BlueGenji** — un
 * pseudo de sa fiche (repris de Discord, de Blizzard, voire de Google pour un
 * compte Google d'avant le 30 septembre 2026, s'il ne l'a pas changé), jamais
 * l'identifiant Discord numérique —, comme un diffuseur
 * nomme les joueurs à l'antenne. Une affiche d'équipes ne nomme que les
 * équipes, jamais leurs joueurs. Un joueur dont le pseudo manque (compte
 * supprimé) s'écrit « un joueur ». Tous les noms passent par `discordInline` :
 * un nom `@everyone` ne double pas la mention, un nom balisé ne devient pas un
 * lien.
 *
 * Plusieurs matchs du même tournoi passés à l'antenne ensemble sur le **même**
 * lien (le cas d'une ronde lancée d'un coup, repliée sur la chaîne officielle)
 * partent en **un seul** message : un `@everyone` par diffusion, pas par match.
 * Le tournoi vient alors en tête, puis une affiche par ligne — un nom d'équipe
 * ne peut pas en contenir (`discordInline`), alors qu'il peut contenir « et »
 * ou une virgule.
 */
import { discordInline } from "./discord-text";
import { ANONYMOUS_PLAYER_LABEL } from "./log-privacy";
import { normalizeStreamUrl } from "./live-streams";

/**
 * Les deux engagés d'une affiche, par leur nom public : celui de l'équipe, ou
 * le pseudo du joueur d'une entrée individuelle. `null` : joueur sans pseudo
 * publiable (compte supprimé), écrit « un joueur ».
 */
export interface LiveAnnouncementPairing {
  team1Name: string | null;
  team2Name: string | null;
}

/** Plusieurs affiches d'un même tournoi, annoncées ensemble sur un même lien. */
export interface LiveAnnouncementGroup {
  tournamentName: string;
  pairings: readonly LiveAnnouncementPairing[];
}

/**
 * Longueur au-delà de laquelle une annonce groupée cesse d'énumérer ses
 * affiches : le bot coupe un message de plus de 1 800 caractères, et une liste
 * tronquée au milieu d'un nom n'apprend rien à personne.
 */
export const LIVE_ANNOUNCEMENT_MAX_LENGTH = 1500;

/** Un engagé nommé, neutralisé ; `null` sans nom publiable (absent ou vide une fois neutralisé). */
function publishableName(name: string | null): string | null {
  if (name === null) return null;
  const inline = discordInline(name);
  return inline === "" ? null : inline;
}

/** Affiche « A contre B », noms neutralisés ; « un joueur » sans nom publiable. */
function pairingLine(first: string | null, second: string | null): string {
  return `${first ?? ANONYMOUS_PLAYER_LABEL} contre ${second ?? ANONYMOUS_PLAYER_LABEL}`;
}

/** « 1 autre match » / « 3 autres matchs ». */
function otherMatches(count: number): string {
  return count === 1 ? "1 autre match" : `${count} autres matchs`;
}

/**
 * Texte d'une annonce, sans la mention ni le lien (ajoutés par le bot).
 *
 * - Une affiche : « 🔴 En direct : A contre B — Tournoi ».
 * - Plusieurs : le tournoi en tête, puis une affiche par ligne ; au-delà de
 *   {@link LIVE_ANNOUNCEMENT_MAX_LENGTH}, une dernière ligne compte le reste.
 *
 * @param group Le tournoi et ses affiches (au moins une).
 * @returns Le texte, prêt à partir.
 */
export function formatLiveAnnouncementGroup(group: LiveAnnouncementGroup): string {
  const tournament = discordInline(group.tournamentName);
  const count = group.pairings.length;
  // Chaque nom neutralisé une seule fois ; l'anonymat se lit sur les noms, pas
  // sur le texte : un pseudo public « un joueur » reste un nom publiable.
  const names = group.pairings.map(
    (pairing): [string | null, string | null] => [publishableName(pairing.team1Name), publishableName(pairing.team2Name)],
  );
  if (count === 1) {
    return `🔴 En direct : ${pairingLine(names[0][0], names[0][1])} — ${tournament}`;
  }
  // Aucun nom publiable (invités, comptes supprimés) : « un joueur contre un
  // joueur » répété ne dirait rien, le texte compte les matchs.
  if (names.every(([first, second]) => first === null && second === null)) {
    return `🔴 En direct : ${count} matchs — ${tournament}`;
  }
  const header = `🔴 En direct — ${tournament} :`;
  const lines = names.map(([first, second]) => `\n• ${pairingLine(first, second)}`);
  const full = header + lines.join("");
  if (full.length <= LIVE_ANNOUNCEMENT_MAX_LENGTH) return full;
  // Trop long : autant d'affiches que possible, puis une ligne qui compte le
  // reste (au moins une affiche, pour que l'annonce dise quelque chose).
  let text = header + lines[0];
  let shown = 1;
  while (shown < count - 1) {
    const next = text + lines[shown];
    if (`${next}\n• et ${otherMatches(count - shown - 1)}`.length > LIVE_ANNOUNCEMENT_MAX_LENGTH) break;
    text = next;
    shown += 1;
  }
  return `${text}\n• et ${otherMatches(count - shown)}`;
}

/**
 * Lien publié avec l'annonce : la diffusion du match, à défaut la chaîne
 * officielle du tournoi — c'est elle que le site désigne au spectateur d'un
 * match casté sans lien propre (`LIVE_STREAMS.md`). Chaque lien est revalidé
 * par la liste blanche (`normalizeStreamUrl`) : une ligne posée avant elle, ou
 * éditée en base, ne part pas devant tout le serveur.
 *
 * @param matchUrl `bg_matches.live_url`.
 * @param tournamentUrl `bg_tournaments.live_url`.
 * @returns Le lien `https` à publier, ou `null` : pas de lien, pas d'annonce.
 */
export function liveAnnouncementUrl(matchUrl: unknown, tournamentUrl: unknown): string | null {
  return announceable(normalizeStreamUrl(matchUrl)) ?? announceable(normalizeStreamUrl(tournamentUrl));
}

/**
 * Pages de redirection des plateformes de la liste blanche : un lien
 * `youtube.com/redirect?q=https://piege.example` porte l'hôte de YouTube mais
 * mène ailleurs.
 */
const REDIRECT_PATHS = /^\/(redirect|attribution_link)(\/|$)/i;

/**
 * Ce qui, une fois décodé, désigne une autre adresse : un schéma suivi d'une
 * barre (`https://`, `https:\\` que les navigateurs lisent pareil), ou une
 * adresse sans schéma (`//hôte`, `\\hôte`). Un caractère de contrôle décodé
 * (tabulation, saut de ligne) est refusé aussi : les navigateurs le retirent
 * avant de lire l'adresse, si bien que `/%09/hôte` vaut `//hôte`.
 */
const EMBEDDED_ADDRESS = /:[\\/]|[\\/]{2}|\\|\p{Cc}/u;

/** Décode jusqu'à stabilité (trois passes au plus) ; `null` si illisible. */
function fullyDecoded(value: string): string | null {
  let current = value;
  for (let pass = 0; pass < 3; pass++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (next === current) return current;
    current = next;
  }
  // Encore encodé après trois passes : rien de ce qu'une diffusion emploie.
  return null;
}

/**
 * Le lien d'une annonce `@everyone` ne doit mener qu'à la diffusion : ni page
 * de redirection (même encodée, `/%72edirect`, ou derrière une barre doublée),
 * ni autre adresse glissée dans le chemin, la requête ou l'ancre — en clair,
 * encodée une ou plusieurs fois, avec ou sans schéma.
 */
function announceable(url: string | null): string | null {
  if (!url) return null;
  const { pathname, search, hash } = new URL(url);
  const path = fullyDecoded(pathname);
  const rest = fullyDecoded(search + hash);
  if (path === null || rest === null) return null;
  if (REDIRECT_PATHS.test(path.replace(/[\\/]+/g, "/"))) return null;
  return EMBEDDED_ADDRESS.test(path) || EMBEDDED_ADDRESS.test(rest) ? null : url;
}
