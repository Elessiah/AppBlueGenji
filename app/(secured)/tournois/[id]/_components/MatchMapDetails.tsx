"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { mapWinnerSide, type MatchMapResult } from "@/lib/shared/match-maps";
import type { BracketMatch } from "@/lib/shared/types";
import { matchAnchorId } from "@/lib/shared/match-anchor";
import dialogStyles from "./ScoreDialog.module.css";
import styles from "./MatchMapDetails.module.css";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { versusText } from "@/lib/shared/tournament-page-text";

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
  const { t } = useTournamentPageText();
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      showSuccess(t("match.maps.copied", { code }));
    } catch {
      showError(t("match.maps.copyFailed"));
    }
  };

  return (
    <ol className={styles.list} aria-label={label}>
      {maps.map((map) => {
        const side = mapWinnerSide(map);
        let outcome = t("match.maps.drawn");
        if (side === 1) outcome = t("match.maps.wonBy", { team: team1Name });
        else if (side === 2) outcome = t("match.maps.wonBy", { team: team2Name });
        return (
          <li key={map.mapNumber} className={styles.item}>
            <span className={styles.label}>{t("match.maps.map", { number: String(map.mapNumber) })}</span>
            <span className={styles.score} title={outcome}>
              {map.team1Score} – {map.team2Score}
              <span className="sr-only"> : {outcome}</span>
            </span>
            <code className={styles.code}>{map.replayCode}</code>
            <button
              type="button"
              className={styles.copy}
              onClick={() => void copy(map.replayCode)}
              aria-label={t("match.maps.copyLabel", { number: String(map.mapNumber) })}
              title={t("match.maps.copy")}
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
  const text = useTournamentPageText();
  const [open, setOpen] = useState(false);
  // Détail affiché tant que la modale est ouverte, même s'il disparaît de
  // l'instantané (score corrigé à la main, forfait, retour en arrière) : la
  // modale reste lisible jusqu'à ce que le lecteur la ferme.
  const shown = useRef(match.maps);
  if (match.maps.length > 0) shown.current = match.maps;
  const hasMaps = match.maps.length > 0;
  if (!hasMaps && !open) return null;
  const team1 = match.team1Name ?? text.t("match.team1");
  const team2 = match.team2Name ?? text.t("match.team2");

  const close = () => {
    setOpen(false);
    // Le bouton part avec le détail : le focus revient à la carte du match
    // (focalisable par programme), plutôt qu'au `<body>`.
    if (!hasMaps) requestAnimationFrame(() => document.getElementById(matchAnchorId(match.id))?.focus());
  };

  return (
    <>
      {hasMaps && (
        <button
          type="button"
          className={styles.summary}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={text.t("match.maps.summaryLabel", { count: String(match.maps.length), match: versusText(text, team1, team2) })}
        >
          {text.t("match.maps.summary", { count: String(match.maps.length) })}
        </button>
      )}
      {open && (
        <MapDetailsDialog
          matchId={match.id}
          maps={shown.current}
          team1Name={team1}
          team2Name={team2}
          onClose={close}
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
  const { t } = useTournamentPageText();

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
              {t("match.maps.title")}
            </h3>
            <p className={dialogStyles.opponents}>{t("match.maps.vs", { team1: team1Name, team2: team2Name })}</p>
          </div>
        </div>
        <MapResultList maps={maps} team1Name={team1Name} team2Name={team2Name} label={t("match.maps.listLabel")} />
        <div className={dialogStyles.actions}>
          <button type="button" className={`${dialogStyles.link} ${dialogStyles.close}`} onClick={onClose}>
            {t("match.maps.close")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
