/**
 * Check-in du match (`MATCH_LOBBY_BRIEF`) — la règle et le texte du message
 * privé Discord, sans réseau ni base (`docs/features/MATCH_LOBBY_BRIEF.md`).
 *
 * **Un seul message, 15 minutes avant le coup d'envoi** (décision de
 * l'utilisateur, 2026-11-04) : le brief du salon et le rappel des règles de
 * l'autogestion sont fusionnés. Les joueurs des deux engagées reçoivent le
 * check-in du match — vocal d'équipe, qui héberge, paramètres de partie,
 * déroulé des maps, cast, saisie des scores, et à qui s'adresser en cas de
 * problème. Un match **sans horaire** n'a pas de repère H-15 : son check-in
 * part à l'ouverture du salon (repli, `LOBBY_BRIEF_LEAD_MINUTES`).
 *
 * Ce que dit la décision d'arbitrage (arbitre désigné ou autogestion) y reste,
 * ainsi que le lien de la page du match, qui seule montre les BattleTags à
 * inviter — en Overwatch : en Marvel Rivals, où l'on ne s'invite pas par
 * BattleTag, ni le lien ni la ligne de l'arbitre n'en parlent (décision 35,
 * 2026-10-28).
 *
 * **Ni BattleTag, ni tag Discord, ni pseudo de joueur** (décision de
 * l'utilisateur, 2026-10-27) : seuls les noms d'équipe sont écrits ; en tournoi
 * individuel, où le nom d'un engagé **est** un pseudo, le message dit « toi » et
 * « ton adversaire ».
 *
 * Ce module ne garde que ce qui est commun aux deux canaux (le type d'un côté,
 * les noms par place, les paramètres de partie) : il n'importe rien de lourd et
 * reste importable partout. Le message privé se rédige côté serveur
 * (`lib/server/tournaments/lobby-brief-dm.ts`), qui atteint `push-messages.ts`
 * et ses deux langues.
 */
import type { Locale } from "./locales";
import type { GameSetting } from "./match-page";
import type { NextBanRule, ResolvedMapSlot } from "./round-maps";
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
  /**
   * L'adversaire est une équipe fantôme (aucun membre) : personne en face pour
   * s'inviter, la ligne d'autogestion « entre managers » n'est pas écrite.
   */
  opponentGhost?: boolean;
  /**
   * Le match est déjà lancé (lancement forcé, ou tous « Prêt » avant le
   * balayage) : le brief le dit, et garde les réglages, utiles pour créer la partie.
   */
  launched?: boolean;
  /**
   * Ce qui a déclenché le check-in : horaire à venir (`SOON`, défaut), horaire
   * déjà passé (`PASSED` : match devenu jouable en retard) ou match sans
   * horaire dont le salon s'ouvre (`UNSCHEDULED`). Le sous-titre le dit, et la
   * ligne du salon de check-in — ouvert au quart d'heure d'un horaire — n'est
   * pas écrite sans horaire.
   */
  kickoff?: LobbyBriefKickoff;
  /** L'engagée du destinataire héberge-t-elle (gauche) ? */
  hosting: boolean;
  /** L'engagée du destinataire bannit-elle la première sur la carte 1 (règle du tournoi) ? */
  banFirst: boolean;
  /** Première carte affichée (l'imposée de la manche l'emporte) ; `null` tant qu'elle n'est pas fixée. */
  firstMap: string | null;
  /** Cartes de la manche (`ROUND_MAPS.md`), vide sans réglage : on garde alors la seule première carte. */
  maps: ResolvedMapSlot[];
  /** Map de départage du tour (play-offs à format défini), `null` sans réglage. */
  tiebreakMap?: string | null;
  nextBan: NextBanRule;
  /** Au moins un caster inscrit (et éligible) : rappel du tri par rôle. */
  cast: boolean;
  /**
   * Les salons vocaux d'équipe sont suivis pour ce match : l'option du tournoi
   * est allumée **et** le match est suivi (`MATCH_VOICE.md` : jamais pour une
   * entrée solo ni contre une fantôme). Faux, la ligne du vocal n'est pas
   * écrite — le bot n'ouvrira aucun salon, l'annoncer serait faux.
   */
  voice?: boolean;
  /**
   * Lien de diffusion du match (`bg_match_streams`, `firstStreamUrlSql`),
   * écrit sous la section du cast ; `null` quand aucun n'est public — la ligne
   * est alors tue plutôt que d'annoncer un live introuvable.
   */
  streamUrl?: string | null;
};

/** Déclencheur du check-in (`LobbyBriefSide.kickoff`). */
export type LobbyBriefKickoff = "SOON" | "PASSED" | "UNSCHEDULED";

/**
 * Combien de temps avant le coup d'envoi part le check-in du match.
 *
 * Aligné sur l'ouverture des salons vocaux (`VOICE_CHANNEL_LEAD_MINUTES`) et
 * du salon de check-in (`CHECK_IN_OPENS_MINUTES_BEFORE`) : les trois décrivent
 * le même quart d'heure, celui où les joueurs se rassemblent. Les constantes
 * restent distinctes — déplacer le message ne doit pas déplacer les salons.
 */
export const LOBBY_BRIEF_LEAD_MINUTES = 15;

/**
 * Les paramètres de partie **du check-in**, dans la langue du destinataire.
 *
 * La liste et son ordre viennent de `GAME_SETTINGS` (`lib/shared/match-page.ts`),
 * que la page du match rend par ses propres clés : une seule liste, deux
 * rendus, tenus ensemble par un test. Ils ne dépendent ni du jeu, ni du
 * tournoi, ni de la manche : aucune colonne, aucun écran.
 */
export const GAME_SETTINGS_TEXT: Readonly<Record<Locale, Readonly<Record<GameSetting, string>>>> = {
  fr: {
    competitive: "Mode compétitif",
    killcamOff: "Pas de killcam",
    pauseOnDisconnect: "Pause à la déconnexion",
  },
  en: {
    competitive: "Competitive mode",
    killcamOff: "No killcam",
    pauseOnDisconnect: "Pause on disconnect",
  },
};

/**
 * Les guillemets d'un nom (« » “ ” „ ‟ ‹ ›) deviennent des « " » droits : ils ne
 * ferment pas la citation où le nom est posé (message privé et notification).
 */
export function neutralizeQuotes(name: string): string {
  return name.replace(/[“”„‟«»‹›]/g, '"');
}

/**
 * Les noms à écrire, par place : les équipes entre guillemets, « toi » / « ton
 * adversaire » en individuel. `ban` bannit en premier sur la carte 1, `banNext` ensuite.
 */
export type LobbyBriefNames = { left: string; right: string; ban: string; banNext: string };

const SOLO_NAMES: Readonly<Record<Locale, { own: string; other: string }>> = {
  fr: { own: "toi", other: "ton adversaire" },
  en: { own: "you", other: "your opponent" },
};

/**
 * Qui joue à gauche (l'hôte), à droite, et l'ordre des bans de la carte 1
 * (règle du tournoi : celle qui n'héberge pas d'abord, par défaut). `quote`
 * met un nom d'équipe en forme pour son canal.
 */
export function lobbyBriefNames(
  side: LobbyBriefSide,
  locale: Locale,
  quote: (name: string) => string,
): LobbyBriefNames {
  const own = side.solo ? SOLO_NAMES[locale].own : quote(side.teamName);
  const other = side.solo ? SOLO_NAMES[locale].other : quote(side.opponentName);
  const seats = side.hosting ? { left: own, right: other } : { left: other, right: own };
  return side.banFirst ? { ...seats, ban: own, banNext: other } : { ...seats, ban: other, banNext: own };
}

