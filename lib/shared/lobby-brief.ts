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
 * Ce module ne garde que ce qui est commun aux deux canaux (le type d'un côté,
 * les noms par place) : il n'importe rien de lourd et reste importable partout.
 * Le message privé se rédige côté serveur (`lib/server/tournaments/lobby-brief-dm.ts`),
 * qui atteint `push-messages.ts` et ses deux langues.
 */
import type { Locale } from "./locales";
import type { RefereeDecision } from "./match-referee";
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
  /** L'engagée du destinataire héberge-t-elle (gauche) ? */
  hosting: boolean;
  /** L'engagée du destinataire bannit-elle la première sur la carte 1 (règle du tournoi) ? */
  banFirst: boolean;
  /** Première carte affichée (l'imposée de la manche l'emporte) ; `null` tant qu'elle n'est pas fixée. */
  firstMap: string | null;
  /** Cartes de la manche (`ROUND_MAPS.md`), vide sans réglage : on garde alors la seule première carte. */
  maps: ResolvedMapSlot[];
  /** Map de départage du tour (play-offs en vrai best of 3), `null` sans réglage. */
  tiebreakMap?: string | null;
  nextBan: NextBanRule;
  /** Au moins un caster inscrit (et éligible) : rappel du tri par rôle. */
  cast: boolean;
  decision: RefereeDecision;
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

