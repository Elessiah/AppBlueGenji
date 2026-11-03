/**
 * Brief du salon (`MATCH_LOBBY_BRIEF`) — le texte du message privé Discord,
 * sans réseau ni base (`docs/features/MATCH_LOBBY_BRIEF.md`). Serveur
 * seulement : il atteint `push-messages.ts`, qui embarque les deux langues ;
 * le type d'un côté et les noms par place restent dans `lib/shared/lobby-brief.ts`.
 */
import { battletagRelevantFor } from "@/lib/shared/certification-prompt";
import { discordInline } from "@/lib/shared/discord-text";
import { localizedSiteUrl } from "@/lib/shared/dm-language";
import { lobbyBriefNames, neutralizeQuotes, type LobbyBriefSide } from "@/lib/shared/lobby-brief";
import type { Locale } from "@/lib/shared/locales";
import { pushRoundLabel } from "@/lib/shared/push-messages";
import type { NextBanRule } from "@/lib/shared/round-maps";
import { withoutInvisibles } from "@/lib/shared/visible-text";

function quoted(value: string, locale: Locale): string {
  // Guillemets neutralisés d'abord, `discordInline` en dernier : rien n'est écrit après son nettoyage.
  const name = discordInline(neutralizeQuotes(value));
  return locale === "en" ? `“${name}”` : `« ${name} »`;
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
    // Contre une fantôme, aucun manager en face : « s'invitent mutuellement »
    // serait faux, la ligne n'est pas écrite.
    if (side.opponentGhost) return null;
    return DECISION_LINES[locale][side.solo ? "SELF_MANAGED_SOLO" : "SELF_MANAGED_TEAM"];
  }
  return null;
}

const DM_TEXT: Readonly<
  Record<
    Locale,
    {
      opening: (subject: string, round: string, tournament: string) => string;
      /** Ouverture d'un match déjà lancé (lancement forcé, ou tous « Prêt » avant le balayage). */
      openingLaunched: (subject: string, round: string, tournament: string) => string;
      subject: (side: LobbyBriefSide, quote: (name: string) => string) => string;
      /** Libellés des places, mêmes marques que le push : l'hôte, et qui bannit en premier. */
      left: string;
      leftBans: string;
      right: string;
      rightBans: string;
      firstMap: string;
      noFirstMap: string;
      firstBan: (first: string, then: string) => string;
      nextBans: Readonly<Record<NextBanRule, string>>;
      maps: string;
      tiebreak: string;
      toChoose: (pool: string) => string;
      /** Fin d'une ligne des cartes coupée (`MAPS_LINE_MAX`). */
      moreMaps: string;
      cast: string;
      link: string;
      linkNoBattletag: string;
    }
  >
> = {
  fr: {
    opening: (subject, round, tournament) => `🎮 BlueGenji — Le salon de ${subject} est ouvert (${round}, ${tournament}).`,
    openingLaunched: (subject, round, tournament) =>
      `🎮 BlueGenji — ${subject.charAt(0).toUpperCase()}${subject.slice(1)} est lancé (${round}, ${tournament}).`,
    subject: (side, quote) =>
      side.solo ? "ton match" : `ton match ${quote(side.teamName)} contre ${quote(side.opponentName)}`,
    left: "Gauche (hôte) : ",
    leftBans: "Gauche (hôte, 1er ban) : ",
    right: "Droite : ",
    rightBans: "Droite (1er ban) : ",
    firstMap: "Première carte : ",
    noFirstMap: "pas encore fixée",
    firstBan: (first, then) => `Bans de la carte 1 : ${first} d'abord, puis ${then}`,
    nextBans: {
      LOSER:
        "Cartes suivantes : l'équipe qui a perdu la carte précédente bannit en premier ; en cas d'égalité, même ordre qu'à la carte précédente.",
      WINNER:
        "Cartes suivantes : l'équipe qui a gagné la carte précédente bannit en premier ; en cas d'égalité, même ordre qu'à la carte précédente.",
    },
    maps: "Cartes : ",
    tiebreak: "Map de départage (jouée seulement si la série est à égalité après les 3 maps) : ",
    toChoose: (pool) => `à choisir parmi ${pool}`,
    moreMaps: "… (suite sur la page du match)",
    cast: "Match casté : trie les joueurs par rôle dans le salon.",
    link: "BattleTags à inviter et réglages à jour : ",
    linkNoBattletag: "Réglages à jour : ",
  },
  en: {
    opening: (subject, round, tournament) => `🎮 BlueGenji — The lobby of ${subject} is open (${round}, ${tournament}).`,
    openingLaunched: (subject, round, tournament) =>
      `🎮 BlueGenji — ${subject.charAt(0).toUpperCase()}${subject.slice(1)} has started (${round}, ${tournament}).`,
    subject: (side, quote) => (side.solo ? "your match" : `your match ${quote(side.teamName)} vs ${quote(side.opponentName)}`),
    left: "Left (host): ",
    leftBans: "Left (host, 1st ban): ",
    right: "Right: ",
    rightBans: "Right (1st ban): ",
    firstMap: "First map: ",
    noFirstMap: "not set yet",
    firstBan: (first, then) => `Map 1 bans: ${first} first, then ${then}`,
    nextBans: {
      LOSER: "Next maps: the team that lost the previous map bans first; on a draw, same order as on the previous map.",
      WINNER: "Next maps: the team that won the previous map bans first; on a draw, same order as on the previous map.",
    },
    maps: "Maps: ",
    tiebreak: "Tiebreak map (played only if the series is level after the 3 maps): ",
    toChoose: (pool) => `to choose from ${pool}`,
    moreMaps: "… (more on the match page)",
    cast: "Cast match: sort the players by role in the lobby.",
    link: "BattleTags to invite and up-to-date settings: ",
    linkNoBattletag: "Up-to-date settings: ",
  },
};

/**
 * Longueur au plus de la ligne des cartes : 9 créneaux de 20 cartes de 64
 * caractères dépasseraient les 2 000 caractères d'un message Discord, qui ne
 * serait pas remis. Au-delà, la ligne s'arrête à un créneau entier et renvoie
 * à la page du match (le lien suit).
 */
export const MAPS_LINE_MAX = 700;

/** Les cartes de la manche, dans l'ordre : « 1. « Ilios » · 2. à choisir parmi … ». */
function mapsLine(side: LobbyBriefSide, locale: Locale, quote: (name: string) => string): string {
  const text = DM_TEXT[locale];
  const parts = side.maps.map((slot) => {
    const shown = slot.map === null ? text.toChoose(slot.candidates.map(quote).join(", ")) : quote(slot.map);
    return `${slot.number}. ${shown}`;
  });
  let line = "";
  for (const part of parts) {
    const next = line === "" ? part : `${line} · ${part}`;
    // Coupé à un créneau entier : jamais au milieu d'un nom cité.
    if (next.length > MAPS_LINE_MAX) return line === "" ? text.moreMaps : `${line} · ${text.moreMaps}`;
    line = next;
  }
  return line;
}

/** Ligne des cartes : celles du round s'il est réglé, sinon la première carte. */
function mapsOrFirstMapLine(side: LobbyBriefSide, locale: Locale, quote: (name: string) => string): string {
  const text = DM_TEXT[locale];
  if (side.maps.length > 0) return `• ${text.maps}${mapsLine(side, locale, quote)}`;
  // Une carte vide ou faite d'invisibles retombe sur le même repli que la notification.
  const firstMap =
    side.firstMap === null || withoutInvisibles(side.firstMap).trim() === "" ? text.noFirstMap : quote(side.firstMap);
  return `• ${text.firstMap}${firstMap}`;
}

/**
 * Le message privé Discord. `url` : la page du match, adresse absolue en
 * français (`localizedSiteUrl` la passe sous `/en` pour un compte anglais) ;
 * `null` quand la racine du site est inconnue — la ligne du lien est alors
 * tue plutôt que de pointer vers une adresse inventée (`siteUrl`).
 */
export function formatLobbyBriefDm(side: LobbyBriefSide, url: string | null, locale: Locale = "fr"): string {
  const text = DM_TEXT[locale];
  const quote = (name: string) => quoted(name, locale);
  const names = lobbyBriefNames(side, locale, quote);
  const decision = decisionLine(side, locale);
  const round = pushRoundLabel(side.bracket, side.roundNumber, locale, side.swiss);
  const opening = side.launched ? text.openingLaunched : text.opening;
  // La gauche héberge : elle bannit en premier quand la règle désigne l'hôte.
  const hostBans = side.banFirst === side.hosting;
  return [
    opening(text.subject(side, quote), round, quote(side.tournamentName)),
    `• ${hostBans ? text.leftBans : text.left}${names.left}`,
    `• ${hostBans ? text.right : text.rightBans}${names.right}`,
    mapsOrFirstMapLine(side, locale, quote),
    `• ${text.firstBan(names.ban, names.banNext)}`,
    `• ${text.nextBans[side.nextBan]}`,
    ...(side.tiebreakMap ? [`• ${text.tiebreak}${quote(side.tiebreakMap)}`] : []),
    ...(side.cast ? [`• ${text.cast}`] : []),
    ...(decision === null ? [] : [`• ${decision}`]),
    ...(url === null
      ? []
      : [`${battletagRelevantFor(side.game) ? text.link : text.linkNoBattletag}${localizedSiteUrl(url, locale)}`]),
  ].join("\n");
}
