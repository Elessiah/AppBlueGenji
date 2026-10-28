/**
 * Brief du salon (`MATCH_LOBBY_BRIEF`) — la règle et le texte du message privé
 * Discord, sans réseau ni base (`docs/features/MATCH_LOBBY_BRIEF.md`).
 *
 * Quand le salon d'un match s'ouvre, ceux qui gèrent chaque engagée (`OWNER`,
 * `MANAGER` ; le joueur d'une entrée solo) reçoivent les réglages de la partie :
 * qui joue à gauche (l'hôte) et à droite, la première carte, le premier ban, le
 * rappel de trier les joueurs par rôle quand le match est casté, et ce que dit
 * la décision d'arbitrage (arbitre désigné ou autogestion). Puis le lien de la
 * page du match, qui seule montre les BattleTags à inviter — en Overwatch : en
 * Marvel Rivals, où l'on ne s'invite pas par BattleTag, ni le lien ni la ligne
 * de l'arbitre n'en parlent (décision 35, 2026-10-28).
 *
 * **Ni BattleTag, ni tag Discord, ni pseudo de joueur** (décision de
 * l'utilisateur, 2026-10-27) : seuls les noms d'équipe sont écrits ; en tournoi
 * individuel, où le nom d'un engagé **est** un pseudo, le message dit « toi » et
 * « ton adversaire ».
 *
 * **Serveur seulement** malgré son dossier : il atteint `push-messages.ts`, qui
 * embarque les deux langues.
 */
import { discordInline } from "./discord-text";
import { localizedSiteUrl } from "./dm-language";
import type { Locale } from "./locales";
import { battletagRelevantFor } from "./certification-prompt";
import type { RefereeDecision } from "./match-referee";
import { pushRoundLabel } from "./push-messages";
import type { TournamentGame } from "./types";

/** Ce que le brief dit d'un match, vu d'une des deux engagées. */
export type LobbyBriefSide = {
  tournamentId: number;
  tournamentName: string;
  matchId: number;
  bracket: string;
  roundNumber: number;
  swiss?: boolean;
  /** Le jeu du tournoi : hors Overwatch, le brief ne parle d'aucun BattleTag ni ajout en jeu de l'arbitre. */
  game: TournamentGame;
  /** Tournoi individuel : les noms des engagés sont des pseudos, jamais écrits. */
  solo: boolean;
  /** L'engagée du destinataire. */
  teamName: string;
  opponentName: string;
  /** L'engagée du destinataire héberge-t-elle (gauche) ? Sinon elle joue à droite et bannit la première. */
  hosting: boolean;
  /** Première carte posée par le staff, texte libre ; `null` tant qu'elle ne l'est pas. */
  firstMap: string | null;
  /** Au moins un caster inscrit (et éligible) : rappel du tri par rôle. */
  cast: boolean;
  decision: RefereeDecision;
};

function quoted(value: string, locale: Locale): string {
  return locale === "en" ? `“${discordInline(value)}”` : `« ${discordInline(value)} »`;
}

/** Les noms à écrire, par place : les équipes entre guillemets, « toi » / « ton adversaire » en individuel. */
export type LobbyBriefNames = { left: string; right: string; ban: string };

const SOLO_NAMES: Readonly<Record<Locale, { own: string; other: string }>> = {
  fr: { own: "toi", other: "ton adversaire" },
  en: { own: "you", other: "your opponent" },
};

/**
 * Qui joue à gauche (l'hôte), à droite, et qui bannit le premier (celle qui
 * n'héberge pas). `quote` met un nom d'équipe en forme pour son canal.
 */
export function lobbyBriefNames(
  side: LobbyBriefSide,
  locale: Locale,
  quote: (name: string) => string,
): LobbyBriefNames {
  const own = side.solo ? SOLO_NAMES[locale].own : quote(side.teamName);
  const other = side.solo ? SOLO_NAMES[locale].other : quote(side.opponentName);
  return side.hosting ? { left: own, right: other, ban: other } : { left: other, right: own, ban: own };
}

type DecisionLine = "REFEREE" | "REFEREE_NO_BATTLETAG" | "SELF_MANAGED_TEAM" | "SELF_MANAGED_SOLO";

const DECISION_LINES: Readonly<Record<Locale, Readonly<Record<DecisionLine, string>>>> = {
  fr: {
    REFEREE: "Arbitre désigné : ajoute-le en jeu, il invitera les joueurs dans le salon.",
    REFEREE_NO_BATTLETAG: "Arbitre désigné : il invitera les joueurs dans le salon.",
    SELF_MANAGED_TEAM:
      "Autogestion : l'équipe hôte crée la partie, les managers des deux équipes s'invitent mutuellement, puis invitent les casters.",
    SELF_MANAGED_SOLO: "Autogestion : l'hôte crée la partie et invite son adversaire, puis les casters.",
  },
  en: {
    REFEREE: "Assigned referee: add them in game, they will invite the players to the lobby.",
    REFEREE_NO_BATTLETAG: "Assigned referee: they will invite the players to the lobby.",
    SELF_MANAGED_TEAM:
      "Self-managed: the host team creates the game, the managers of both teams invite each other, then invite the casters.",
    SELF_MANAGED_SOLO: "Self-managed: the host creates the game and invites their opponent, then the casters.",
  },
};

/** La ligne de la décision d'arbitrage ; `null` sans décision (le staff en est averti à part). */
function decisionLine(side: LobbyBriefSide, locale: Locale): string | null {
  if (side.decision === "REFEREE") {
    return DECISION_LINES[locale][battletagRelevantFor(side.game) ? "REFEREE" : "REFEREE_NO_BATTLETAG"];
  }
  if (side.decision === "SELF_MANAGED") {
    return DECISION_LINES[locale][side.solo ? "SELF_MANAGED_SOLO" : "SELF_MANAGED_TEAM"];
  }
  return null;
}

const DM_TEXT: Readonly<
  Record<
    Locale,
    {
      opening: (subject: string, round: string, tournament: string) => string;
      subject: (side: LobbyBriefSide, quote: (name: string) => string) => string;
      left: string;
      right: string;
      firstMap: string;
      noFirstMap: string;
      firstBan: string;
      cast: string;
      link: string;
      linkNoBattletag: string;
    }
  >
> = {
  fr: {
    opening: (subject, round, tournament) => `🎮 BlueGenji — Le salon de ${subject} est ouvert (${round}, ${tournament}).`,
    subject: (side, quote) =>
      side.solo ? "ton match" : `ton match ${quote(side.teamName)} contre ${quote(side.opponentName)}`,
    left: "Gauche (hôte) : ",
    right: "Droite : ",
    firstMap: "Première carte : ",
    noFirstMap: "pas encore fixée",
    firstBan: "Premier ban : ",
    cast: "Match casté : trie les joueurs par rôle dans le salon.",
    link: "BattleTags à inviter et réglages à jour : ",
    linkNoBattletag: "Réglages à jour : ",
  },
  en: {
    opening: (subject, round, tournament) => `🎮 BlueGenji — The lobby of ${subject} is open (${round}, ${tournament}).`,
    subject: (side, quote) => (side.solo ? "your match" : `your match ${quote(side.teamName)} vs ${quote(side.opponentName)}`),
    left: "Left (host): ",
    right: "Right: ",
    firstMap: "First map: ",
    noFirstMap: "not set yet",
    firstBan: "First ban: ",
    cast: "Cast match: sort the players by role in the lobby.",
    link: "BattleTags to invite and up-to-date settings: ",
    linkNoBattletag: "Up-to-date settings: ",
  },
};

/**
 * Le message privé Discord. `url` : la page du match, adresse absolue en
 * français (`localizedSiteUrl` la passe sous `/en` pour un compte anglais).
 */
export function formatLobbyBriefDm(side: LobbyBriefSide, url: string, locale: Locale = "fr"): string {
  const text = DM_TEXT[locale];
  const quote = (name: string) => quoted(name, locale);
  const names = lobbyBriefNames(side, locale, quote);
  const decision = decisionLine(side, locale);
  const round = pushRoundLabel(side.bracket, side.roundNumber, locale, side.swiss);
  return [
    text.opening(text.subject(side, quote), round, quote(side.tournamentName)),
    `• ${text.left}${names.left}`,
    `• ${text.right}${names.right}`,
    `• ${text.firstMap}${side.firstMap === null ? text.noFirstMap : quote(side.firstMap)}`,
    `• ${text.firstBan}${names.ban}`,
    ...(side.cast ? [`• ${text.cast}`] : []),
    ...(decision === null ? [] : [`• ${decision}`]),
    `${battletagRelevantFor(side.game) ? text.link : text.linkNoBattletag}${localizedSiteUrl(url, locale)}`,
  ].join("\n");
}
