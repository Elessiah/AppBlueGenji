"use client";

import type { BracketMatch, EnduranceMeta } from "@/lib/shared/types";
import { useParticipantWording } from "../_lib/entrant-link";

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
 * Le gabarit par défaut de `.table-row` ne compte que quatre colonnes : sans
 * cette grille explicite, le classement (cinq cellules) repliait la dernière
 * sur une seconde ligne.
 *
 * Chaque ligne est sa propre grille : la colonne d'action doit donc être de
 * largeur **fixe**, et n'exister que si au moins une ligne porte un bouton —
 * une colonne `auto` se serait dimensionnée ligne par ligne, décalant les
 * colonnes des lignes avec bouton par rapport à toutes les autres.
 */
function rowGrid(withActions: boolean): React.CSSProperties {
  return {
    gridTemplateColumns: `44px minmax(0, 1.6fr) 1fr 1fr 1fr${withActions ? " 108px" : ""}`,
  };
}

/** Première manche de play-offs (cf. `lib/server/tournaments/bg-survie.ts`). */
const PLAYOFF_ROUND_OFFSET = 1000;

const STATUS_LABELS: Record<EnduranceMeta["standings"][number]["status"], string> = {
  ACTIVE: "En lice",
  ELIMINATED: "Éliminée",
  FORFEIT: "Forfait",
};

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
  const canForfeitRow = (teamId: number, status: string): boolean =>
    !isFinished &&
    status === "ACTIVE" &&
    canForfeit !== undefined &&
    onForfeit !== undefined &&
    canForfeit(teamId);

  const showActions = endurance.standings.some((s) => canForfeitRow(s.teamId, s.status));
  const grid = rowGrid(showActions);

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
        <div className="table-row table-header" style={grid}>
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
              className="table-row"
              style={{
                ...grid,
                alignItems: "center",
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
                          : `Déclarer l'abandon de ${standing.teamName}`
                      }
                      aria-label={
                        isMine
                          ? "Abandonner le tournoi"
                          : `Déclarer l'abandon de ${standing.teamName}`
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
                      Abandonner
                    </button>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>

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
