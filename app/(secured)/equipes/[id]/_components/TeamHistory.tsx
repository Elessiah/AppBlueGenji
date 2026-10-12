"use client";

import type { TeamHistoryRow } from "@/lib/shared/types";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { richNodes } from "@/components/i18n/shell-text";
import { useTeamPageText } from "@/components/i18n/team-page-text";
import { localizedFinalRank } from "../_lib/team-history";
import styles from "../team.module.css";

const HISTORY_STATES = ["UPCOMING", "REGISTRATION", "RUNNING", "FINISHED"] as const;

/** État d'un tournoi dans la langue de la page ; un code inconnu reste tel quel. */
function historyStateLabel(text: ReturnType<typeof useTeamPageText>, state: string): string {
  const known = HISTORY_STATES.find((code) => code === state);
  return known ? text.t(`history.state.${known}`) : state;
}

/**
 * Historique des tournois de l'équipe.
 *
 * Il affichait l'état brut du tournoi (`FINISHED`), un bilan en anglais
 * (« 3W / 1L ») sous un en-tête « Rank », et rien du tout — pas même une
 * phrase — quand l'équipe n'avait encore joué aucun tournoi.
 */
export function TeamHistory({ tournaments }: Readonly<{ tournaments: TeamHistoryRow[] }>) {
  const text = useTeamPageText();
  const { t } = text;
  return (
    <section className={`ds-block ${styles.block}`} aria-labelledby="team-history-title">
      <div className="ds-section-title purple">
        <h2 id="team-history-title">{t("history.title")}</h2>
      </div>
      {tournaments.length === 0 ? (
        <p className={styles.empty}>{t("history.empty")}</p>
      ) : (
        <div className={styles.roster} role="table" aria-label={t("history.title")}>
          <div role="rowgroup">
            <div role="row" className={`${styles.historyRow} ${styles.rosterHeader}`}>
              <span role="columnheader">{t("history.column.tournament")}</span>
              <span role="columnheader">{t("history.column.state")}</span>
              <span role="columnheader">{t("history.column.record")}</span>
              <span role="columnheader">{t("history.column.rank")}</span>
            </div>
          </div>
          <div role="rowgroup">
            {tournaments.map((entry) => (
              <div role="row" className={styles.historyRow} key={`${entry.tournamentId}-${entry.playedAt}`}>
                <span role="cell">
                  <LocaleLink href={`/tournois/${entry.tournamentId}`} className="entity-link">
                    {entry.tournamentName}
                  </LocaleLink>
                </span>
                <span role="cell" className={styles.joinedAt}>
                  {historyStateLabel(text, entry.state)}
                </span>
                <span role="cell">
                  <span className={styles.cellLabel}>{t("history.recordLabel")}</span>{" "}
                  {richNodes(
                    text.rich("history.record", { wins: entry.wins, losses: entry.losses }, {
                      loss: (chunks) => <span className="result-loss">{chunks}</span>,
                    }),
                  )}
                </span>
                <span role="cell">
                  <span className={styles.cellLabel}>{t("history.rankLabel")}</span>{" "}
                  {localizedFinalRank(text, entry.finalRank)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
