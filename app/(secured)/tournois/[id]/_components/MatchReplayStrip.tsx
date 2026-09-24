"use client";

import { canHaveReplay, visibleReplayUrl } from "@/lib/shared/match-replay";
import type { BracketMatch } from "@/lib/shared/types";
import { useLiveControls } from "../_lib/live-context";
import styles from "./MatchReplayStrip.module.css";

/**
 * Bandeau « Rediff disponible » d'un match terminé, sous sa carte.
 *
 * Deux publics :
 * - **tout le monde** voit le bandeau dès qu'une rediff est posée sur une
 *   rencontre jouée — la carte entière du bandeau est le lien, pour qu'on ne
 *   puisse pas le manquer ;
 * - la permission `live` (admin, arbitre, caster) y trouve en plus le bouton
 *   qui pose, modifie ou retire le lien.
 *
 * Le lien stocké n'est pas montré tel quel : `visibleReplayUrl` le tait sur un
 * match rouvert par un retour en arrière. Le staff garde alors son bouton, pour
 * pouvoir retirer un lien qui ne correspondrait plus.
 */
export function MatchReplayStrip({ match }: { match: BracketMatch }) {
  const { canManage, openReplay } = useLiveControls();

  const replayUrl = visibleReplayUrl(match);
  const showEdit = canManage && (canHaveReplay(match) || match.replayUrl !== null);
  if (replayUrl === null && !showEdit) return null;

  // Sorti de son contexte visuel, « Rediff disponible » ne dit pas de quel match
  // il s'agit : chaque contrôle porte le nom de la rencontre.
  const matchLabel = `${match.team1Name ?? "TBD"} contre ${match.team2Name ?? "TBD"}`;

  // À côté du bandeau, le bouton se réduit à son pictogramme : la carte fait
  // 210 px, et un libellé complet repliait « Rediff disponible » sur deux
  // lignes. Le nom accessible, lui, reste complet.
  const compact = replayUrl !== null;
  const editButton = showEdit && (
    <button
      type="button"
      className={`btn ghost ${styles.edit}`}
      onClick={() => openReplay(match)}
      title={compact ? "Modifier la rediff" : undefined}
      aria-label={
        match.replayUrl === null
          ? `Ajouter la rediff de ${matchLabel}`
          : `Modifier la rediff de ${matchLabel}`
      }
    >
      {compact ? "✎" : match.replayUrl === null ? "＋ Rediff" : "✎ Rediff"}
    </button>
  );

  if (replayUrl === null) {
    return <div className={styles.staffOnly}>{editButton}</div>;
  }

  return (
    <div className={styles.banner}>
      <a
        href={replayUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.link}
        // Commence par le texte visible (WCAG 2.5.3) : la commande vocale
        // « cliquer sur Rediff disponible » doit trouver ce lien.
        aria-label={`Rediff disponible — revoir ${matchLabel} sur YouTube (nouvel onglet)`}
      >
        <span aria-hidden="true" className={styles.icon}>
          ▶
        </span>
        Rediff disponible
      </a>
      {editButton}
    </div>
  );
}
