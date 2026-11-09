"use client";

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
 */
export function GhostMatchCard() {
  const text = useTournamentPageText();
  const tbd = text.t("match.tbd");

  return (
    <div className={`${styles.card} ${styles.ghostCard}`}>
      {[1, 2].map((side) => (
        <div key={side} className={styles.row}>
          {/* Même passage que la carte réelle : la case d'emblème vide garde sa
              place, pour que les noms des deux cartes commencent au même
              endroit d'une colonne à l'autre. */}
          <EntrantName teamId={null} name={tbd} className={styles.name} />
          <strong className={styles.score}>-</strong>
        </div>
      ))}
    </div>
  );
}
