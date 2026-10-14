/**
 * Annonce d'un live sur Discord (#live du serveur BlueGenji) au début d'un
 * match diffusé : rédaction et choix du lien. Module pur.
 *
 * Le site rédige, le bot publie (`POST /internal/announce/live`) en préfixant
 * la mention `@everyone` et en ajoutant le lien seul sur sa ligne. Le texte est
 * en français : Discord reste en français (décision D6 de l'i18n).
 *
 * Règles de vie privée de tout message Discord (`log-privacy.ts`) : un nom
 * d'équipe peut partir, un joueur jamais — une entrée individuelle s'écrit
 * « un joueur ». Les noms passent par `discordInline` : une équipe nommée
 * `@everyone` ne double pas la mention, un nom balisé ne devient pas un lien.
 *
 * Plusieurs matchs du même tournoi passés à l'antenne ensemble sur le **même**
 * lien (le cas d'une ronde lancée d'un coup, repliée sur la chaîne officielle)
 * partent en **un seul** message : un `@everyone` par diffusion, pas par match.
 * Le tournoi vient alors en tête, puis une affiche par ligne — un nom d'équipe
 * ne peut pas en contenir (`discordInline`), alors qu'il peut contenir « et »
 * ou une virgule.
 */
import { discordInline } from "./discord-text";
import { entrantLabel } from "./log-privacy";
import { normalizeStreamUrl } from "./live-streams";
import type { ParticipantType } from "./participants";

/** Les deux engagés d'une affiche. */
export interface LiveAnnouncementPairing {
  team1Name: string;
  team2Name: string;
}

/** Plusieurs affiches d'un même tournoi, annoncées ensemble sur un même lien. */
export interface LiveAnnouncementGroup {
  tournamentName: string;
  participantType: ParticipantType;
  pairings: readonly LiveAnnouncementPairing[];
}

/**
 * Longueur au-delà de laquelle une annonce groupée cesse d'énumérer ses
 * affiches : le bot coupe un message de plus de 1 800 caractères, et une liste
 * tronquée au milieu d'un nom n'apprend rien à personne.
 */
export const LIVE_ANNOUNCEMENT_MAX_LENGTH = 1500;

/** Affiche « A contre B », noms neutralisés. */
function pairingLine(pairing: LiveAnnouncementPairing, participantType: ParticipantType): string {
  const first = entrantLabel({ name: pairing.team1Name, participantType });
  const second = entrantLabel({ name: pairing.team2Name, participantType });
  return `${first} contre ${second}`;
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
 * - Tournoi individuel, plusieurs affiches : « un joueur contre un joueur »
 *   répété ne dirait rien, le texte compte les matchs.
 *
 * @param group Le tournoi et ses affiches (au moins une).
 * @returns Le texte, prêt à partir.
 */
export function formatLiveAnnouncementGroup(group: LiveAnnouncementGroup): string {
  const tournament = discordInline(group.tournamentName);
  const count = group.pairings.length;
  if (count === 1) {
    return `🔴 En direct : ${pairingLine(group.pairings[0], group.participantType)} — ${tournament}`;
  }
  if (group.participantType === "SOLO") {
    return `🔴 En direct : ${count} matchs — ${tournament}`;
  }
  const header = `🔴 En direct — ${tournament} :`;
  const lines = group.pairings.map((pairing) => `\n• ${pairingLine(pairing, group.participantType)}`);
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
