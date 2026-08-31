"use client";

import Link from "next/link";
import { FormEvent } from "react";
import type { BracketMatch, TournamentFormat } from "@/lib/shared/types";
import { fromBracketMatch, isScoreEditLocked } from "@/lib/shared/match-lock";
import { matchFormatLabel, matchWinsRequired } from "@/lib/shared/match-format";
import { useEntrantLink } from "../_lib/entrant-link";
import { useMatchFormat } from "../_lib/match-format-context";
import { useIssueReport } from "../_lib/issue-report-context";
import { MatchLiveStrip } from "./MatchLiveStrip";

const CARD_W = 210;
const BORDER = "var(--border, #444)";

interface MatchRowProps {
  match: BracketMatch;
  reportable: boolean;
  adminResolvable: boolean;
  onScoreChange: (matchId: number, field: "myScore" | "opponentScore", value: string) => void;
  myScore: string;
  opponentScore: string;
  onSubmit: (match: BracketMatch, e: FormEvent) => Promise<void>;
  onOpenAdminModal: (match: BracketMatch) => void;
  allMatches: BracketMatch[];
  roundNumber: number;
  format: TournamentFormat;
}

export function MatchRow({
  match,
  reportable,
  adminResolvable,
  onScoreChange,
  myScore,
  opponentScore,
  onSubmit,
  onOpenAdminModal,
  allMatches,
  roundNumber,
  format,
}: MatchRowProps) {
  const entrantLink = useEntrantLink();
  // Format du tournoi (BO5, FT3…) : rappelé au-dessus des champs et appliqué
  // comme borne haute, pour que la saisie ne parte pas hors format.
  const matchFormat = useMatchFormat();
  // Signalement : réservé aux engagés du tournoi, et seulement sur une manche
  // dont les deux adversaires sont connus — il n'y a rien à arbitrer sur une
  // case encore vide.
  const { canReport, openReport } = useIssueReport();
  const canReportMatch =
    canReport && match.team1Id !== null && match.team2Id !== null;
  const maxScore = matchFormat ? matchWinsRequired(matchFormat) : 99;

  const team1Win = match.winnerTeamId !== null && match.winnerTeamId === match.team1Id;
  const team2Win = match.winnerTeamId !== null && match.winnerTeamId === match.team2Id;
  const hasWinner = match.winnerTeamId !== null;

  // Même règle que le garde-fou serveur (`lib/shared/match-lock.ts`) : le score
  // n'est plus éditable dès que la manche suivante porte une saisie.
  const scoreLocked = isScoreEditLocked(
    fromBracketMatch(match),
    allMatches.map(fromBracketMatch),
    format,
  );

  const rowStyle = (win: boolean): React.CSSProperties => ({
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "5px 8px",
    background: win ? "rgba(79,224,162,0.15)" : hasWinner ? "rgba(255,255,255,0.03)" : undefined,
    color: win ? "var(--text-0)" : hasWinner ? "var(--text-2)" : "var(--text-1)",
    fontWeight: win ? 600 : 400,
  });

  const team1Display = match.team1Name || match.team1Placeholder || (roundNumber === 1 && match.team1Id === null && match.team2Id !== null ? "BYE" : "TBD");
  const team2Display = match.team2Name || match.team2Placeholder || (roundNumber === 1 && match.team2Id === null && match.team1Id !== null ? "BYE" : "TBD");

  const isBye = match.team1Id === null || match.team2Id === null;
  const team1Score = !isBye && match.status === "COMPLETED" && match.forfeitTeamId === match.team1Id ? "FF" : (match.team1Score ?? "-");
  const team2Score = !isBye && match.status === "COMPLETED" && match.forfeitTeamId === match.team2Id ? "FF" : (match.team2Score ?? "-");

  return (
    <div
      style={{
        width: CARD_W,
        background: "var(--surface-1)",
        border: `1px solid ${adminResolvable ? "rgba(89,212,255,0.4)" : BORDER}`,
        borderRadius: 6,
        overflow: "hidden",
        fontSize: 13,
      }}
    >
      <div style={{ ...rowStyle(team1Win), borderBottom: `1px solid ${BORDER}` }}>
        {match.team1Id ? (
          <Link
            href={entrantLink(match.team1Id)}
            style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, display: "block", textDecoration: "none", color: "inherit" }}
          >
            {team1Display}
          </Link>
        ) : (
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {team1Display}
          </span>
        )}
        <strong style={{ marginLeft: 8, color: team1Win ? "var(--green)" : match.forfeitTeamId === match.team1Id ? "rgba(255,157,46,0.9)" : "var(--text-2)" }}>
          {team1Score}
        </strong>
      </div>
      <div style={rowStyle(team2Win)}>
        {match.team2Id ? (
          <Link
            href={entrantLink(match.team2Id)}
            style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, display: "block", textDecoration: "none", color: "inherit" }}
          >
            {team2Display}
          </Link>
        ) : (
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {team2Display}
          </span>
        )}
        <strong style={{ marginLeft: 8, color: team2Win ? "var(--green)" : match.forfeitTeamId === match.team2Id ? "rgba(255,157,46,0.9)" : "var(--text-2)" }}>
          {team2Score}
        </strong>
      </div>

      <MatchLiveStrip match={match} />

      {reportable && (
        <form
          onSubmit={(e) => onSubmit(match, e)}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            padding: "5px 6px",
            background: "rgba(79,224,162,0.06)",
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          {matchFormat && (
            <p
              style={{
                width: "100%",
                margin: 0,
                fontSize: 10,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-2)",
              }}
            >
              {matchFormatLabel(matchFormat)} · premier à {maxScore}
            </p>
          )}
          <input
            type="number"
            min={0}
            max={maxScore}
            placeholder="Moi"
            aria-label="Mon score"
            value={myScore}
            onChange={(e) => onScoreChange(match.id, "myScore", e.target.value)}
            style={{ width: 52, fontSize: 12 }}
          />
          <input
            type="number"
            min={0}
            max={maxScore}
            placeholder="Eux"
            aria-label="Score adverse"
            value={opponentScore}
            onChange={(e) => onScoreChange(match.id, "opponentScore", e.target.value)}
            style={{ width: 52, fontSize: 12 }}
          />
          <button className="btn" type="submit" style={{ padding: "3px 10px", fontSize: 12 }}>
            ✓
          </button>
        </form>
      )}

      {adminResolvable && !scoreLocked && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "5px 6px",
            background: "rgba(89,212,255,0.08)",
            borderTop: `1px solid rgba(89,212,255,0.25)`,
          }}
        >
          <button
            type="button"
            onClick={() => onOpenAdminModal(match)}
            className="btn"
            style={{ padding: "4px 12px", fontSize: 12, background: "rgba(89,212,255,0.15)", borderColor: "rgba(89,212,255,0.4)" }}
          >
            ✎ Éditer le score
          </button>
        </div>
      )}

      {canReportMatch && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "4px 6px",
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          <button
            type="button"
            onClick={() => openReport(match)}
            className="btn ghost"
            title="Prévenir le staff d'un problème sur ce match"
            style={{ padding: "3px 10px", fontSize: 11 }}
          >
            ⚠ Signaler un problème
          </button>
        </div>
      )}

      {adminResolvable && scoreLocked && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "5px 6px",
            borderTop: `1px solid ${BORDER}`,
            fontSize: 11,
            color: "var(--text-2)",
          }}
          title="La manche suivante a déjà des scores : le résultat de ce match ne peut plus être modifié."
        >
          <span aria-hidden="true">🔒</span>
          Score verrouillé
        </div>
      )}
    </div>
  );
}
