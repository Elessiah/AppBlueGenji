"use client";

import type { BracketMatch, TournamentFormat } from "@/lib/shared/types";
import { fromBracketMatch, isScoreEditLocked } from "@/lib/shared/match-lock";
import { matchAnchorId } from "@/lib/shared/match-anchor";
import { isMatchDoubleForfeit, isMatchDrawn } from "@/lib/shared/match-outcome";
import { canReportOwnMatch, teamLabel } from "@/lib/shared/match-card-viewer";
import {
  pendingReportNotice,
  playerReportView,
  playerScoreButtonLabel,
} from "@/lib/shared/player-score-report";
import { usePlayerScore } from "../_lib/player-score-context";
import { useIssueReport } from "../_lib/issue-report-context";
import { useLiveControls } from "../_lib/live-context";
import { useHighlightedMatch } from "../_lib/match-anchor-context";
import { MatchLiveStrip } from "./MatchLiveStrip";
import { MatchLaunchStrip } from "./MatchLaunchStrip";
import { MatchReplayStrip } from "./MatchReplayStrip";
import { EntrantName } from "./EntrantName";
import { CyberButton } from "@/components/cyber";
import styles from "./MatchRow.module.css";


interface MatchRowProps {
  match: BracketMatch;
  adminResolvable: boolean;
  onOpenAdminModal: (match: BracketMatch) => void;
  allMatches: BracketMatch[];
  roundNumber: number;
  format: TournamentFormat;
}

export function MatchRow({
  match,
  adminResolvable,
  onOpenAdminModal,
  allMatches,
  roundNumber,
  format,
}: MatchRowProps) {
  // Signalement : réservé aux engagés du tournoi, et seulement sur une manche
  // dont les deux adversaires sont connus — il n'y a rien à arbitrer sur une
  // case encore vide. Réservé de plus au **match du lecteur** : le bouton
  // d'en-tête couvre déjà le reste du plateau, et répéter le bouton sur cent
  // vingt-sept cartes qui ne concernent pas le lecteur ne fait que les
  // alourdir toutes.
  const { canReport, openReport } = useIssueReport();
  // Engagé du lecteur : déjà porté par `LiveContext` (diffusion, casting) — on
  // le relit ici plutôt que d'en garder une seconde copie sur le contexte de
  // signalement, qui décrirait la même donnée depuis deux sources.
  const { myTeamId } = useLiveControls();
  const canReportMatch = canReportOwnMatch(canReport, myTeamId, match.team1Id, match.team2Id);
  // Saisie du score par un engagé : un bouton qui ouvre la modale joueur, et
  // non plus un formulaire en ligne — deux champs de 52 px sans libellé visible
  // ni retour une fois envoyé. Le libellé annonce le geste attendu (saisir,
  // confirmer la proposition adverse, corriger la sienne).
  const playerScore = usePlayerScore();
  const canOpenPlayerScore = playerScore.canOpen(match);
  const playerScoreLabel = canOpenPlayerScore
    ? playerScoreButtonLabel(playerReportView(match, myTeamId), playerScore.canReportScore(match))
    : null;
  // Proposition en attente, lisible de tous : sans elle, un match joué et
  // reporté se lisait exactement comme un match pas encore joué.
  const reportNotice = pendingReportNotice(match);
  // Cible d'une ancre `#match-[id]` : la carte est surlignée quelques secondes
  // à l'arrivée. Sans ce repère, la page s'ouvre défilée au bon endroit mais le
  // lecteur ne sait pas laquelle des cartes visibles il venait voir.
  const isAnchorTarget = useHighlightedMatch() === match.id;

  const team1Win = match.winnerTeamId !== null && match.winnerTeamId === match.team1Id;
  const team2Win = match.winnerTeamId !== null && match.winnerTeamId === match.team2Id;
  const hasWinner = match.winnerTeamId !== null;

  // Match **nul** : clos, sans vainqueur, et pas par forfait. Une rencontre
  // jouée qui ne teinte aucune des deux lignes se lit exactement comme une
  // rencontre à venir — d'où la mention, seule chose qui distingue « 2 – 2 »
  // de « pas encore joué ».
  const isDraw = isMatchDrawn(match);

  // Double forfait : jouée, sans vainqueur, et perdue par les deux. Même besoin
  // que le nul — rien ne teinte les lignes — mais pas le même mot : « Match
  // nul » y annoncerait une rencontre disputée et partagée.
  const isDoubleForfeit = isMatchDoubleForfeit(match);

  // Même règle que le garde-fou serveur (`lib/shared/match-lock.ts`) : le score
  // n'est plus éditable dès que la manche suivante porte une saisie.
  const scoreLocked = isScoreEditLocked(
    fromBracketMatch(match),
    allMatches.map(fromBracketMatch),
    format,
  );

  const rowClass = (win: boolean): string =>
    [styles.row, win ? styles.winner : hasWinner ? styles.decided : ""].filter(Boolean).join(" ");
  const scoreClass = (forfeits: boolean): string =>
    forfeits ? `${styles.score} ${styles.forfeitScore}` : styles.score;

  const team1Display = teamLabel(
    match.team1Name,
    match.team1Placeholder,
    roundNumber === 1 && match.team1Id === null && match.team2Id !== null ? "BYE" : "TBD",
  );
  const team2Display = teamLabel(
    match.team2Name,
    match.team2Placeholder,
    roundNumber === 1 && match.team2Id === null && match.team1Id !== null ? "BYE" : "TBD",
  );

  const isBye = match.team1Id === null || match.team2Id === null;
  // « FF » dès que le forfait est *enregistré*, sans attendre qu'il soit tranché :
  // l'arbitrage peut noter un forfait sans valider le résultat, et le score plein
  // porté en face (3-0 en FT3) se lisait alors comme une rencontre jouée et
  // gagnée, sur un match que personne n'a encore remporté.
  const team1Forfeits = !isBye && (isDoubleForfeit || match.forfeitTeamId === match.team1Id);
  const team2Forfeits = !isBye && (isDoubleForfeit || match.forfeitTeamId === match.team2Id);
  const team1Score = team1Forfeits ? "FF" : (match.team1Score ?? "-");
  const team2Score = team2Forfeits ? "FF" : (match.team2Score ?? "-");

  return (
    <div
      // Ancre du lien profond `/tournois/[id]#match-[id]`, posée ici parce que
      // `MatchRow` est le passage unique de toutes les vues (arbre, survie,
      // suisse, endurance) : une carte de match a donc toujours son identifiant,
      // sans qu'aucune vue ait à y penser.
      id={matchAnchorId(match.id)}
      className={[
        styles.card,
        adminResolvable ? styles.resolvable : "",
        isAnchorTarget ? "match-anchor-target" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      // Hors de l'ordre de tabulation, mais focalisable par programme : à
      // l'arrivée d'une ancre, `useMatchAnchor` y pose le focus pour qu'un
      // lecteur d'écran annonce la carte. Sans cela, le défilement et le halo
      // ne disent rien à qui ne voit pas la page — le navigateur en fait autant
      // sur une ancre native, que le flux SSE nous empêche d'utiliser.
      tabIndex={-1}
    >
      <div className={rowClass(team1Win)}>
        {/* Emblème compris : il garde sa case même sur une ligne vide (TBD,
            BYE), pour que les deux noms de la carte commencent au même endroit. */}
        <EntrantName
          teamId={match.team1Id}
          name={team1Display}
          title={team1Display}
          truncate
          className={styles.name}
        />
        <strong className={scoreClass(team1Forfeits)}>{team1Score}</strong>
      </div>
      <div className={rowClass(team2Win)}>
        <EntrantName
          teamId={match.team2Id}
          name={team2Display}
          title={team2Display}
          truncate
          className={styles.name}
        />
        <strong className={scoreClass(team2Forfeits)}>{team2Score}</strong>
      </div>

      {(isDraw || isDoubleForfeit) && (
        <p className={isDoubleForfeit ? `${styles.outcome} ${styles.outcomeForfeit}` : styles.outcome}>
          {isDoubleForfeit ? "Double forfait" : "Match nul"}
        </p>
      )}

      <MatchLiveStrip match={match} />
      <MatchLaunchStrip match={match} />

      <MatchReplayStrip match={match} />

      {/* Pas de région live : un plateau de cent vingt-sept cartes en
          annoncerait autant à chaque instantané du flux. L'annonce qui compte,
          celle du lecteur engagé, vit dans sa modale. */}
      {reportNotice && <p className={styles.reportNotice}>{reportNotice}</p>}

      {playerScoreLabel && (
        <div className={`${styles.bar} ${styles.playerBar}`}>
          <CyberButton
            type="button"
            variant="ghost"
            onClick={() => playerScore.open(match)}
            className={styles.action}
          >
            <span aria-hidden="true">✎</span> {playerScoreLabel}
          </CyberButton>
        </div>
      )}

      {adminResolvable && !scoreLocked && (
        <div className={`${styles.bar} ${styles.adminBar}`}>
          <CyberButton
            type="button"
            variant="ghost"
            onClick={() => onOpenAdminModal(match)}
            className={`${styles.action} ${styles.actionAccent}`}
          >
            <span aria-hidden="true">✎</span> Éditer le score
          </CyberButton>
        </div>
      )}

      {canReportMatch && (
        <div className={styles.bar}>
          <CyberButton
            type="button"
            variant="ghost"
            onClick={() => openReport(match)}
            title="Prévenir le staff d'un problème sur ce match"
            className={`${styles.action} ${styles.actionMinor}`}
          >
            <span aria-hidden="true">⚠</span> Signaler un problème
          </CyberButton>
        </div>
      )}

      {adminResolvable && scoreLocked && (
        <div
          className={`${styles.bar} ${styles.locked}`}
          title="La manche suivante a déjà des scores : le résultat de ce match ne peut plus être modifié."
        >
          <span aria-hidden="true">🔒</span>
          Score verrouillé
          {/* Le motif n'était qu'en infobulle, qu'un bloc non focalisable ne
              montre ni au clavier ni aux lecteurs d'écran. */}
          <span className="sr-only">
            : la manche suivante a déjà des scores, le résultat de ce match ne peut plus être modifié.
          </span>
        </div>
      )}
    </div>
  );
}
