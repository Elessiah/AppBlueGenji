"use client";

import type { TournamentPhaseStanding } from "@/lib/shared/types";
import { Pill } from "@/components/cyber";
import { EntrantLink, useParticipantWording } from "../_lib/entrant-link";

interface PhaseStandingsTableProps {
  standings: TournamentPhaseStanding[];
}

export function PhaseStandingsTable({ standings }: PhaseStandingsTableProps) {
  const wording = useParticipantWording();

  return (
    <div className="table-like">
      <div className="table-row table-header">
        <span>{wording.oneCapitalized}</span>
        <span>Rang</span>
        <span>Qualifiée</span>
      </div>
      {standings.map((standing) => (
        <div key={standing.teamId} className="table-row">
          <EntrantLink teamId={standing.teamId}>{standing.teamName}</EntrantLink>
          <span>{standing.rank ?? "-"}</span>
          <span>
            {standing.qualified ? (
              <Pill variant="blue" style={{ fontSize: 12 }}>
                ✓
              </Pill>
            ) : (
              "-"
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
