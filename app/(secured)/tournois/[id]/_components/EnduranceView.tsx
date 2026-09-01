"use client";

import { ScrollArea } from "@/components/cyber";
import type { BracketMatch, EnduranceMeta } from "@/lib/shared/types";
import {
  enduranceCellLabel,
  enduranceCellTitle,
  enduranceCellTone,
  enduranceHistoryColumns,
  type EnduranceCellTone,
} from "../_lib/endurance-history";
import { useParticipantWording } from "../_lib/entrant-link";
import styles from "./EnduranceView.module.css";

interface EnduranceViewProps {
  endurance: EnduranceMeta;
  matches: BracketMatch[];
  renderMatch: (match: BracketMatch) => React.ReactNode;
  /** Le tournoi est-il clos ? (plus aucun abandon possible) */
  isFinished?: boolean;
  /** Engagé du lecteur, mis en avant dans le classement. */
  myTeamId?: number | null;
  /** L'abandon est-il proposé pour cette équipe ? (cf. `_lib/forfeit.ts`) */
  canForfeit?: (teamId: number) => boolean;
  onForfeit?: (teamId: number, teamName: string) => void;
}

const AMBER = "rgba(255,157,46,0.9)";

/**
 * Classe de gabarit du classement (cf. `EnduranceView.module.css`) : cinq
 * colonnes, six quand au moins une ligne porte un bouton d'abandon. Le gabarit
 * est une classe et non un style en ligne, sans quoi il l'emporterait sur le
 * repli mobile de `.table-row`.
 */
function rowClass(withActions: boolean): string {
  return `table-row ${withActions ? styles.rowWithActions : styles.row}`;
}

/** Première manche de play-offs (cf. `lib/server/tournaments/bg-survie.ts`). */
const PLAYOFF_ROUND_OFFSET = 1000;

const STATUS_LABELS: Record<EnduranceMeta["standings"][number]["status"], string> = {
  ACTIVE: "En lice",
  ELIMINATED: "Éliminée",
  FORFEIT: "Forfait",
};

/** Habillage d'une case, selon le poids décidé par `_lib/endurance-history`. */
const CELL_CLASS: Record<EnduranceCellTone, string> = {
  POINTS: "num",
  ZERO: `num ${styles.historyZero}`,
  FORFEIT: styles.historyForfeit,
  OUT: styles.historyOut,
};

/**
 * Tableau du capital d'endurance **manche par manche**, comme la feuille de
 * calcul qui tient le règlement : une ligne par équipe, une colonne par manche.
 *
 * C'est le seul endroit où un forfait de tournoi se lit d'un coup d'œil : la
 * colonne « Statut » du classement dit qu'une équipe est partie, elle ne dit pas
 * **à partir de quand** — ici, ses manches restantes portent « FF » en rouge au
 * lieu d'un capital, et le tableau se lit comme le document d'arbitrage.
 *
 * Défilement horizontal plutôt que repli mobile : un tableau de capitaux empilé
 * en colonne ne se compare plus.
 */
function EnduranceHistory({
  endurance,
  myTeamId,
}: {
  endurance: EnduranceMeta;
  myTeamId: number | null;
}) {
  if (endurance.rounds.length === 0) return null;

  const columns = enduranceHistoryColumns(endurance.rounds.length);

  return (
    <div style={{ marginBottom: 24 }}>
      <div className="mono" style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 8 }}>
        ENDURANCE MANCHE PAR MANCHE
      </div>
      <ScrollArea fade ariaLabel="Capital d'endurance manche par manche">
        <div className="table-like">
          <div
            className={`${styles.historyRow} ${styles.historyHead}`}
            style={{ "--history-cols": columns } as React.CSSProperties}
          >
            <span className={styles.historyTeam}>Équipe</span>
            {endurance.rounds.map((round) => (
              <span key={round} className={styles.historyCell} title={`Manche ${round}`}>
                M{round}
              </span>
            ))}
          </div>
          {endurance.standings.map((standing) => (
            <div
              key={standing.teamId}
              className={[
                styles.historyRow,
                standing.status === "FORFEIT" ? styles.historyRowForfeit : null,
                myTeamId !== null && standing.teamId === myTeamId ? styles.historyRowMine : null,
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ "--history-cols": columns } as React.CSSProperties}
            >
              <span className={styles.historyTeam}>{standing.teamName}</span>
              {standing.rounds.map((cell) => (
                <span
                  key={cell.round}
                  className={`${styles.historyCell} ${CELL_CLASS[enduranceCellTone(cell)]}`}
                  title={enduranceCellTitle(standing.teamName, cell)}
                >
                  {enduranceCellLabel(cell)}
                </span>
              ))}
            </div>
          ))}
        </div>
      </ScrollArea>
      {/* Une case rouge n'est lisible qu'accompagnée de ce qu'elle veut dire :
          la légende n'apparaît que s'il y a effectivement un forfait à lire. */}
      {endurance.standings.some((standing) => standing.status === "FORFEIT") && (
        <p className="mono" style={{ fontSize: 10, color: "var(--text-2)", margin: "8px 0 0" }}>
          FF = FORFAIT SUR TOUT LE RESTE DU TOURNOI
        </p>
      )}
    </div>
  );
}

/**
 * Vue du mode « BlueGenji Survie » : capital d'endurance de chaque équipe, puis
 * les matchs de la manche courante — ou de l'arbre final une fois les play-offs
 * lancés.
 */
export function EnduranceView({
  endurance,
  matches,
  renderMatch,
  isFinished = false,
  myTeamId = null,
  canForfeit,
  onForfeit,
}: EnduranceViewProps) {
  const wording = useParticipantWording();
  const qualification = matches.filter((match) => match.roundNumber < PLAYOFF_ROUND_OFFSET);
  const playoffs = matches.filter((match) => match.roundNumber >= PLAYOFF_ROUND_OFFSET);
  const visible = endurance.playoffsStarted ? playoffs : qualification;

  const rounds = [...new Set(visible.map((match) => match.roundNumber))].sort((a, b) => b - a);
  const activeCount = endurance.standings.filter((s) => s.status === "ACTIVE").length;

  // Abandon : proposé sur les équipes encore en lice, à leurs représentants
  // comme à l'arbitrage (cf. `canForfeit` côté page).
  //
  // **Pas pendant les play-offs.** `forfeitEnduranceTeam` ne sait clore qu'un
  // match de la manche qualificative courante (`endurance_current_round`) ;
  // l'arbre final vit à partir de `PLAYOFF_ROUND_OFFSET`, hors de sa portée. Un
  // abandon y laisserait l'équipe déclarée forfait au classement mais toujours
  // engagée dans un match ouvert — que rien ne viendrait jamais clore. Un
  // forfait de play-off se tranche sur le match lui-même, par l'arbitrage, qui
  // fait alors avancer l'arbre. Même refus côté serveur.
  const canForfeitRow = (teamId: number, status: string): boolean =>
    !isFinished &&
    !endurance.playoffsStarted &&
    status === "ACTIVE" &&
    canForfeit !== undefined &&
    onForfeit !== undefined &&
    canForfeit(teamId);

  const showActions = endurance.standings.some((s) => canForfeitRow(s.teamId, s.status));
  const rowClassName = rowClass(showActions);

  return (
    <>
      {/*
        Le barème se compte map par map : « par victoire » laissait lire un
        point par match gagné, alors qu'un 3-0 en déplace trois — et c'est ce
        même compte qui chiffre un forfait.
      */}
      <p className="mono" style={{ fontSize: 11, color: "var(--text-2)", margin: "0 0 16px" }}>
        ENDURANCE {endurance.startPoints} PTS · +{endurance.winDelta} PAR MAP GAGNÉE · −
        {endurance.lossDelta} PAR MAP PERDUE · FORFAIT COMPTÉ {endurance.forfeitMaps}-0 ·{" "}
        {endurance.playoffsStarted
          ? `PLAY-OFFS À ${endurance.playoffSize}`
          : `MANCHE ${endurance.currentRound} · ${activeCount} ${wording.manyCapitalized.toUpperCase()} EN LICE → ${endurance.playoffSize}`}
      </p>

      <div className="table-like" style={{ marginBottom: 24 }}>
        <div className={`${rowClassName} table-header`}>
          <span>#</span>
          <span>{wording.oneCapitalized}</span>
          <span>Endurance</span>
          <span>V / D</span>
          <span>Statut</span>
          {showActions && <span className="sr-only">Actions</span>}
        </div>
        {endurance.standings.map((standing) => {
          const isMine = myTeamId !== null && standing.teamId === myTeamId;
          const forfeitable = canForfeitRow(standing.teamId, standing.status);

          return (
            <div
              key={standing.teamId}
              className={rowClassName}
              style={{
                opacity: standing.status === "ACTIVE" ? 1 : 0.55,
                background: isMine ? "rgba(89,212,255,0.06)" : undefined,
              }}
            >
              <span className="num">{standing.rank}</span>
              <span style={{ fontWeight: isMine ? 700 : undefined }}>{standing.teamName}</span>
              <span className="num">{standing.points}</span>
              <span>
                {standing.wins} / {standing.losses}
              </span>
              <span>
                {STATUS_LABELS[standing.status]}
                {standing.eliminatedRound ? ` (M${standing.eliminatedRound})` : ""}
              </span>
              {showActions && (
                <span>
                  {forfeitable && onForfeit !== undefined && (
                    <button
                      type="button"
                      onClick={() => onForfeit(standing.teamId, standing.teamName)}
                      className="btn"
                      title={
                        isMine
                          ? `Abandonner : ${wording.subject} quittera définitivement le tournoi`
                          : `Déclarer ${standing.teamName} forfait pour tout le reste du tournoi`
                      }
                      aria-label={
                        isMine
                          ? "Abandonner le tournoi"
                          : `Déclarer ${standing.teamName} forfait pour tout le reste du tournoi`
                      }
                      style={{
                        padding: "3px 8px",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        background: "rgba(255,157,46,0.12)",
                        borderColor: "rgba(255,157,46,0.4)",
                        color: AMBER,
                      }}
                    >
                      {/*
                        Deux gestes différents sous un même bouton : le lecteur
                        qui quitte le tournoi « abandonne », l'arbitrage, lui,
                        « déclare forfait » une équipe — pour tout le reste du
                        tournoi, et non sur la seule manche en cours (ce
                        forfait-là se pose sur le match).
                      */}
                      {isMine ? "Abandonner" : "Forfait"}
                    </button>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <EnduranceHistory endurance={endurance} myTeamId={myTeamId} />

      {rounds.map((round) => (
        <div key={round} style={{ marginBottom: 20 }}>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 8 }}>
            {round >= PLAYOFF_ROUND_OFFSET
              ? `PLAY-OFFS · TOUR ${round - PLAYOFF_ROUND_OFFSET + 1}`
              : `MANCHE ${round}`}
          </div>
          {visible
            .filter((match) => match.roundNumber === round)
            .map((match) => renderMatch(match))}
        </div>
      ))}
    </>
  );
}
