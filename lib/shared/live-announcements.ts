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
 */
import { discordInline } from "./discord-text";
import { entrantLabel } from "./log-privacy";
import { normalizeStreamUrl } from "./live-streams";
import type { ParticipantType } from "./participants";

/** Ce que l'annonce dit d'un match. */
export interface LiveAnnouncementMatch {
  tournamentName: string;
  participantType: ParticipantType;
  team1Name: string;
  team2Name: string;
}

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

/** « A, B et C » — la liste française. */
function frenchList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}

/**
 * Texte d'une annonce groupée, sans la mention ni le lien (ajoutés par le bot).
 * En tournoi individuel, plusieurs affiches ne s'énumèrent pas (« un joueur
 * contre un joueur et un joueur contre un joueur » ne dirait rien) : le texte
 * compte les matchs.
 *
 * @param group Le tournoi et ses affiches (au moins une).
 * @returns Une ligne, prête à partir.
 */
export function formatLiveAnnouncementGroup(group: LiveAnnouncementGroup): string {
  const tournament = discordInline(group.tournamentName);
  if (group.participantType === "SOLO" && group.pairings.length > 1) {
    return `🔴 En direct : ${group.pairings.length} matchs — ${tournament}`;
  }
  const pairings = group.pairings.map((pairing) => {
    const first = entrantLabel({ name: pairing.team1Name, participantType: group.participantType });
    const second = entrantLabel({ name: pairing.team2Name, participantType: group.participantType });
    return `${first} contre ${second}`;
  });
  return `🔴 En direct : ${frenchList(pairings)} — ${tournament}`;
}

/**
 * Texte de l'annonce d'un match, sans la mention ni le lien (ajoutés par le bot).
 *
 * @param match Les deux engagés et le tournoi.
 * @returns Une ligne, prête à partir.
 */
export function formatLiveAnnouncement(match: LiveAnnouncementMatch): string {
  return formatLiveAnnouncementGroup({
    tournamentName: match.tournamentName,
    participantType: match.participantType,
    pairings: [{ team1Name: match.team1Name, team2Name: match.team2Name }],
  });
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
  return normalizeStreamUrl(matchUrl) ?? normalizeStreamUrl(tournamentUrl);
}
