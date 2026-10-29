"use client";

import { memo } from "react";
import type { BracketMatch } from "@/lib/shared/types";
import { matchAnchorId } from "@/lib/shared/match-anchor";
import { isMatchDoubleForfeit, isMatchDrawn } from "@/lib/shared/match-outcome";
import { teamLabel } from "@/lib/shared/match-card-viewer";
import { useLiveControls } from "../_lib/live-context";
import { useHighlightedMatch } from "../_lib/match-anchor-context";
import { matchSideViews } from "../_lib/match-row-sides";
import { useMatchCardModel } from "../_lib/match-card-model";
import { MatchLiveStrip } from "./MatchLiveStrip";
import { MatchLaunchStrip } from "./MatchLaunchStrip";
import { MatchReplayStrip } from "./MatchReplayStrip";
import { MatchMapDetails } from "./MatchMapDetails";
import { MatchCardActions } from "./MatchCardActions";
import { EntrantName, useShownEntrantName } from "./EntrantName";
import styles from "./MatchRow.module.css";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { localizedPlaceholder, versusText } from "@/lib/shared/tournament-page-text";
import { useActionsText } from "../_lib/actions-text";


/** Ligne d'état d'une proposition en attente — définie avec le modèle de la carte, partagé par la page du match. */
export { pendingReportText } from "../_lib/match-card-model";

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
  const text = useTournamentPageText();
  const actionText = useActionsText();
  const { canSchedule } = useLiveControls();
  // Phase, diffusion, gestes du lecteur : le modèle partagé avec la page du
  // match (`useMatchCardModel`), qui offre exactement les mêmes actions.
  const { launchPhase, liveState, launch, actions, reportNotice, openPlayerScore, openReport } = useMatchCardModel(
    match,
    adminResolvable,
    scoreLocked,
  );
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
  // Perdant : la marche du podium s'efface (`PODIUM_TIERS.md`), repère gardé.
  const podiumMuted = (win: boolean): "" | undefined => (hasWinner && !win ? "" : undefined);
  // Score du perdant en teinte de défaite — jamais sur la case vide d'une
  // exemption (BYE, TBD) : personne n'y a perdu. Un forfait garde son ambre.
  const scoreClass = (forfeits: boolean, lost: boolean): string => {
    if (forfeits) return `${styles.score} ${styles.forfeitScore}`;
    return lost ? `${styles.score} ${styles.lostScore}` : styles.score;
  };

  const [side1, side2] = matchSideViews(match, roundNumber, isDoubleForfeit);
  const { win: team1Win, forfeits: team1Forfeits, score: team1Score } = side1;
  const { win: team2Win, forfeits: team2Forfeits, score: team2Score } = side2;
  // Libellés d'attente : français dans l'instantané (commun à tous les
  // lecteurs), rédigés dans la langue de la page au rendu.
  // Noms nettoyés une fois : carte, infobulle et noms accessibles des actions.
  const team1Shown = useShownEntrantName(match.team1Id, match.team1Name);
  const team2Shown = useShownEntrantName(match.team2Id, match.team2Name);
  const team1Display = teamLabel(team1Shown, localizedPlaceholder(text, match.team1Placeholder), side1.emptyLabel);
  const team2Display = teamLabel(team2Shown, localizedPlaceholder(text, match.team2Placeholder), side2.emptyLabel);
  const actionMatchLabel = versusText(text, team1Display, team2Display);

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
      <div className={rowClass(team1Win)} data-podium-muted={podiumMuted(team1Win)}>
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
      <div className={rowClass(team2Win)} data-podium-muted={podiumMuted(team2Win)}>
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
          {isDoubleForfeit ? text.t("match.doubleForfeit") : text.t("match.draw")}
        </p>
      )}

      {/* Zone d'état : horaire et diffusion, phase de lancement, hôte, caster.
          Vide (`:empty`), elle disparaît avec son filet. */}
      <div className={styles.meta}>
        <MatchLiveStrip match={match} state={liveState} />
        <MatchLaunchStrip match={match} phase={launchPhase} staff={canSchedule} />
      </div>

      <MatchReplayStrip match={match} />

      <MatchMapDetails match={match} />

      {/* Pas de région live : un plateau de cent vingt-sept cartes en
          annoncerait autant à chaque instantané du flux. L'annonce qui compte,
          celle du lecteur engagé, vit dans sa modale. */}
      {reportNotice && <p className={styles.reportNotice}>{reportNotice}</p>}

      <MatchCardActions
        match={match}
        phase={launchPhase}
        actions={actions}
        matchLabel={actionMatchLabel}
        isCaster={launch.isCaster}
        releasesOthers={launch.releasesOthers}
        onAir={liveState === "LIVE"}
        onPlayerScore={openPlayerScore}
        onAdminScore={() => onOpenAdminModal(match)}
        onReport={openReport}
      />

      {adminResolvable && scoreLocked && (
        <div
          className={styles.locked}
          title={actionText.t("cardActions.lockedTitle")}
        >
          <span aria-hidden="true">🔒</span>
          {actionText.t("cardActions.locked")}
          {/* Le motif n'était qu'en infobulle, qu'un bloc non focalisable ne
              montre ni au clavier ni aux lecteurs d'écran. */}
          <span className="sr-only">
            {actionText.t("cardActions.lockedReason")}
          </span>
        </div>
      )}
    </div>
  );
});
