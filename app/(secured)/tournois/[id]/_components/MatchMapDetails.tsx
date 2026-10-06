"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Copy } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { mapWinnerSide, type MatchMapResult } from "@/lib/shared/match-maps";
import type { BracketMatch } from "@/lib/shared/types";
import dialogStyles from "./ScoreDialog.module.css";
import styles from "./MatchMapDetails.module.css";

/**
 * Liste des maps d'un match ou d'une proposition (`docs/features/MAP_SCORES.md`) :
 * score de chaque map et son code de replay, copiable — c'est lui que les
 * arbitres vérifient en jeu.
 */
export function MapResultList({
  maps,
  team1Name,
  team2Name,
  label,
}: Readonly<{ maps: ReadonlyArray<MatchMapResult>; team1Name: string; team2Name: string; label: string }>) {
  const { showError, showSuccess } = useToast();
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      showSuccess(`Code de replay ${code} copié.`);
    } catch {
      showError("Copie impossible : sélectionne le code à la main.");
    }
  };

  return (
    <ol className={styles.list} aria-label={label}>
      {maps.map((map) => {
        const side = mapWinnerSide(map);
        let outcome = "Map nulle";
        if (side === 1) outcome = `Gagnée par ${team1Name}`;
        else if (side === 2) outcome = `Gagnée par ${team2Name}`;
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
  );
}

/**
 * Détail map par map d'un match tranché : un bouton sur la carte, le détail
 * dans une modale. Pas de volet déplié **dans** la carte : l'arbre dimensionne
 * chaque créneau sur la plus haute de ses cartes, si bien qu'un volet ouvert
 * faisait sauter tout le plateau. Rien sur un match sans détail (forfait,
 * exemption, match d'avant les maps).
 */
export function MatchMapDetails({ match }: Readonly<{ match: Pick<BracketMatch, "id" | "maps" | "team1Name" | "team2Name"> }>) {
  const [open, setOpen] = useState(false);
  // Le détail disparu (score corrigé à la main, forfait) ferme la modale : elle
  // ne doit pas se rouvrir d'elle-même au retour d'un détail.
  const hasMaps = match.maps.length > 0;
  useEffect(() => {
    if (!hasMaps) setOpen(false);
  }, [hasMaps]);
  if (!hasMaps) return null;
  const team1 = match.team1Name ?? "Équipe 1";
  const team2 = match.team2Name ?? "Équipe 2";

  return (
    <>
      <button type="button" className={styles.summary} onClick={() => setOpen(true)} aria-haspopup="dialog">
        Détail des maps ({match.maps.length})
      </button>
      {open && (
        <MapDetailsDialog
          matchId={match.id}
          maps={match.maps}
          team1Name={team1}
          team2Name={team2}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function MapDetailsDialog({
  matchId,
  maps,
  team1Name,
  team2Name,
  onClose,
}: Readonly<{
  matchId: number;
  maps: ReadonlyArray<MatchMapResult>;
  team1Name: string;
  team2Name: string;
  onClose: () => void;
}>) {
  const dialogRef = useDialogBehavior({ open: true, onClose });
  const backdrop = useBackdropDismiss(onClose);
  const titleId = `map-details-${matchId}-title`;

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ className={dialogStyles.backdrop} role="presentation" {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        className={dialogStyles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={dialogStyles.head}>
          <div className={dialogStyles.headText}>
            <h3 id={titleId} className={dialogStyles.title}>
              Détail des maps
            </h3>
            <p className={dialogStyles.opponents}>
              {team1Name} vs {team2Name}
            </p>
          </div>
        </div>
        <MapResultList maps={maps} team1Name={team1Name} team2Name={team2Name} label="Maps du match" />
        <div className={dialogStyles.actions}>
          <button type="button" className={`${dialogStyles.link} ${dialogStyles.close}`} onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
