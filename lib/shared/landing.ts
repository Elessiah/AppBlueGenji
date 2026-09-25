import type { DiscordCommunityStats } from "@/lib/shared/discord";
import type { MatchLiveState } from "@/lib/shared/live-streams";
import type { MatchFormat } from "@/lib/shared/match-format";
import type { TournamentBuckets, TournamentCard, TournamentGame } from "@/lib/shared/types";

export type LandingStats = {
  players: number;
  teams: number;
  tournaments: number;
  /**
   * Fréquentation du serveur Discord, à côté des chiffres du site.
   *
   * `null` quand Discord n'a pas répondu : le bloc de l'accueil garde alors son
   * bouton et se tait sur le nombre, plutôt que d'annoncer zéro membre.
   */
  discord: DiscordCommunityStats | null;
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
  /**
   * Logo de l'engagé — celui de l'équipe, ou la copie d'avatar d'une entrée
   * solo (qui respecte déjà le réglage de visibilité de son joueur). Toujours
   * un fichier du site (`localUploadUrl`), `null` sinon : la carte retombe
   * alors sur l'initiale.
   */
  team1LogoUrl: string | null;
  team2LogoUrl: string | null;
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
  /**
   * Format **de ce match**, et non du tournoi : « BlueGenji Survie » en joue
   * deux — sa qualification, qui tolère l'égalité, et son arbre final, qui
   * exige un vainqueur (`tournamentMatchFormat`, `lib/shared/bg-survie.ts`).
   * Lire `TournamentCard.matchFormat` étiquetait une demi-finale avec le
   * plafond de maps de la qualification.
   *
   * Résolu côté serveur, comme le reste de cette charge utile (`team1Href`,
   * `team1Seed`, `roundLabel`) : la carte n'a pas à connaître les phases.
   * `null` = tournoi en score libre.
   */
  matchFormat: MatchFormat | null;
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
  /** Jeu du tournoi, lu sur la donnée — jamais déduit du nom. */
  game: TournamentGame;
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

/*
 * Ce que l'accueil a le droit de présenter sous « Tournois en cours et à venir ».
 *
 * La section concaténait les **quatre** paniers, panier `finished` compris, si
 * bien qu'un tournoi terminé figurait dans la grille — et, la carte mise en
 * avant tombant sur le même repli, pouvait devenir le « PROCHAIN TOURNOI » du
 * compte à rebours du hero, dont la cible est alors une date passée. Un
 * tournoi clos n'est ni en cours ni à venir : il n'appartient à aucune des
 * deux vues, et son écran est le palmarès.
 *
 * La règle est écrite ici, une fois, plutôt qu'à chacun des deux endroits qui
 * lisent les paniers : une exclusion recopiée est une exclusion qu'on oublie
 * au troisième appelant. `getLandingCalendar` exclut `finished` de même, mais
 * pas `activeTournamentCards` tel quel : « Prochains événements » ne montre
 * rien de déjà lancé (voir sa propre règle, dans `landing-service.ts`).
 */

/**
 * Ordre du calendrier : ce qui commence le plus tôt d'abord.
 *
 * `listTournamentBuckets` trie `start_at` **décroissant**, et c'est le bon
 * ordre pour ce qu'il sert d'abord — la liste des tournois terminés de
 * `/tournois`, où la dernière édition se lit en haut. L'accueil, lui, parle de
 * ce qui **arrive** : il lisait donc systématiquement le tournoi le plus
 * lointain, et le hero décomptait jusqu'à lui. On retrie ici plutôt que de
 * toucher à l'`ORDER BY`, qui est partagé.
 *
 * Une date illisible est renvoyée en fin de liste au lieu de rendre `NaN` : un
 * comparateur qui rend `NaN` ne trie plus rien du tout, silencieusement, et ce
 * serait toute la section qui reviendrait à l'ordre d'origine.
 */
export function compareByStartAt(left: TournamentCard, right: TournamentCard): number {
  const leftAt = new Date(left.startAt).getTime();
  const rightAt = new Date(right.startAt).getTime();
  if (Number.isNaN(leftAt)) return Number.isNaN(rightAt) ? 0 : 1;
  if (Number.isNaN(rightAt)) return -1;
  return leftAt - rightAt;
}

/**
 * Tournois affichables par la grille de l'accueil, dans l'ordre où elle les
 * range : en cours d'abord (ce qui se joue maintenant), puis à venir, puis
 * ouverts aux inscriptions. Jamais un tournoi terminé.
 *
 * Les paniers gardent cet ordre-là — il dit un état, pas une date — mais
 * **à l'intérieur** de chacun, le plus proche passe devant : la grille montrait
 * les trois tournois qui démarrent le plus tard.
 */
export function activeTournamentCards(buckets: TournamentBuckets): TournamentCard[] {
  return [
    ...[...buckets.running].sort(compareByStartAt),
    ...[...buckets.upcoming].sort(compareByStartAt),
    ...[...buckets.registration].sort(compareByStartAt),
  ];
}

/**
 * Tournoi mis en avant sur l'accueil : la grande carte de la section, et la
 * cible du compte à rebours « PROCHAIN TOURNOI » du hero.
 *
 * L'ordre de préférence n'est pas celui de la grille : le hero décompte
 * jusqu'à `startAt`, donc un tournoi **à venir** passe avant un tournoi déjà
 * lancé, dont le coup d'envoi est derrière nous. `null` quand rien n'est
 * visible — la carte affiche alors son état vide, plutôt que de repêcher une
 * archive.
 *
 * À l'intérieur d'un panier, c'est le tournoi **le plus proche** qui est pris
 * (`compareByStartAt`) et non le premier venu : les paniers arrivent triés
 * `start_at` décroissant, si bien que le hero annonçait « PROCHAIN TOURNOI »
 * en décomptant jusqu'au plus lointain — celui qu'on verrait en dernier.
 */
export function chooseFeaturedTournament(buckets: TournamentBuckets): TournamentCard | null {
  const soonest = (cards: TournamentCard[]): TournamentCard | undefined =>
    cards.length === 0 ? undefined : [...cards].sort(compareByStartAt)[0];

  return soonest(buckets.upcoming) ?? soonest(buckets.registration) ?? soonest(buckets.running) ?? null;
}

/*
 * Pas de `inferGameLabel` ici : le jeu est une donnée du tournoi
 * (`TournamentCard.game`). Les fonctions qui vivaient à cet endroit le
 * devinaient d'après le nom, repli sur « Overwatch » — un tournoi Marvel
 * Rivals dont le nom ne contenait ni « marvel » ni « rivals » s'affichait donc
 * Overwatch sur toute la vitrine. Libellés : `lib/shared/tournament-labels.ts`.
 */

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

