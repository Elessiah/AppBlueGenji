"use client";

import { Copy } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { mapWinnerSide } from "@/lib/shared/match-maps";
import type { BracketMatch } from "@/lib/shared/types";
import styles from "./MatchMapDetails.module.css";

/**
 * Détail map par map d'un match tranché (`docs/features/MAP_SCORES.md`) :
 * score de chaque map et son code de replay, copiable — c'est lui que les
 * arbitres vérifient en jeu. Replié par défaut : la carte reste lisible sur un
 * plateau de cent matchs. Rien sur un match sans détail (forfait, exemption,
 * match d'avant les maps).
 */
export function MatchMapDetails({ match }: Readonly<{ match: Pick<BracketMatch, "id" | "maps" | "team1Name" | "team2Name"> }>) {
  const { showError, showSuccess } = useToast();
  if (match.maps.length === 0) return null;
  const team1 = match.team1Name ?? "Équipe 1";
  const team2 = match.team2Name ?? "Équipe 2";

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      showSuccess(`Code de replay ${code} copié.`);
    } catch {
      showError("Copie impossible : sélectionne le code à la main.");
    }
  };

  return (
    <details className={styles.details}>
      <summary className={styles.summary}>
        Détail des maps ({match.maps.length})
      </summary>
      <ol className={styles.list}>
        {match.maps.map((map) => {
          const side = mapWinnerSide(map);
          let outcome = "Map nulle";
          if (side === 1) outcome = `Gagnée par ${team1}`;
          else if (side === 2) outcome = `Gagnée par ${team2}`;
          return (
            <li key={map.mapNumber} className={styles.item}>
              <span className={styles.label}>Map {map.mapNumber}</span>
              <span className={styles.score} title={outcome}>
                {map.team1Score} – {map.team2Score}
                <span className="sr-only"> : {outcome}</span>
              </span>
              <code className={styles.code}>{map.replayCode}</code>
              <button
                type="button"
                className={styles.copy}
                onClick={() => void copy(map.replayCode)}
                aria-label={`Copier le code de replay de la map ${map.mapNumber}`}
                title="Copier le code de replay"
              >
                <Copy size={14} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
