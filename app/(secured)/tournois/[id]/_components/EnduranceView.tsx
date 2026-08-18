"use client";

import type { BracketMatch, EnduranceMeta } from "@/lib/shared/types";

interface EnduranceViewProps {
  endurance: EnduranceMeta;
  matches: BracketMatch[];
  renderMatch: (match: BracketMatch) => React.ReactNode;
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
export function EnduranceView({ endurance, matches, renderMatch }: EnduranceViewProps) {
  const qualification = matches.filter((match) => match.roundNumber < PLAYOFF_ROUND_OFFSET);
  const playoffs = matches.filter((match) => match.roundNumber >= PLAYOFF_ROUND_OFFSET);
  const visible = endurance.playoffsStarted ? playoffs : qualification;

  const rounds = [...new Set(visible.map((match) => match.roundNumber))].sort((a, b) => b - a);
  const activeCount = endurance.standings.filter((s) => s.status === "ACTIVE").length;

  return (
    <>
      <p className="mono" style={{ fontSize: 11, color: "var(--text-2)", margin: "0 0 16px" }}>
        ENDURANCE {endurance.startPoints} PTS · +{endurance.winDelta} PAR VICTOIRE · −
        {endurance.lossDelta} PAR DÉFAITE ·{" "}
        {endurance.playoffsStarted
          ? `PLAY-OFFS À ${endurance.playoffSize}`
          : `MANCHE ${endurance.currentRound} · ${activeCount} ÉQUIPES EN LICE → ${endurance.playoffSize}`}
      </p>

      <div className="table-like" style={{ marginBottom: 24 }}>
        <div className="table-row table-header">
          <span>#</span>
          <span>Équipe</span>
          <span>Endurance</span>
          <span>V / D</span>
          <span>Statut</span>
        </div>
        {endurance.standings.map((standing) => (
          <div
            key={standing.teamId}
            className="table-row"
            style={{ opacity: standing.status === "ACTIVE" ? 1 : 0.55 }}
          >
            <span className="num">{standing.rank}</span>
            <span>{standing.teamName}</span>
            <span className="num">{standing.points}</span>
            <span>
              {standing.wins} / {standing.losses}
            </span>
            <span>
              {STATUS_LABELS[standing.status]}
              {standing.eliminatedRound ? ` (M${standing.eliminatedRound})` : ""}
            </span>
          </div>
        ))}
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
