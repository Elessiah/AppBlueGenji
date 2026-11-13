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
import { discordInline, discordUrl } from "@/lib/shared/discord-text";
import { localizedSiteUrl } from "@/lib/shared/dm-language";
import {
  GAME_SETTINGS_TEXT,
  LOBBY_BRIEF_LEAD_MINUTES,
  lobbyBriefNames,
  neutralizeQuotes,
  type LobbyBriefKickoff,
  type LobbyBriefSide,
} from "@/lib/shared/lobby-brief";
import type { Locale } from "@/lib/shared/locales";
import { pushRoundLabel } from "@/lib/shared/push-messages";
import { GAME_SETTINGS } from "@/lib/shared/match-page";
import type { NextBanRule } from "@/lib/shared/round-maps";
import { hasPerMapTargets } from "@/lib/shared/map-points";
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
  /**
   * Sous-titre : manche, tournoi et état — selon le déclencheur (horaire à
   * venir, horaire passé, salon d'un match sans horaire), ou match lancé.
   */
  subtitle: Readonly<Record<LobbyBriefKickoff, (round: string, tournament: string) => string>>;
  subtitleLaunched: (round: string, tournament: string) => string;
  /** Phrase d'ouverture : l'autogestion, ou neutre contre une fantôme. */
  introSelfManaged: string;
  introGhost: string;
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
  /** Les mêmes en tournoi individuel : un engagé solo n'a pas d'équipe. */
  createGameSolo: string;
  checkSettingsSolo: string;
  /** Lignes des cartes. */
  map: (number: number, shown: string) => string;
  noFirstMap: string;
  toChoose: (pool: string) => string;
  moreMaps: string;
  firstBan: (first: string, then: string) => string;
  nextBans: Readonly<Record<NextBanRule, string>>;
  tiebreak: string;
  pointTarget: (points: number) => string;
  /** Points réglés carte par carte (`pointTargets`) ; `rest` = N des cartes suivantes. */
  pointTargetsPerMap: (targets: ReadonlyArray<number>, rest: number | null) => string;
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

/** « 5 points », « 1 point » (FR : pluriel dès 2). */
const pointsFr = (points: number) => `${points} point${points > 1 ? "s" : ""}`;
/** "5 points", "1 point". */
const pointsEn = (points: number) => `${points} point${points === 1 ? "" : "s"}`;

const DM_TEXT: Readonly<Record<Locale, TournamentText>> = {
  fr: {
    title: (subject) => `# Check-in ${subject}`,
    titleSubject: (side, quote) =>
      side.solo ? "de ton match" : `du match ${quote(side.teamName)} Vs ${quote(side.opponentName)}`,
    subtitle: {
      SOON: (round, tournament) =>
        `*${round} · ${tournament} — coup d'envoi dans moins de ${LOBBY_BRIEF_LEAD_MINUTES} minutes.*`,
      PASSED: (round, tournament) => `*${round} · ${tournament} — l'heure du coup d'envoi est arrivée.*`,
      UNSCHEDULED: (round, tournament) => `*${round} · ${tournament} — le salon du match est ouvert.*`,
    },
    subtitleLaunched: (round, tournament) => `*${round} · ${tournament} — match lancé.*`,
    introSelfManaged: "**Ton match est en autogestion.** Voici les éléments importants à savoir.",
    introGhost: "Voici les éléments importants à savoir avant le coup d'envoi.",
    contacts: (url) => `*Les contacts et les BattleTags à inviter sont sur la page du match : ${url}*`,
    contactsNoBattletag: (url) => `*Tu peux retrouver les contacts sur la page du match : ${url}*`,
    beforeKickoff: "## Avant le coup d'envoi",
    settings: "## Paramètres de partie",
    mapsSection: "## Déroulé des maps",
    castSection: "## Match casté",
    voice: (invite) => `Tous les joueurs doivent rejoindre le salon vocal de leur équipe, ouvert par le bot — ${invite}`,
    checkIn: (invite) => `Le salon de check-in est ouvert sur Discord — ${invite}`,
    seats: (left, right) => `Gauche (hôte) : ${left} · Droite : ${right}`,
    createGame: "**C'est à ton équipe de créer la partie.**",
    checkSettings: "L'équipe hôte crée la partie : **vérifie les paramètres** avant de lancer.",
    createGameSolo: "**C'est à toi de créer la partie.**",
    checkSettingsSolo: "Ton adversaire crée la partie : **vérifie les paramètres** avant de lancer.",
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
    tiebreak: "Map de départage (jouée seulement si la série est à égalité après les maps régulières) : ",
    pointTarget: (points) => `Format Duel / Arcade : chaque carte se gagne au premier à ${points} point${points > 1 ? "s" : ""}.`,
    pointTargetsPerMap: (targets, rest) =>
      "Format Duel / Arcade : " +
      targets.map((points, index) => `Map ${index + 1} au premier à ${pointsFr(points)}`).join(", ") +
      (rest === null ? "." : `, puis premier à ${pointsFr(rest)} pour les suivantes.`),
    live: (url) => `Diffusion : ${url}`,
    inviteCasters: "Invite les casters inscrits (leurs contacts sont sur la page du match).",
    notifyCasters: "Préviens les casters inscrits (leurs contacts sont sur la page du match).",
    sortByRole: "Trie les joueurs par rôle dans le salon.",
    scores: "N'oublie pas de rentrer les scores du match **au plus vite après la fin de ton match**.",
    issue: "Un problème ? Signale-le depuis la page du match, ou pingue le rôle @Arbitre sur Discord.",
    goodLuck: "GL HF :)",
  },
  en: {
    title: (subject) => `# ${subject} check-in`,
    titleSubject: (side, quote) =>
      side.solo ? "Your match" : `${quote(side.teamName)} Vs ${quote(side.opponentName)}`,
    subtitle: {
      SOON: (round, tournament) =>
        `*${round} · ${tournament} — kickoff in less than ${LOBBY_BRIEF_LEAD_MINUTES} minutes.*`,
      PASSED: (round, tournament) => `*${round} · ${tournament} — kickoff time has come.*`,
      UNSCHEDULED: (round, tournament) => `*${round} · ${tournament} — the match lobby is open.*`,
    },
    subtitleLaunched: (round, tournament) => `*${round} · ${tournament} — match started.*`,
    introSelfManaged: "**Your match is self-managed.** Here is what you need to know.",
    introGhost: "Here is what you need to know before kickoff.",
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
    createGameSolo: "**You create the game.**",
    checkSettingsSolo: "Your opponent creates the game: **check the settings** before starting.",
    map: (number, shown) => `Map ${number}: ${shown}`,
    noFirstMap: "not set yet",
    toChoose: (pool) => `to choose from ${pool}`,
    moreMaps: "More maps on the match page.",
    firstBan: (first, then) => `Map 1 bans: ${first} first, then ${then}.`,
    nextBans: {
      LOSER: "Next maps: the team that lost the previous map bans first; on a draw, same order as on the previous map.",
      WINNER: "Next maps: the team that won the previous map bans first; on a draw, same order as on the previous map.",
    },
    tiebreak: "Tiebreak map (played only if the series is level after the regular maps): ",
    pointTarget: (points) => `Duel / Arcade format: each map is won by the first to ${points} point${points === 1 ? "" : "s"}.`,
    pointTargetsPerMap: (targets, rest) =>
      "Duel / Arcade format: " +
      targets.map((points, index) => `Map ${index + 1} first to ${pointsEn(points)}`).join(", ") +
      (rest === null ? "." : `, then first to ${pointsEn(rest)} for the next ones.`),
    live: (url) => `Stream: ${url}`,
    inviteCasters: "Invite the signed-up casters (their contacts are on the match page).",
    notifyCasters: "Notify the signed-up casters (their contacts are on the match page).",
    sortByRole: "Sort the players by role in the lobby.",
    scores: "Remember to enter the match scores **as soon as your match ends**.",
    issue: "Any issue? Report it from the match page, or ping the @Arbitre role on Discord.",
    goodLuck: "GL HF :)",
  },
};

/**
 * La phrase d'ouverture. Le check-in ne part que pour un match en autogestion
 * (`./lobby-brief`) ; contre une fantôme, personne en face : « autogestion »
 * n'apprend rien à qui n'a pas d'adversaire à inviter, l'ouverture reste neutre.
 */
function introLine(side: LobbyBriefSide, locale: Locale): string {
  const text = DM_TEXT[locale];
  return side.opponentGhost ? text.introGhost : text.introSelfManaged;
}

/**
 * Qui crée la partie : l'hôte le fait, l'autre vérifie les réglages. Contre
 * une fantôme, personne en face : aucune ligne.
 */
function creationLine(side: LobbyBriefSide, locale: Locale): string | null {
  const text = DM_TEXT[locale];
  if (side.opponentGhost) return null;
  if (side.solo) return side.hosting ? text.createGameSolo : text.checkSettingsSolo;
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

/** La section du cast : le lien de diffusion quand il est public, puis qui inviter. */
function castBlock(side: LobbyBriefSide, locale: Locale): string[] {
  const text = DM_TEXT[locale];
  const invite = battletagRelevantFor(side.game) ? text.inviteCasters : text.notifyCasters;
  return [
    "",
    text.castSection,
    ...(side.streamUrl ? [`* ${text.live(discordUrl(side.streamUrl))}`] : []),
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
  // Trop long : le bloc des cartes cède, par paliers, jusqu'au seul renvoi à la
  // page du match (qui les donne toutes).
  for (let budget = MAPS_LINE_MAX; budget > 0; budget -= MAPS_BUDGET_STEP) {
    const text = buildLobbyBriefDm(side, url, locale, budget);
    if (text.length <= DISCORD_MESSAGE_MAX) return text;
  }
  const bare = buildLobbyBriefDm(side, url, locale, 0);
  // Dernier recours (noms et lien aux longueurs maximales) : coupé, jamais refusé par Discord.
  return bare.length <= DISCORD_MESSAGE_MAX ? bare : clipToDiscordMax(bare);
}

/**
 * Coupe à `DISCORD_MESSAGE_MAX` unités, par **points de code** : une coupe par
 * unités UTF-16 pouvait tomber au milieu d'une paire de substitution (émoji) et
 * laisser une moitié de caractère en fin de message.
 */
function clipToDiscordMax(text: string): string {
  let kept = "";
  for (const char of text) {
    if (kept.length + char.length > DISCORD_MESSAGE_MAX - 1) break;
    kept += char;
  }
  return `${kept}…`;
}

/** Pas de réduction du bloc des cartes quand le message dépasse `DISCORD_MESSAGE_MAX`. */
const MAPS_BUDGET_STEP = 30;

/** Ligne Duel / Arcade du check-in : un N pour toutes les cartes, ou carte par carte. */
function pointTargetLines(side: LobbyBriefSide, text: Pick<TournamentText, "pointTarget" | "pointTargetsPerMap">): string[] {
  if (!side.pointTarget) return [];
  const perMap = side.pointTargets ?? [];
  if (!hasPerMapTargets(side.pointTarget, perMap)) return [`* ${text.pointTarget(side.pointTarget)}`];
  // Toutes les cartes du match réglées : aucune ne suit le match (même règle que la page du match).
  const coversAll = side.maxMaps != null && perMap.length >= side.maxMaps;
  return [`* ${text.pointTargetsPerMap(perMap, coversAll ? null : side.pointTarget)}`];
}

function buildLobbyBriefDm(side: LobbyBriefSide, url: string | null, locale: Locale, mapsBudget: number): string {
  const text = DM_TEXT[locale];
  const quote = (name: string) => quoted(name, locale);
  const names = lobbyBriefNames(side, locale, quote);
  const round = pushRoundLabel(side.bracket, side.roundNumber, locale, side.swiss);
  const tournament = quote(side.tournamentName);
  const creation = creationLine(side, locale);
  const contacts = battletagRelevantFor(side.game) ? text.contacts : text.contactsNoBattletag;
  const kickoff = side.kickoff ?? "SOON";
  return [
    text.title(text.titleSubject(side, quote)),
    side.launched ? text.subtitleLaunched(round, tournament) : text.subtitle[kickoff](round, tournament),
    "",
    introLine(side, locale),
    // Entre chevrons (`discordUrl`) : nu, l'autolien de Discord pouvait avaler
    // l'astérisque qui ferme l'italique (lien vers « …/34* », italique jamais fermée).
    ...(url === null ? [] : [contacts(discordUrl(localizedSiteUrl(url, locale)))]),
    "",
    text.beforeKickoff,
    // Le salon de check-in s'ouvre au quart d'heure d'un horaire : hors de ce
    // quart d'heure (`UNSCHEDULED` — match sans horaire, ou lancé bien avant le
    // sien : check-in parti à l'ouverture du salon du match), la ligne est tue,
    // comme celle du vocal.
    ...(kickoff === "UNSCHEDULED" ? [] : [`* ${text.checkIn(CHECK_IN_INVITE_URL)}`]),
    // Jamais de vocal en individuel ni contre une fantôme : le bot n'en ouvre
    // aucun pour ces matchs (`MATCH_VOICE.md`).
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
    ...pointTargetLines(side, text),
    ...(side.cast ? castBlock(side, locale) : []),
    "",
    text.scores,
    text.issue,
    "",
    text.goodLuck,
  ].join("\n");
}
