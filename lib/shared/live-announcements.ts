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

/**
 * Texte de l'annonce, sans la mention ni le lien (ajoutés par le bot).
 *
 * @param match Les deux engagés et le tournoi.
 * @returns Une ligne, prête à partir.
 */
export function formatLiveAnnouncement(match: LiveAnnouncementMatch): string {
  const first = entrantLabel({ name: match.team1Name, participantType: match.participantType });
  const second = entrantLabel({ name: match.team2Name, participantType: match.participantType });
  return `🔴 En direct : ${first} contre ${second} — ${discordInline(match.tournamentName)}`;
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
