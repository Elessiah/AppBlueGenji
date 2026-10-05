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
import type { BracketMatch, MatchScoreReport } from "./types";
import { isMatchPlayed } from "./match-outcome";
import type { MatchMapInput } from "./match-maps";

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
 * Deux propositions disent-elles le même score ? Le score **dérivé** des maps
 * fait foi, comme côté serveur (`MAP_SCORES.md`) : le détail ne change pas le
 * circuit de confirmation.
 */
type ReportedScore = Pick<MatchScoreReport, "team1Score" | "team2Score">;

export function sameReportedScore(a: ReportedScore, b: ReportedScore): boolean {
  return a.team1Score === b.team1Score && a.team2Score === b.team2Score;
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
  // transaction : on ne les voit donc jamais ensemble sur un match ouvert.
  // Les lire comme un conflit serait pourtant faux si la course survenait —
  // elles s'accordent, le flux apportera le résultat.
  let phase: PlayerReportPhase;
  if (mine && theirs) phase = sameReportedScore(mine, theirs) ? "MINE_PENDING" : "CONFLICT";
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

/**
 * Libellé du bouton de la carte : il annonce le geste attendu du lecteur, pas
 * le nom de la modale — c'est ce qui manquait pour qu'un adversaire sache qu'il
 * avait un score à confirmer.
 */
export function playerScoreButtonLabel(
  view: PlayerReportView | null,
  canReportScore: boolean,
): string {
  if (!canReportScore) return "Déclarer forfait";
  switch (view?.phase) {
    case "THEIRS_PENDING":
      return "Confirmer le score";
    case "MINE_PENDING":
      return "Modifier mon score";
    case "CONFLICT":
      return "Revoir le score";
    default:
      return "Saisir le score";
  }
}

/**
 * Ligne d'état posée sous la carte, lisible par **tous** : une proposition
 * de score n'est pas une donnée personnelle, et le spectateur doit pouvoir
 * distinguer « pas encore joué » de « joué, en attente de confirmation ».
 * `null` quand il n'y a rien à dire.
 */
export function pendingReportNotice(
  match: Pick<
    BracketMatch,
    "status" | "team1Report" | "team2Report" | "team1Name" | "team2Name"
  >,
): string | null {
  if (isMatchPlayed(match)) return null;
  const { team1Report, team2Report } = match;
  if (team1Report && team2Report && !sameReportedScore(team1Report, team2Report)) {
    return "Scores contradictoires · arbitrage alerté";
  }
  const report = team1Report ?? team2Report;
  if (!report) return null;
  const reporter = team1Report ? match.team1Name ?? "Équipe 1" : match.team2Name ?? "Équipe 2";
  return `${report.team1Score} – ${report.team2Score} proposé par ${reporter} · à confirmer`;
}
