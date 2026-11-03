"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import type { BracketMatch } from "@/lib/shared/types";
import { matchAnchorId } from "@/lib/shared/match-anchor";
import { orReload } from "@/lib/shared/lazy-component";
import styles from "./MatchMapDetails.module.css";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { versusText } from "@/lib/shared/tournament-page-text";

/**
 * La modale (`createPortal`, `useDialogBehavior({ open: true, onClose })`) vit
 * dans `./MapDetailsDialog`, chargée au premier clic : seul le bouton résumé
 * part avec la carte du match. `orReload` : un fichier disparu (déploiement
 * survenu depuis l'ouverture) recharge la page plutôt que de la casser.
 */
const MapDetailsDialog = dynamic(() => orReload(import("./MapDetailsDialog").then((m) => m.MapDetailsDialog)), {
  ssr: false,
});

/**
 * Détail map par map d'un match tranché : un bouton sur la carte, le détail
 * dans une modale. Pas de volet déplié **dans** la carte : l'arbre dimensionne
 * chaque créneau sur la plus haute de ses cartes, si bien qu'un volet ouvert
 * faisait sauter tout le plateau. Rien sur un match sans détail (forfait,
 * exemption).
 */
export function MatchMapDetails({ match }: Readonly<{ match: Pick<BracketMatch, "id" | "maps" | "team1Name" | "team2Name"> }>) {
  const text = useTournamentPageText();
  const [open, setOpen] = useState(false);
  // Détail affiché tant que la modale est ouverte, même s'il disparaît de
  // l'instantané (forfait, retour en arrière) : la
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
