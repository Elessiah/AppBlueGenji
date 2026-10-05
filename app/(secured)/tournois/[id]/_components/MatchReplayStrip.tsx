"use client";

import { canHaveReplay, visibleReplayUrl } from "@/lib/shared/match-replay";
import type { BracketMatch } from "@/lib/shared/types";
import styles from "./MatchReplayStrip.module.css";

/**
 * Bandeau « Rediff disponible » d'un match terminé, sous sa carte : tout le
 * monde le voit dès qu'une rediff est posée sur une rencontre jouée — la carte
 * entière du bandeau est le lien, pour qu'on ne puisse pas le manquer.
 *
 * Le bouton qui pose, modifie ou retire le lien (permission `live`) vit dans le
 * pied d'action de la carte (`MatchCardActions`), sous `canEditReplay`. Le lien
 * stocké n'est pas montré tel quel : `visibleReplayUrl` le tait sur un match
 * rouvert par un retour en arrière — le staff garde alors son bouton, pour
 * pouvoir retirer un lien qui ne correspondrait plus.
 */
export function MatchReplayStrip({ match }: Readonly<{ match: BracketMatch }>) {
  const replayUrl = visibleReplayUrl(match);
  if (replayUrl === null) return null;

  // Sorti de son contexte visuel, « Rediff disponible » ne dit pas de quel match
  // il s'agit : le lien porte le nom de la rencontre.
  const matchLabel = `${match.team1Name ?? "TBD"} contre ${match.team2Name ?? "TBD"}`;

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
        {/* NOSONAR S6772 — lien en flex avec `gap` */}
        Rediff disponible
      </a>
    </div>
  );
}

/** Le lecteur (permission `live`) peut-il poser, modifier ou retirer la rediff ? */
export function canEditReplay(match: BracketMatch, canManage: boolean): boolean {
  return canManage && (canHaveReplay(match) || match.replayUrl !== null);
}
