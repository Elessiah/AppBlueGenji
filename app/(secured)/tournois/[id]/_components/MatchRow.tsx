import Link from "next/link";
import { FormEvent } from "react";
import type { BracketMatch } from "@/lib/shared/types";

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
}: MatchRowProps) {
  const team1Win = match.winnerTeamId !== null && match.winnerTeamId === match.team1Id;
  const team2Win = match.winnerTeamId !== null && match.winnerTeamId === match.team2Id;
  const hasWinner = match.winnerTeamId !== null;

  const hasDownstreamScores = (() => {
    if (match.nextWinnerMatchId) {
      const nextWinner = allMatches.find((m) => m.id === match.nextWinnerMatchId);
      const isBye = !nextWinner || nextWinner.team1Id === null || nextWinner.team2Id === null;
      if (!isBye && nextWinner!.team1Score !== null && nextWinner!.team2Score !== null && (nextWinner!.team1Score !== 0 || nextWinner!.team2Score !== 0)) {
        return true;
      }
    }
    if (match.nextLoserMatchId) {
      const nextLoser = allMatches.find((m) => m.id === match.nextLoserMatchId);
      const isBye = !nextLoser || nextLoser.team1Id === null || nextLoser.team2Id === null;
      if (!isBye && nextLoser!.team1Score !== null && nextLoser!.team2Score !== null && (nextLoser!.team1Score !== 0 || nextLoser!.team2Score !== 0)) {
        return true;
      }
    }
    return false;
  })();

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
            href={`/equipes/${match.team1Id}`}
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
            href={`/equipes/${match.team2Id}`}
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

      {reportable && (
        <form
          onSubmit={(e) => onSubmit(match, e)}
          style={{
            display: "flex",
            gap: 4,
            padding: "5px 6px",
            background: "rgba(79,224,162,0.06)",
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          <input
            type="number"
            min={0}
            max={99}
            placeholder="Moi"
            value={myScore}
            onChange={(e) => onScoreChange(match.id, "myScore", e.target.value)}
            style={{ width: 52, fontSize: 12 }}
          />
          <input
            type="number"
            min={0}
            max={99}
            placeholder="Eux"
            value={opponentScore}
            onChange={(e) => onScoreChange(match.id, "opponentScore", e.target.value)}
            style={{ width: 52, fontSize: 12 }}
          />
          <button className="btn" type="submit" style={{ padding: "3px 10px", fontSize: 12 }}>
            ✓
          </button>
        </form>
      )}

      {adminResolvable && !hasDownstreamScores && (
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
    </div>
  );
}
