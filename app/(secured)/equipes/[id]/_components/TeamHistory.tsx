import Link from "next/link";
import type { TeamHistoryRow } from "@/lib/shared/types";
import { STATE_META } from "@/app/(secured)/tournois/[id]/_lib/header-meta";
import { formatFinalRank } from "../_lib/team-history";
import styles from "../team.module.css";

/**
 * Historique des tournois de l'équipe.
 *
 * Il affichait l'état brut du tournoi (`FINISHED`), un bilan en anglais
 * (« 3W / 1L ») sous un en-tête « Rank », et rien du tout — pas même une
 * phrase — quand l'équipe n'avait encore joué aucun tournoi.
 */
export function TeamHistory({ tournaments }: { tournaments: TeamHistoryRow[] }) {
  return (
    <section className={`ds-block ${styles.block}`} aria-labelledby="team-history-title">
      <div className="ds-section-title orange">
        <h2 id="team-history-title">Historique des tournois</h2>
      </div>
      {tournaments.length === 0 ? (
        <p className={styles.empty}>Aucun tournoi disputé pour l&apos;instant.</p>
      ) : (
        <div className={styles.roster} role="table" aria-label="Historique des tournois">
          <div role="rowgroup">
            <div role="row" className={`${styles.historyRow} ${styles.rosterHeader}`}>
              <span role="columnheader">Tournoi</span>
              <span role="columnheader">État</span>
              <span role="columnheader">Bilan</span>
              <span role="columnheader">Place</span>
            </div>
          </div>
          <div role="rowgroup">
            {tournaments.map((entry) => (
              <div role="row" className={styles.historyRow} key={`${entry.tournamentId}-${entry.playedAt}`}>
                <span role="cell">
                  <Link href={`/tournois/${entry.tournamentId}`} className="entity-link">
                    {entry.tournamentName}
                  </Link>
                </span>
                <span role="cell" className={styles.joinedAt}>
                  {STATE_META[entry.state]?.label ?? entry.state}
                </span>
                <span role="cell">
                  <span className={styles.cellLabel}>Bilan </span>
                  {entry.wins} V – {entry.losses} D
                </span>
                <span role="cell">
                  <span className={styles.cellLabel}>Place </span>
                  {formatFinalRank(entry.finalRank)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
