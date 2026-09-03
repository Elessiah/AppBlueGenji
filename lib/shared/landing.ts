import type { MatchLiveState } from "@/lib/shared/live-streams";
import type { TournamentCard } from "@/lib/shared/types";

export type LandingStats = {
  players: number;
  teams: number;
  tournaments: number;
};

export type LandingLiveMatch = {
  id: number;
  team1Name: string | null;
  team2Name: string | null;
  /**
   * Fiche de l'engagé, résolue côté serveur par `entrantHref` : `/equipes/[id]`
   * pour une équipe, `/joueurs/[id]` pour l'entrée solo d'un tournoi
   * individuel. `null` quand la place est vide (bye, adversaire à désigner) —
   * il n'y a alors rien à ouvrir.
   */
  team1Href: string | null;
  team2Href: string | null;
  team1Score: number | null;
  team2Score: number | null;
  /**
   * Rang de l'engagé dans l'ordre de seeding du tournoi, ou `null` quand ce
   * rang n'existe pas — place vide, ou tournoi dont le tirage ne suit **pas**
   * la colonne `seed` (`isSeedOrderEffective`, `lib/shared/seeding.ts`). La
   * carte affichait « SEED 1 » et « SEED 4 » en dur, identiques pour tous les
   * matchs : plutôt que de remplacer une invention par une autre — l'ordre
   * d'inscription lu comme un seed en Suisse ou en Survie, qui seedent depuis
   * le classement du site —, on ne dit rien quand on ne sait pas.
   */
  team1Seed: number | null;
  team2Seed: number | null;
  bracket: string;
  roundLabel: string;
  /** État de diffusion du match, dérivé (`lib/shared/live-streams.ts`). */
  liveState: MatchLiveState;
  /** Chaîne diffusant ce match ; `null` = casté sans lien, ou non casté. */
  liveUrl: string | null;
};

/**
 * Cible du bouton « Regarder le live » de l'accueil.
 *
 * Résolue côté serveur et volontairement absente tant qu'aucun match n'est
 * réellement à l'antenne : un bouton qui mène vers une chaîne hors ligne est
 * pire que pas de bouton du tout.
 */
export type LandingLiveStream = {
  tournamentId: number;
  tournamentName: string;
  /** Chaîne officielle du tournoi, déjà normalisée. */
  url: string;
};

export type LandingLive = {
  tournament: TournamentCard;
  currentMatch: LandingLiveMatch | null;
  viewers: number;
  game: string;
  phase: string;
  /**
   * Cible du bouton « Regarder le live ». `null` tant qu'aucun match n'est à
   * l'antenne — le bouton disparaît alors plutôt que de mener nulle part.
   */
  stream: LandingLiveStream | null;
};

export type LandingLeaderboardRow = {
  rank: number;
  teamId: number;
  teamName: string;
  logoUrl: string | null;
  wins: number;
  losses: number;
  points: number;
  trend: "up" | "down" | "flat";
  trendValue: number;
};

export type LandingCalendarEvent = {
  tournamentId: number;
  name: string;
  startAt: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  state: "UPCOMING" | "REGISTRATION" | "RUNNING" | "FINISHED";
  maxTeams: number;
  registeredTeams: number;
};

export type LandingTickerPayload = {
  items: string[];
};

export function inferGameLabel(value: string | null | undefined): "Overwatch" | "Marvel Rivals" {
  const text = (value ?? "").toLowerCase();
  if (text.includes("marvel") || text.includes("rivals")) {
    return "Marvel Rivals";
  }
  return "Overwatch";
}

export function inferGameCode(value: string | null | undefined): "ow2" | "mr" {
  return inferGameLabel(value) === "Marvel Rivals" ? "mr" : "ow2";
}

/** Abréviation du jeu, pour les pastilles trop étroites pour le libellé complet. */
export function inferGameShortLabel(value: string | null | undefined): "OW" | "MR" {
  return inferGameLabel(value) === "Marvel Rivals" ? "MR" : "OW";
}

export function inferPhaseLabel(match: LandingLiveMatch | null): string {
  if (!match) {
    return "EN ATTENTE";
  }

  const label = match.roundLabel.toUpperCase();
  if (label.includes("FINALE")) {
    return "PHASE FINALE";
  }
  if (label.includes("DEMI")) {
    return "PHASE FINALE";
  }
  if (label.includes("QUART")) {
    return "PHASE ÉLIMINATOIRE";
  }
  return label;
}

/*
 * Pas de `toBestOfLabel` ici : le format de match est une donnée du tournoi
 * (`TournamentCard.matchFormat`), pas une déduction du nom de la manche. La
 * fonction qui vivait à cet endroit devinait « BO5 » en finale et « BO3 »
 * partout ailleurs, si bien qu'un tournoi réglé en FT3 s'annonçait « BO3 » sur
 * l'accueil — et un tournoi en score libre, « BO3 » aussi. La notation ne
 * s'écrit plus qu'à un seul endroit, `matchFormatLabel`
 * (`lib/shared/match-format.ts`), qui lit le réglage au lieu de l'inventer.
 */

