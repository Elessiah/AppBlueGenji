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
  let text = `🔴 En direct — ${tournament} :`;
  for (let index = 0; index < count; index += 1) {
    const line = `\n• ${pairingLine(group.pairings[index], group.participantType)}`;
    const rest = count - index;
    // Place gardée pour la ligne qui compterait le reste.
    const reserve = rest > 1 ? `\n• et ${otherMatches(rest)}`.length : 0;
    if (text.length + line.length + reserve > LIVE_ANNOUNCEMENT_MAX_LENGTH) {
      return `${text}\n• et ${otherMatches(rest)}`;
    }
    text += line;
  }
  return text;
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
