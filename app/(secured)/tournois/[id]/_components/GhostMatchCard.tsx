"use client";

import { memo } from "react";
import { EntrantName } from "./EntrantName";
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
 * Un nom connu reprend la couleur d'une ligne ordinaire (`.ghostKnown`) : c'est
 * la seule information de la case, elle ne se lit pas comme un `TBD`. Un côté
 * dont on sait qu'il restera vide (`topBye` / `bottomBye` : effectif impair,
 * double forfait en amont) dit `BYE`, pas `TBD` — personne n'y viendra.
 */
export const GhostMatchCard = memo(function GhostMatchCard({
  topTeamId = null,
  topTeamName = null,
  bottomTeamId = null,
  bottomTeamName = null,
  topBye = false,
  bottomBye = false,
}: Readonly<{
  topTeamId?: number | null;
  topTeamName?: string | null;
  bottomTeamId?: number | null;
  bottomTeamName?: string | null;
  topBye?: boolean;
  bottomBye?: boolean;
}>) {
  return (
    <div className={`${styles.card} ${styles.ghostCard}`}>
      <GhostSide teamId={topTeamId} name={topTeamName} bye={topBye} />
      <GhostSide teamId={bottomTeamId} name={bottomTeamName} bye={bottomBye} />
    </div>
  );
});

function GhostSide({
  teamId,
  name,
  bye,
}: Readonly<{ teamId: number | null; name: string | null; bye: boolean }>) {
  const text = useTournamentPageText();
  const known = teamId !== null;
  const emptyLabel = text.t(bye ? "match.bye" : "match.tbd");

  return (
    <div className={known ? `${styles.row} ${styles.ghostKnown}` : styles.row}>
      {/* Même passage que la carte réelle : la case d'emblème vide garde sa
          place, pour que les noms des deux cartes commencent au même
          endroit d'une colonne à l'autre. */}
      <EntrantName
        teamId={teamId}
        name={known ? name : emptyLabel}
        // Nom tronqué : l'infobulle le donne en entier, comme sur la carte réelle.
        title={known ? (name ?? undefined) : undefined}
        truncate={known}
        className={styles.name}
      />
      <strong className={styles.score}>-</strong>
    </div>
  );
}
