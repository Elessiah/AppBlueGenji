"use client";

import { memo } from "react";
import type { BracketMatch } from "@/lib/shared/types";
import { matchAnchorId } from "@/lib/shared/match-anchor";
import { isMatchDoubleForfeit, isMatchDrawn } from "@/lib/shared/match-outcome";
import { canReportOwnMatch, teamLabel } from "@/lib/shared/match-card-viewer";
import {
  pendingReportNotice,
  playerReportView,
  playerScoreButtonLabel,
} from "@/lib/shared/player-score-report";
import { useMatchLaunchPhase } from "@/lib/shared/hooks/useMatchLaunchPhase";
import { useMatchLiveState } from "@/lib/shared/hooks/useMatchLiveState";
import { SCORE_ENTRY_CLOSED_PHASES } from "@/lib/shared/match-launch";
import { canConfigureLive, canToggleOnAir } from "@/lib/shared/live-streams";
import { formatMatchStartAt } from "@/lib/shared/match-schedule";
import { usePlayerScore } from "../_lib/player-score-context";
import { useIssueReport } from "../_lib/issue-report-context";
import { useLiveControls } from "../_lib/live-context";
import { useHighlightedMatch } from "../_lib/match-anchor-context";
import { pendingScoreProposal } from "../_lib/score-form";
import { matchSideViews } from "../_lib/match-row-sides";
import { launchStripControls } from "../_lib/launch-strip";
import { matchCardActionList } from "../_lib/match-card-actions";
import { MatchLiveStrip } from "./MatchLiveStrip";
import { MatchLaunchStrip } from "./MatchLaunchStrip";
import { MatchReplayStrip, canEditReplay } from "./MatchReplayStrip";
import { MatchCardActions } from "./MatchCardActions";
import { EntrantName } from "./EntrantName";
import styles from "./MatchRow.module.css";


/**
 * Libellé du bouton d'arbitrage : il dit le seul geste possible avant le
 * lancement (le forfait), et, une fois lancé, s'il reste un score proposé à
 * valider — une confirmation qui peut ne jamais venir (adversaire fantôme).
 */
function adminScoreButtonLabel(scoreEntryClosed: boolean, hasProposal: boolean): string {
  if (scoreEntryClosed) return "Prononcer un forfait";
  return hasProposal ? "Valider le score proposé" : "Éditer le score";
}

interface MatchRowProps {
  match: BracketMatch;
  adminResolvable: boolean;
  onOpenAdminModal: (match: BracketMatch) => void;
  /**
   * Score verrouillé (`isMatchScoreLocked`, `_lib/score-lock.ts`) : calculé par
   * la vue et passé en booléen, et non la liste du plateau entier — celle-ci
   * change à chaque instantané, et en faire une prop redessinait toutes les
   * cartes pour un score qui n'en concernait qu'une.
   */
  scoreLocked: boolean;
  roundNumber: number;
}

/**
 * Carte d'un match, **mémorisée** : l'instantané du flux garde la référence
 * des matchs qu'il n'a pas changés (`shareUnchanged`, `_lib/live-state.ts`), si
 * bien qu'un « Prêt » ou un score ne redessine que la carte concernée, et non
 * les 254 d'un gros plateau. Toute prop ajoutée doit donc rester stable d'un
 * instantané à l'autre (booléen, identifiant, rappel mémorisé) — un objet ou
 * une flèche neufs à chaque rendu annuleraient la mémorisation sans bruit.
 */
export const MatchRow = memo(function MatchRow({
  match,
  adminResolvable,
  onOpenAdminModal,
  scoreLocked,
  roundNumber,
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
  const { myTeamId, refereeScheduling, canManage, canSchedule, viewerUserId } = useLiveControls();
  // Phase de lancement, calculée **une fois par carte** et transmise aux deux
  // bandeaux : chacun posait sinon sa propre minuterie sur l'heure de départ —
  // trois `setTimeout` par match programmé, sur un plateau qui en compte 254.
  // Une chaîne : la prop reste stable, la mémorisation des bandeaux tient.
  const launchPhase = useMatchLaunchPhase({ ...match, refereeScheduling });
  // Avant le lancement (à planifier, en attente de départ), l'arbitrage ne
  // saisit aucun score : le seul geste du dialogue est le forfait, et le bouton
  // le dit plutôt que d'annoncer une édition refusée.
  const scoreEntryClosed = SCORE_ENTRY_CLOSED_PHASES.includes(launchPhase);
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

  const loserClass = hasWinner ? styles.decided : "";
  const rowClass = (win: boolean): string =>
    [styles.row, win ? styles.winner : loserClass].filter(Boolean).join(" ");
  // Score du perdant en teinte de défaite — jamais sur la case vide d'une
  // exemption (BYE, TBD) : personne n'y a perdu. Un forfait garde son ambre.
  const scoreClass = (forfeits: boolean, lost: boolean): string => {
    if (forfeits) return `${styles.score} ${styles.forfeitScore}`;
    return lost ? `${styles.score} ${styles.lostScore}` : styles.score;
  };

  const [side1, side2] = matchSideViews(match, roundNumber, isDoubleForfeit);
  const { win: team1Win, forfeits: team1Forfeits, score: team1Score } = side1;
  const { win: team2Win, forfeits: team2Forfeits, score: team2Score } = side2;
  const team1Display = teamLabel(match.team1Name, match.team1Placeholder, side1.emptyLabel);
  const team2Display = teamLabel(match.team2Name, match.team2Placeholder, side2.emptyLabel);

  const adminScoreLabel = adminScoreButtonLabel(scoreEntryClosed, pendingScoreProposal(match) !== null);

  // État de diffusion, calculé une fois ici : le bandeau d'horaire l'affiche,
  // le pied d'action en tire le bouton d'antenne — une seule minuterie.
  const liveState = useMatchLiveState(match);
  const launch = launchStripControls(match, launchPhase, { canManage, canSchedule, viewerUserId, myTeamId });
  const matchLabel = `${team1Display} contre ${team2Display}`;
  // Toutes les actions de la carte, rangées par `MatchCardActions` : une
  // principale visible, le reste derrière « Plus d'actions »
  // (`docs/features/MATCH_CARD_LAYOUT.md`). Chaque drapeau est celui qui
  // décidait déjà du bouton dans son ancien bandeau.
  const actions = matchCardActionList({
    playerScoreLabel,
    launch,
    inLobby: launchPhase === "LOBBY",
    adminScoreLabel: adminResolvable && !scoreLocked ? adminScoreLabel : null,
    showSchedule: canSchedule && launchPhase !== "TO_PLAN",
    hasStartAt: formatMatchStartAt(match.startAt) !== null,
    showOnAir: canManage && canToggleOnAir(match),
    onAir: liveState === "LIVE",
    showLiveConfig: canManage && canConfigureLive(match),
    liveConfigured: match.liveTrigger !== null,
    showReplay: canEditReplay(match, canManage),
    hasReplay: match.replayUrl !== null,
    canReport: canReportMatch,
  });

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
        <strong className={scoreClass(team1Forfeits, hasWinner && !team1Win && match.team1Id !== null)}>{team1Score}</strong>
      </div>
      <div className={rowClass(team2Win)}>
        <EntrantName
          teamId={match.team2Id}
          name={team2Display}
          title={team2Display}
          truncate
          className={styles.name}
        />
        <strong className={scoreClass(team2Forfeits, hasWinner && !team2Win && match.team2Id !== null)}>{team2Score}</strong>
      </div>

      {(isDraw || isDoubleForfeit) && (
        <p className={isDoubleForfeit ? `${styles.outcome} ${styles.outcomeForfeit}` : styles.outcome}>
          {isDoubleForfeit ? "Double forfait" : "Match nul"}
        </p>
      )}

      {/* Zone d'état : horaire et diffusion, phase de lancement, hôte, caster.
          Vide (`:empty`), elle disparaît avec son filet. */}
      <div className={styles.meta}>
        <MatchLiveStrip match={match} state={liveState} />
        <MatchLaunchStrip match={match} phase={launchPhase} />
      </div>

      <MatchReplayStrip match={match} />

      {/* Pas de région live : un plateau de cent vingt-sept cartes en
          annoncerait autant à chaque instantané du flux. L'annonce qui compte,
          celle du lecteur engagé, vit dans sa modale. */}
      {reportNotice && <p className={styles.reportNotice}>{reportNotice}</p>}

      <MatchCardActions
        match={match}
        phase={launchPhase}
        actions={actions}
        matchLabel={matchLabel}
        isCaster={launch.isCaster}
        onAir={liveState === "LIVE"}
        onPlayerScore={() => playerScore.open(match)}
        onAdminScore={() => onOpenAdminModal(match)}
        onReport={() => openReport(match)}
      />

      {adminResolvable && scoreLocked && (
        <div
          className={styles.locked}
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
});
