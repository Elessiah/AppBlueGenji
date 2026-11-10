"use client";

import { memo } from "react";
import { EntrantName, useShownEntrantName } from "./EntrantName";
import styles from "./MatchRow.module.css";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";

/**
 * Créneau d'un tour **à venir** de l'arbre final.
 *
 * L'arbre de BlueGenji Survie pousse un tour à la fois : le moteur ne crée les
 * demi-finales qu'une fois les quarts joués. Dessiner les seuls tours posés
 * réduisait l'arbre à sa première colonne — on lisait quatre quarts de finale
 * sans voir où ils menaient, alors que la forme du tableau est connue d'avance
 * (`endurancePlayoffGhostSlots`).
 *
 * La carte dit donc la **place** d'une rencontre qui n'existe pas encore, et
 * rien de plus : deux lignes `TBD`, exactement ce qu'un tableau à élimination
 * simple affiche pour un tour à venir (`matchSideViews`). Pas d'ancre
 * `#match-…` — elle n'a pas d'identifiant public —, pas d'action, rien à
 * arbitrer ni à planifier : il n'y a encore personne à y faire jouer.
 *
 * Le gabarit est celui de `MatchRow`, dont elle emprunte les styles : la
 * largeur d'une carte est celle de la colonne de `BracketTree`, qui trace ses
 * connecteurs dessus.
 *
 * **Mémorisée**, comme `MatchRow` et pour la même raison : l'instantané du flux
 * garde la référence des matchs qu'il n'a pas changés, si bien qu'un « Prêt »
 * ne redessine qu'une carte. Un composant nu aurait rejoué **toutes** les cases
 * à pourvoir de l'arbre à chaque instantané — sur un plateau de trente-deux
 * qualifiées, quinze cartes vides pour une rencontre touchée. Elle ne prend
 * que des primitives pour props : la mémorisation reste donc totale.
 *
 * **Vainqueur déjà connu** (PLAYOFF-PROJECTED-WINNER) : quand une rencontre du
 * tour précédent est close, son vainqueur occupe son côté de la case (nom
 * cliquable, comme partout dans l'arbre) au lieu de `TBD`, sans attendre que le
 * moteur pose le tour. Affichage seul : la case reste sans action ni ancre.
 */
export const GhostMatchCard = memo(function GhostMatchCard({
  topTeamId = null,
  topTeamName = null,
  bottomTeamId = null,
  bottomTeamName = null,
}: Readonly<{
  topTeamId?: number | null;
  topTeamName?: string | null;
  bottomTeamId?: number | null;
  bottomTeamName?: string | null;
}>) {
  return (
    <div className={`${styles.card} ${styles.ghostCard}`}>
      <GhostSide teamId={topTeamId} name={topTeamName} />
      <GhostSide teamId={bottomTeamId} name={bottomTeamName} />
    </div>
  );
});

function GhostSide({ teamId, name }: Readonly<{ teamId: number | null; name: string | null }>) {
  const text = useTournamentPageText();
  const shown = useShownEntrantName(teamId, name);

  return (
    <div className={styles.row}>
      {/* Même passage que la carte réelle : la case d'emblème vide garde sa
          place, pour que les noms des deux cartes commencent au même
          endroit d'une colonne à l'autre. */}
      <EntrantName
        teamId={teamId}
        name={teamId === null ? text.t("match.tbd") : (shown ?? "")}
        truncate={teamId !== null}
        className={styles.name}
      />
      <strong className={styles.score}>-</strong>
    </div>
  );
}
