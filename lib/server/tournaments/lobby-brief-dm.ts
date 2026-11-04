/**
 * Check-in du match (`MATCH_LOBBY_BRIEF`) — le texte du message privé Discord,
 * sans réseau ni base (`docs/features/MATCH_LOBBY_BRIEF.md`). Serveur
 * seulement : il atteint `push-messages.ts`, qui embarque les deux langues ;
 * le type d'un côté, les noms par place et les paramètres de partie restent
 * dans `lib/shared/lobby-brief.ts`.
 *
 * **Message stylisé** (décision de l'utilisateur, 2026-11-04) : un titre (`#`)
 * et des sections (`##`) que Discord met en forme, des puces, et le gras sur ce
 * qui ne doit pas être manqué. Notre propre mise en forme est écrite ici ;
 * seuls les noms (équipes, cartes, tournoi) passent par `discordInline`, qui
 * échappe la leur — un nom d'équipe ne peut donc pas ouvrir de section.
 */
import { battletagRelevantFor } from "@/lib/shared/certification-prompt";
import { CHECK_IN_INVITE_URL } from "@/lib/shared/discord";
import { discordInline } from "@/lib/shared/discord-text";
import { localizedSiteUrl } from "@/lib/shared/dm-language";
import { GAME_SETTINGS_TEXT, lobbyBriefNames, neutralizeQuotes, type LobbyBriefSide } from "@/lib/shared/lobby-brief";
import type { Locale } from "@/lib/shared/locales";
import { pushRoundLabel } from "@/lib/shared/push-messages";
import { GAME_SETTINGS } from "@/lib/shared/match-page";
import type { NextBanRule } from "@/lib/shared/round-maps";
import { withoutInvisibles } from "@/lib/shared/visible-text";

function quoted(value: string, locale: Locale): string {
  // Guillemets neutralisés d'abord, `discordInline` en dernier : rien n'est écrit après son nettoyage.
  const name = discordInline(neutralizeQuotes(value));
  return locale === "en" ? `“${name}”` : `« ${name} »`;
}

/**
 * Longueur au plus du bloc des cartes : 9 créneaux de 20 cartes de 64
 * caractères dépasseraient les 2 000 caractères d'un message Discord, qui ne
 * serait pas remis. Au-delà, le bloc s'arrête à un créneau entier et renvoie à
 * la page du match (dont le lien est écrit plus haut). Abaissé avec la fusion
 * du check-in : le reste du message est plus long qu'avant.
 */
export const MAPS_LINE_MAX = 420;

/**
 * Longueur au plus d'un message Discord. Des noms longs (équipes, tournoi) et
 * un lien de diffusion peuvent la faire passer même sous `MAPS_LINE_MAX` : le
 * bloc des cartes est alors raccourci d'autant (`formatLobbyBriefDm`).
 */
export const DISCORD_MESSAGE_MAX = 2000;

type TournamentText = {
  /** Titre du message : « Check-in du match … ». */
  title: (subject: string) => string;
  /** Sujet du titre : les deux équipes, ou « ton match » en individuel. */
  titleSubject: (side: LobbyBriefSide, quote: (name: string) => string) => string;
  /** Sous-titre : manche, tournoi et état (coup d'envoi proche, ou match lancé). */
  subtitle: (round: string, tournament: string) => string;
  subtitleLaunched: (round: string, tournament: string) => string;
  /** Phrase d'ouverture, selon la décision d'arbitrage. */
  introSelfManaged: string;
  introReferee: string;
  introUndecided: string;
  /** Le lien de la page du match, en italique sous l'ouverture. */
  contacts: (url: string) => string;
  contactsNoBattletag: (url: string) => string;
  /** Sections. */
  beforeKickoff: string;
  settings: string;
  mapsSection: string;
  castSection: string;
  /** Lignes de la préparation. */
  voice: (invite: string) => string;
  /** Le salon de check-in : ouvert, puisque le message part dans son quart d'heure. */
  checkIn: (invite: string) => string;
  seats: (left: string, right: string) => string;
  createGame: string;
  checkSettings: string;
  referee: string;
  refereeNoBattletag: string;
  /** Lignes des cartes. */
  map: (number: number, shown: string) => string;
  noFirstMap: string;
  toChoose: (pool: string) => string;
  moreMaps: string;
  firstBan: (first: string, then: string) => string;
  nextBans: Readonly<Record<NextBanRule, string>>;
  tiebreak: string;
  /** Lignes du cast. */
  live: (url: string) => string;
  inviteCasters: string;
  notifyCasters: string;
  sortByRole: string;
  /** Pied du message. */
  scores: string;
  issue: string;
  goodLuck: string;
};

const DM_TEXT: Readonly<Record<Locale, TournamentText>> = {
  fr: {
    title: (subject) => `# Check-in ${subject}`,
    titleSubject: (side, quote) =>
      side.solo ? "de ton match" : `du match ${quote(side.teamName)} Vs ${quote(side.opponentName)}`,
    subtitle: (round, tournament) => `*${round} · ${tournament} — coup d'envoi dans moins de 15 minutes.*`,
    subtitleLaunched: (round, tournament) => `*${round} · ${tournament} — match lancé.*`,
    introSelfManaged: "**Votre match est en autogestion.** Voici les éléments importants à savoir.",
    introReferee: "**Un arbitre est désigné pour votre match.** Voici les éléments importants à savoir.",
    introUndecided: "Voici les éléments importants à savoir avant le coup d'envoi.",
    contacts: (url) => `*Les contacts et les BattleTags à inviter sont sur la page du match : ${url}*`,
    contactsNoBattletag: (url) => `*Vous pouvez retrouver les contacts sur la page du match : ${url}*`,
    beforeKickoff: "## Avant le coup d'envoi",
    settings: "## Paramètres de partie",
    mapsSection: "## Déroulé des maps",
    castSection: "## Match casté",
    voice: (invite) => `Tous les joueurs doivent rejoindre le salon vocal de leur équipe, ouvert par le bot — ${invite}`,
    checkIn: (invite) => `Le salon de check-in est ouvert sur Discord — ${invite}`,
    seats: (left, right) => `Gauche (hôte) : ${left} · Droite : ${right}`,
    createGame: "**C'est à ton équipe de créer la partie.**",
    checkSettings: "L'équipe hôte crée la partie : **vérifie les paramètres** avant de lancer.",
    referee: "Ajoute l'arbitre désigné en jeu : il invitera les joueurs dans le salon.",
    refereeNoBattletag: "L'arbitre désigné invitera les joueurs dans le salon.",
    map: (number, shown) => `Map ${number} : ${shown}`,
    noFirstMap: "pas encore fixée",
    toChoose: (pool) => `à choisir parmi ${pool}`,
    moreMaps: "Suite des cartes sur la page du match.",
    firstBan: (first, then) => `Bans de la carte 1 : ${first} d'abord, puis ${then}.`,
    nextBans: {
      LOSER:
        "Cartes suivantes : l'équipe qui a perdu la carte précédente bannit en premier ; en cas d'égalité, même ordre qu'à la carte précédente.",
      WINNER:
        "Cartes suivantes : l'équipe qui a gagné la carte précédente bannit en premier ; en cas d'égalité, même ordre qu'à la carte précédente.",
    },
    tiebreak: "Map de départage (jouée seulement si la série est à égalité après les 3 maps) : ",
    live: (url) => `En direct sur ${url}`,
    inviteCasters: "Invitez les casters inscrits (leurs contacts sont sur la page du match).",
    notifyCasters: "Prévenez les casters inscrits (leurs contacts sont sur la page du match).",
    sortByRole: "Triez les joueurs par rôle dans le salon.",
    scores: "N'oubliez pas de rentrer les scores du match **au plus vite après la fin de votre match**.",
    issue: "Un problème ? Signalez-le depuis la page du match, ou pinguez le rôle @Arbitre sur Discord.",
    goodLuck: "GL HF :)",
  },
  en: {
    title: (subject) => `# ${subject} check-in`,
    titleSubject: (side, quote) =>
      side.solo ? "Your match" : `${quote(side.teamName)} Vs ${quote(side.opponentName)}`,
    subtitle: (round, tournament) => `*${round} · ${tournament} — kickoff in less than 15 minutes.*`,
    subtitleLaunched: (round, tournament) => `*${round} · ${tournament} — match started.*`,
    introSelfManaged: "**Your match is self-managed.** Here is what you need to know.",
    introReferee: "**A referee is assigned to your match.** Here is what you need to know.",
    introUndecided: "Here is what you need to know before kickoff.",
    contacts: (url) => `*The contacts and the BattleTags to invite are on the match page: ${url}*`,
    contactsNoBattletag: (url) => `*You can find the contacts on the match page: ${url}*`,
    beforeKickoff: "## Before kickoff",
    settings: "## Game settings",
    mapsSection: "## Map order",
    castSection: "## Cast match",
    voice: (invite) => `Every player must join their team's voice channel, opened by the bot — ${invite}`,
    checkIn: (invite) => `The check-in channel is open on Discord — ${invite}`,
    seats: (left, right) => `Left (host): ${left} · Right: ${right}`,
    createGame: "**Your team creates the game.**",
    checkSettings: "The host team creates the game: **check the settings** before starting.",
    referee: "Add the assigned referee in game: they will invite the players to the lobby.",
    refereeNoBattletag: "The assigned referee will invite the players to the lobby.",
    map: (number, shown) => `Map ${number}: ${shown}`,
    noFirstMap: "not set yet",
    toChoose: (pool) => `to choose from ${pool}`,
    moreMaps: "More maps on the match page.",
    firstBan: (first, then) => `Map 1 bans: ${first} first, then ${then}.`,
    nextBans: {
      LOSER: "Next maps: the team that lost the previous map bans first; on a draw, same order as on the previous map.",
      WINNER: "Next maps: the team that won the previous map bans first; on a draw, same order as on the previous map.",
    },
    tiebreak: "Tiebreak map (played only if the series is level after the 3 maps): ",
    live: (url) => `Live on ${url}`,
    inviteCasters: "Invite the signed-up casters (their contacts are on the match page).",
    notifyCasters: "Notify the signed-up casters (their contacts are on the match page).",
    sortByRole: "Sort the players by role in the lobby.",
    scores: "Remember to enter the match scores **as soon as your match ends**.",
    issue: "Any issue? Report it from the match page, or ping the @Arbitre role on Discord.",
    goodLuck: "GL HF :)",
  },
};

/** La phrase d'ouverture : ce que dit la décision d'arbitrage, ou rien de plus. */
function introLine(side: LobbyBriefSide, locale: Locale): string {
  const text = DM_TEXT[locale];
  if (side.decision === "REFEREE") return text.introReferee;
  // Contre une fantôme, personne en face : « autogestion » n'apprend rien à
  // qui n'a pas d'adversaire à inviter, l'ouverture reste neutre.
  if (side.decision === "SELF_MANAGED" && !side.opponentGhost) return text.introSelfManaged;
  return text.introUndecided;
}

/**
 * Qui crée la partie : en autogestion, l'hôte le fait et l'autre vérifie les
 * réglages ; avec un arbitre désigné, c'est lui qui invite — la ligne le dit à
 * la place. **Sans décision d'arbitrage, aucune ligne** : charger l'hôte
 * trancherait à la place du staff, qui en est averti à part (comme avant la
 * fusion du check-in). Contre une fantôme, personne en face non plus.
 */
function creationLine(side: LobbyBriefSide, locale: Locale): string | null {
  const text = DM_TEXT[locale];
  if (side.decision === "REFEREE") {
    return battletagRelevantFor(side.game) ? text.referee : text.refereeNoBattletag;
  }
  if (side.decision !== "SELF_MANAGED" || side.opponentGhost) return null;
  return side.hosting ? text.createGame : text.checkSettings;
}

/** Les cartes de la manche, une puce par créneau, coupées à `budget` (au plus `MAPS_LINE_MAX`). */
function mapBullets(side: LobbyBriefSide, locale: Locale, quote: (name: string) => string, budget: number): string[] {
  const text = DM_TEXT[locale];
  const bullets: string[] = [];
  let used = 0;
  for (const slot of side.maps) {
    const shown = slot.map === null ? text.toChoose(slot.candidates.map(quote).join(", ")) : quote(slot.map);
    const bullet = `* ${text.map(slot.number, shown)}`;
    // Coupé à un créneau entier : jamais au milieu d'un nom cité.
    if (used + bullet.length > budget) {
      bullets.push(`* ${text.moreMaps}`);
      return bullets;
    }
    used += bullet.length;
    bullets.push(bullet);
  }
  return bullets;
}

/** Le bloc des cartes : celles de la manche si elle est réglée, sinon la première carte seule. */
function mapsBlock(side: LobbyBriefSide, locale: Locale, quote: (name: string) => string, budget: number): string[] {
  const text = DM_TEXT[locale];
  if (side.maps.length > 0) return mapBullets(side, locale, quote, budget);
  // Une carte vide ou faite d'invisibles retombe sur le même repli que la notification.
  const firstMap =
    side.firstMap === null || withoutInvisibles(side.firstMap).trim() === "" ? text.noFirstMap : quote(side.firstMap);
  return [`* ${text.map(1, firstMap)}`];
}

/** La section du cast : le live quand il est public, puis qui inviter. */
function castBlock(side: LobbyBriefSide, locale: Locale): string[] {
  const text = DM_TEXT[locale];
  const invite = battletagRelevantFor(side.game) ? text.inviteCasters : text.notifyCasters;
  return [
    "",
    text.castSection,
    ...(side.streamUrl ? [`* ${text.live(side.streamUrl)}`] : []),
    `* ${invite}`,
    `* ${text.sortByRole}`,
  ];
}

/**
 * Le message privé Discord. `url` : la page du match, adresse absolue en
 * français (`localizedSiteUrl` la passe sous `/en` pour un compte anglais) ;
 * `null` quand la racine du site est inconnue — la ligne du lien est alors
 * tue plutôt que de pointer vers une adresse inventée (`siteUrl`).
 */
export function formatLobbyBriefDm(side: LobbyBriefSide, url: string | null, locale: Locale = "fr"): string {
  const full = buildLobbyBriefDm(side, url, locale, MAPS_LINE_MAX);
  if (full.length <= DISCORD_MESSAGE_MAX) return full;
  // Trop long : le bloc des cartes cède l'excédent (la page du match les donne toutes).
  return buildLobbyBriefDm(side, url, locale, Math.max(0, MAPS_LINE_MAX - (full.length - DISCORD_MESSAGE_MAX)));
}

function buildLobbyBriefDm(side: LobbyBriefSide, url: string | null, locale: Locale, mapsBudget: number): string {
  const text = DM_TEXT[locale];
  const quote = (name: string) => quoted(name, locale);
  const names = lobbyBriefNames(side, locale, quote);
  const round = pushRoundLabel(side.bracket, side.roundNumber, locale, side.swiss);
  const tournament = quote(side.tournamentName);
  const creation = creationLine(side, locale);
  const contacts = battletagRelevantFor(side.game) ? text.contacts : text.contactsNoBattletag;
  return [
    text.title(text.titleSubject(side, quote)),
    side.launched ? text.subtitleLaunched(round, tournament) : text.subtitle(round, tournament),
    "",
    introLine(side, locale),
    ...(url === null ? [] : [contacts(localizedSiteUrl(url, locale))]),
    "",
    text.beforeKickoff,
    // Jamais de vocal en individuel ni contre une fantôme : le bot n'en ouvre
    // aucun pour ces matchs (`MATCH_VOICE.md`).
    `* ${text.checkIn(CHECK_IN_INVITE_URL)}`,
    ...(side.voice ? [`* ${text.voice(CHECK_IN_INVITE_URL)}`] : []),
    `* ${text.seats(names.left, names.right)}`,
    ...(creation === null ? [] : [`* ${creation}`]),
    "",
    text.settings,
    ...GAME_SETTINGS.map((setting) => `* ${GAME_SETTINGS_TEXT[locale][setting]}`),
    "",
    text.mapsSection,
    ...mapsBlock(side, locale, quote, mapsBudget),
    `* ${text.firstBan(names.ban, names.banNext)}`,
    `* ${text.nextBans[side.nextBan]}`,
    ...(side.tiebreakMap ? [`* ${text.tiebreak}${quote(side.tiebreakMap)}`] : []),
    ...(side.cast ? castBlock(side, locale) : []),
    "",
    text.scores,
    text.issue,
    "",
    text.goodLuck,
  ].join("\n");
}
