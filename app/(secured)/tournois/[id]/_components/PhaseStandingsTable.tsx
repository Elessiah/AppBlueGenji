"use client";

import type { TournamentPhaseStanding } from "@/lib/shared/types";
import { Pill } from "@/components/cyber";
import { useEntrantParticipantType } from "../_lib/entrant-link";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { participantText } from "@/lib/shared/tournament-page-text";
import { EntrantName } from "./EntrantName";

interface PhaseStandingsTableProps {
  standings: TournamentPhaseStanding[];
}

export function PhaseStandingsTable({ standings }: Readonly<PhaseStandingsTableProps>) {
  const text = useTournamentPageText();
  const { t } = text;
  const participantType = useEntrantParticipantType();
  const rank = t("phases.rank");
  const qualified = t("phases.qualified");

  return (
    <div className="table-like">
      <div className="table-row table-header">
        <span>{participantText(text, participantType, "oneCapitalized")}</span>
        <span>{rank}</span>
        <span>{qualified}</span>
      </div>
      {standings.map((standing) => (
        <div key={standing.teamId} className="table-row">
          <EntrantName
            teamId={standing.teamId}
            name={standing.teamName}
            textStyle={{ overflowWrap: "anywhere" }}
          />
          <span data-label={rank}>{standing.rank ?? "-"}</span>
          <span data-label={qualified}>
            {standing.qualified ? (
              <Pill variant="success" style={{ fontSize: 12 }}>
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
