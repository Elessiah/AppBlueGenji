/**
 * Saisie d'un score **par un engagé** — le pendant joueur du dialogue
 * d'arbitrage (`app/(secured)/tournois/[id]/_lib/score-form.ts`).
 *
 * Le cycle est celui du moteur (`lib/server/tournaments/scoring.ts`) : chaque
 * engagée propose un score, deux propositions concordantes tranchent le match,
 * deux propositions contradictoires appellent l'arbitrage, et une proposition
 * seule tranche à l'expiration du délai. Ce qui manquait n'était pas le
 * moteur mais sa **lecture** : les propositions n'atteignaient jamais
 * l'interface, si bien qu'un score envoyé ne laissait aucune trace à l'écran —
 * ni chez qui l'avait envoyé, ni chez l'adversaire qui devait le confirmer.
 *
 * Module pur : la carte, la modale et les tests partagent les mêmes décisions.
 */
import type { BracketMatch, MatchProposalMaps, MatchScoreReport, ProposalMaps } from "./types";
import { isMatchPlayed } from "./match-outcome";
import { sameMapLists, type MatchMapInput } from "./match-maps";

/** Où en est le cycle de report, **vu par un engagé du match**. */
export type PlayerReportPhase =
  /** Personne n'a encore proposé de score. */
  | "NONE"
  /** Le lecteur a proposé, l'adversaire n'a pas encore répondu. */
  | "MINE_PENDING"
  /** L'adversaire a proposé : le lecteur confirme ou conteste. */
  | "THEIRS_PENDING"
  /** Les deux propositions se contredisent : l'arbitrage est alerté. */
  | "CONFLICT";

export interface PlayerReportView {
  phase: PlayerReportPhase;
  /** Proposition du lecteur, dans l'orientation du plateau (équipe 1, équipe 2). */
  mine: MatchScoreReport | null;
  /** Proposition de l'adversaire, même orientation. */
  theirs: MatchScoreReport | null;
}

/**
 * Deux propositions disent-elles le même score — et, quand toutes deux portent
 * leur détail, les mêmes maps (`MAP_SCORES.md`) ? C'est la règle du serveur :
 * deux 2-1 aux codes de replay différents se contredisent.
 */
type ReportedScore = Pick<MatchScoreReport, "team1Score" | "team2Score"> & {
  maps?: ReadonlyArray<MatchMapInput>;
};

export function sameReportedScore(a: ReportedScore, b: ReportedScore): boolean {
  if (a.team1Score !== b.team1Score || a.team2Score !== b.team2Score) return false;
  const aMaps = a.maps ?? [];
  const bMaps = b.maps ?? [];
  return aMaps.length === 0 || bMaps.length === 0 || sameMapLists(aMaps, bMaps);
}

/**
 * Maps à l'ouverture de la modale : la proposition du lecteur, sinon celle de
 * l'adversaire (confirmer d'un clic), sinon une liste vide.
 */
export function playerReportInitialMaps(view: PlayerReportView | null): MatchMapInput[] {
  const source = view?.mine ?? view?.theirs ?? null;
  return (source?.maps ?? []).map(({ replayCode, team1Score, team2Score }) => ({
    replayCode,
    team1Score,
    team2Score,
  }));
}

/**
 * Ce que dit, au regard des propositions déjà envoyées, le score saisi
 * (`entered`, orientation du plateau ; `null` tant qu'il n'est pas complet) :
 * - `unchangedMine` — il répète la proposition du lecteur, l'envoyer ne
 *   changerait rien ;
 * - `confirmsTheirs` — le lecteur n'a rien proposé et il reprend celle de
 *   l'adversaire : l'envoyer la confirme.
 */
export function enteredScoreRelation(
  entered: ReportedScore | null,
  view: Pick<PlayerReportView, "mine" | "theirs"> | null,
): { unchangedMine: boolean; confirmsTheirs: boolean } {
  if (entered === null || view === null) return { unchangedMine: false, confirmsTheirs: false };
  const { mine, theirs } = view;
  return {
    unchangedMine: mine != null && sameReportedScore(entered, mine),
    confirmsTheirs: theirs != null && mine === null && sameReportedScore(entered, theirs),
  };
}

/**
 * État du report pour le lecteur. `null` quand il n'est pas engagé dans ce
 * match : un spectateur n'a rien à confirmer.
 */
export function playerReportView(
  match: Pick<BracketMatch, "team1Id" | "team2Id" | "team1Report" | "team2Report">,
  myTeamId: number | null,
): PlayerReportView | null {
  if (myTeamId === null) return null;
  const iAmTeam1 = match.team1Id === myTeamId;
  const iAmTeam2 = match.team2Id === myTeamId;
  if (!iAmTeam1 && !iAmTeam2) return null;

  const mine = iAmTeam1 ? match.team1Report : match.team2Report;
  const theirs = iAmTeam1 ? match.team2Report : match.team1Report;

  // Deux propositions concordantes tranchent le match dans la même
  // transaction : deux propositions **ensemble** sur un match ouvert se
  // contredisent donc toujours — par le score, ou, à score égal, par le détail
  // des maps (`MAP_SCORES.md`), que l'instantané diffusé ne porte pas.
  let phase: PlayerReportPhase;
  if (mine && theirs) phase = "CONFLICT";
  else if (mine) phase = "MINE_PENDING";
  else if (theirs) phase = "THEIRS_PENDING";
  else phase = "NONE";

  return { phase, mine, theirs };
}

/**
 * Valeurs d'ouverture de la modale, dans l'orientation du plateau : la
 * proposition du lecteur s'il en a une (il vient la corriger), sinon celle de
 * l'adversaire (il vient la confirmer — un clic), sinon des champs **vides**.
 * Jamais « 0 – 0 » : un zéro inventé serait envoyable par mégarde, même raison
 * que `scoreFormStateFor` côté arbitrage.
 */
export function playerReportInitialScores(view: PlayerReportView | null): {
  score1: string;
  score2: string;
} {
  const source = view?.mine ?? view?.theirs ?? null;
  return source
    ? { score1: String(source.team1Score), score2: String(source.team2Score) }
    : { score1: "", score2: "" };
}

/**
 * Convertit une saisie orientée plateau vers le contrat de la route de report,
 * qui parle depuis l'engagé (`myScore`, `opponentScore`).
 */
export function toReporterScores(
  myTeamIsTeam1: boolean,
  team1Score: number,
  team2Score: number,
): { myScore: number; opponentScore: number } {
  return myTeamIsTeam1
    ? { myScore: team1Score, opponentScore: team2Score }
    : { myScore: team2Score, opponentScore: team1Score };
}

/**
 * Le bouton de la carte ouvre-t-il la modale du lecteur sur ce match ?
 *
 * Deux gestes y vivent, sous deux conditions différentes :
 * · **saisir le score** — une fois le match lancé (`canReportScore`), comme le
 *   serveur l'exige (`MATCH_NOT_LAUNCHED`) ;
 * · **déclarer forfait** — dès que les deux adversaires sont connus, lancement
 *   ou non : c'est justement l'équipe qui ne pourra pas se présenter qui en a
 *   besoin, et elle le sait avant le coup d'envoi. Réservé à qui a qualité
 *   pour engager l'équipe (`canActForEntrant`), comme l'abandon.
 */
export function canOpenPlayerScoreDialog(input: {
  match: Pick<BracketMatch, "team1Id" | "team2Id" | "status">;
  myTeamId: number | null;
  canReportScore: boolean;
  canActForEntrant: boolean;
  frozen: boolean;
}): boolean {
  const { match, myTeamId } = input;
  if (input.frozen || myTeamId === null) return false;
  if (match.team1Id === null || match.team2Id === null) return false;
  if (match.team1Id !== myTeamId && match.team2Id !== myTeamId) return false;
  if (isMatchPlayed(match)) return false;
  return input.canReportScore || input.canActForEntrant;
}

/** Geste annoncé par le bouton de la carte — l'écran le traduit (lot 8b). */
export type PlayerScoreButtonKey = "forfeit" | "confirm" | "edit" | "review" | "enter";

/**
 * Geste du bouton de la carte : il annonce le geste attendu du lecteur, pas
 * le nom de la modale — c'est ce qui manquait pour qu'un adversaire sache qu'il
 * avait un score à confirmer.
 */
export function playerScoreButtonKey(view: PlayerReportView | null, canReportScore: boolean): PlayerScoreButtonKey {
  if (!canReportScore) return "forfeit";
  switch (view?.phase) {
    case "THEIRS_PENDING":
      return "confirm";
    case "MINE_PENDING":
      return "edit";
    case "CONFLICT":
      return "review";
    default:
      return "enter";
  }
}

const PLAYER_SCORE_BUTTON_LABELS: Record<PlayerScoreButtonKey, string> = {
  forfeit: "Déclarer forfait",
  confirm: "Confirmer le score",
  edit: "Modifier mon score",
  review: "Revoir le score",
  enter: "Saisir le score",
};

/** Libellé français du bouton de la carte ({@link playerScoreButtonKey}). */
export function playerScoreButtonLabel(
  view: PlayerReportView | null,
  canReportScore: boolean,
): string {
  return PLAYER_SCORE_BUTTON_LABELS[playerScoreButtonKey(view, canReportScore)];
}

/** Ce que dit la ligne d'état d'une proposition en attente — l'écran la rédige. */
export type PendingReportState =
  | { kind: "conflict" }
  | { kind: "proposed"; team1Score: number; team2Score: number; reporter: string | null; side: 1 | 2 };

/**
 * Ligne d'état posée sous la carte, lisible par **tous** : une proposition
 * de score n'est pas une donnée personnelle, et le spectateur doit pouvoir
 * distinguer « pas encore joué » de « joué, en attente de confirmation ».
 * `null` quand il n'y a rien à dire.
 */
export function pendingReportState(
  match: Pick<
    BracketMatch,
    "status" | "team1Report" | "team2Report" | "team1Name" | "team2Name"
  >,
): PendingReportState | null {
  if (isMatchPlayed(match)) return null;
  const { team1Report, team2Report } = match;
  // Deux propositions sur un match ouvert se contredisent toujours (voir
  // `playerReportView`) — à score égal, par leurs maps.
  if (team1Report && team2Report) return { kind: "conflict" };
  const report = team1Report ?? team2Report;
  if (!report) return null;
  const side = team1Report ? 1 : 2;
  const reporter = side === 1 ? match.team1Name : match.team2Name;
  return { kind: "proposed", team1Score: report.team1Score, team2Score: report.team2Score, reporter, side };
}

/** Ligne d'état française ({@link pendingReportState}). */
export function pendingReportNotice(
  match: Pick<
    BracketMatch,
    "status" | "team1Report" | "team2Report" | "team1Name" | "team2Name"
  >,
): string | null {
  const state = pendingReportState(match);
  if (state === null) return null;
  if (state.kind === "conflict") return "Scores contradictoires · arbitrage alerté";
  const reporter = state.reporter ?? `Équipe ${state.side}`;
  return `${state.team1Score} – ${state.team2Score} proposé par ${reporter} · à confirmer`;
}

/**
 * Le match, propositions **complétées de leur détail** map par map lu dans le
 * contexte du lecteur (`TournamentViewerContext.matchProposals`) : l'instantané
 * diffusé ne le porte pas (`docs/features/MAP_SCORES.md`). Un détail ne se pose
 * que sur la proposition dont il porte l'instant de dépôt — sinon il décrirait
 * une proposition remplacée depuis.
 */
export function withProposalMaps<M extends Pick<BracketMatch, "id" | "team1Report" | "team2Report">>(
  match: M,
  proposals: ReadonlyArray<MatchProposalMaps>,
): M {
  const entry = proposals.find((p) => p.matchId === match.id);
  if (!entry) return match;
  const fill = (report: MatchScoreReport | null, side: ProposalMaps | null): MatchScoreReport | null =>
    report && side?.reportedAt === report.reportedAt && side ? { ...report, maps: side.maps } : report;
  return { ...match, team1Report: fill(match.team1Report, entry.team1), team2Report: fill(match.team2Report, entry.team2) };
}

/**
 * Le contexte du lecteur est-il en retard d'une proposition ? Il n'arrive
 * qu'à la connexion au flux : une proposition déposée depuis se repère à son
 * instant de dépôt (porté par l'instantané), et se relit par la lecture REST.
 */
export function proposalsNeedRefresh(
  match: Pick<BracketMatch, "id" | "status" | "team1Report" | "team2Report">,
  proposals: ReadonlyArray<MatchProposalMaps>,
): boolean {
  // Match clos (forfait déclaré, nul…) : le serveur n'en sert plus aucune
  // proposition (`proposalMatches`) — l'attendre bloquerait l'arbitrage.
  if (isMatchPlayed(match)) return false;
  const entry = proposals.find((p) => p.matchId === match.id);
  const stale = (report: MatchScoreReport | null, side: ProposalMaps | null | undefined) =>
    report !== null && side?.reportedAt !== report.reportedAt;
  return stale(match.team1Report, entry?.team1) || stale(match.team2Report, entry?.team2);
}
