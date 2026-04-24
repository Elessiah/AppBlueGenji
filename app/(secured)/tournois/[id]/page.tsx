"use client";

import { CSSProperties, FormEvent, Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { formatLocalDateTime } from "@/lib/shared/dates";
import type { BracketMatch, BracketType, TournamentDetail } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { Pill, CyberButton } from "@/components/cyber";
import { useSetPalette } from "@/lib/palette-context";

type MatchScoreDraft = Record<number, { myScore: string; opponentScore: string }>;
type AdminDraft = Record<number, { score1: string; score2: string; forfeitTeamId?: number | null }>;

const ERROR_MESSAGES: Record<string, string> = {
  CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES: "Impossible de modifier ce match car les matchs suivants sont déjà terminés.",
  MATCH_NOT_FOUND: "Match introuvable.",
  MATCH_NOT_READY: "Le match n'a pas deux équipes.",
  MATCH_ALREADY_COMPLETED: "Le match est déjà terminé.",
  DRAW_NOT_ALLOWED: "Les scores ne peuvent pas être égaux.",
  TOURNAMENT_NOT_FOUND: "Tournoi introuvable.",
  TOURNAMENT_NOT_RUNNING: "Le tournoi n'est pas en cours.",
  ADMIN_SAVE_SCORES_FAILED: "Erreur lors de la sauvegarde des scores.",
  ADMIN_RESOLVE_FAILED: "Erreur lors de la résolution du match.",
  INVALID_FORFEIT_TEAM_ID: "ID d'équipe forfait invalide.",
  MISSING_SCORES_OR_FORFEIT: "Scores ou forfait requis.",
};

function translateError(errorCode: string): string {
  return ERROR_MESSAGES[errorCode] || errorCode;
}

function playPing() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    oscillator.type = "triangle";
    gain.gain.value = 0.0001;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);
    oscillator.stop(context.currentTime + 0.22);
  } catch {
    // ignore audio failures
  }
}

const STATE_META: Record<string, { label: string; chipClass: string }> = {
  UPCOMING: { label: "Prochainement", chipClass: "teal" },
  REGISTRATION: { label: "Inscriptions", chipClass: "green" },
  RUNNING: { label: "En cours", chipClass: "lime" },
  FINISHED: { label: "Terminé", chipClass: "muted" },
};

function AdminScoreModal({
  match,
  score1,
  score2,
  onScore1Change,
  onScore2Change,
  onClose,
  onSaveBoth,
  onSubmit,
  isLoading,
  forfeitTeamId,
  onForfeitChange,
}: {
  match: BracketMatch;
  score1: string;
  score2: string;
  onScore1Change: (val: string) => void;
  onScore2Change: (val: string) => void;
  onClose: () => void;
  onSaveBoth: (s1: number | undefined, s2: number | undefined, forfeitTeamId?: number) => Promise<void>;
  onSubmit: (s1: number | undefined, s2: number | undefined, forfeitTeamId?: number) => Promise<void>;
  isLoading: boolean;
  forfeitTeamId?: number | null;
  onForfeitChange: (teamId?: number) => void;
}) {
  const { showError } = useToast();

  const handleSaveScoresOnly = async () => {
    if (forfeitTeamId) {
      await onSaveBoth(undefined, undefined, forfeitTeamId);
    } else {
      const s1 = Number(score1);
      const s2 = Number(score2);
      if (!Number.isFinite(s1) || !Number.isFinite(s2)) return;
      if (s1 === s2) { showError("Les scores ne peuvent pas être égaux."); return; }
      await onSaveBoth(s1, s2);
    }
    onClose();
  };

  const handleDefineWinner = async () => {
    if (forfeitTeamId) {
      await onSubmit(undefined, undefined, forfeitTeamId);
    } else {
      const s1 = Number(score1);
      const s2 = Number(score2);
      if (!Number.isFinite(s1) || !Number.isFinite(s2)) return;
      if (s1 === s2) { showError("Les scores ne peuvent pas être égaux."); return; }
      await onSubmit(s1, s2);
    }
    onClose();
  };

  const s1Num = Number(score1);
  const s2Num = Number(score2);
  const isValidScore = forfeitTeamId ? true : (Number.isFinite(s1Num) && Number.isFinite(s2Num) && s1Num !== s2Num);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.65)",
          zIndex: 999,
        }}
      />
      {/* Modal */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "linear-gradient(135deg, rgba(89,212,255,0.12) 0%, rgba(89,212,255,0.06) 100%)",
          border: `2px solid rgba(89,212,255,0.5)`,
          borderRadius: 12,
          padding: 32,
          maxWidth: 540,
          width: "90vw",
          maxHeight: "90vh",
          overflow: "auto",
          zIndex: 1000,
          boxShadow: "0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(89,212,255,0.2), inset 0 1px 0 rgba(89,212,255,0.1)",
          backdropFilter: "blur(4px)",
        }}
      >
        <h2 style={{ margin: "0 0 24px", fontSize: 18, fontWeight: 700, color: "var(--text-0)" }}>
          Éditer le score du match
        </h2>

        {forfeitTeamId && (
          <div
            style={{
              marginBottom: 20,
              padding: 12,
              background: "rgba(255,157,46,0.12)",
              border: "1px solid rgba(255,157,46,0.35)",
              borderRadius: 6,
              fontSize: 13,
              color: "rgba(255,157,46,0.9)",
            }}
          >
            ⚠ Forfait déclaré : {forfeitTeamId === match.team1Id ? match.team1Name || "Équipe 1" : match.team2Name || "Équipe 2"} a déclaré forfait
          </div>
        )}

        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, alignItems: "end" }}>
            <div>
              <label style={{ display: "block", margin: "0 0 10px", fontSize: 12, fontWeight: 700, color: "rgba(89,212,255,0.9)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {match.team1Name || "Équipe 1"}
              </label>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => {
                    const val = Math.max(0, Number(score1 || 0) - 1);
                    onScore1Change(String(val));
                  }}
                  style={{
                    width: 36,
                    height: 36,
                    padding: 0,
                    fontSize: 16,
                    fontWeight: 700,
                    background: "rgba(89,212,255,0.15)",
                    border: "1px solid rgba(89,212,255,0.3)",
                    borderRadius: 6,
                    color: "rgba(89,212,255,0.9)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s",
                    flexShrink: 0,
                  }}
                  disabled={isLoading}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(89,212,255,0.25)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(89,212,255,0.15)";
                  }}
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={score1}
                  onChange={(e) => onScore1Change(e.target.value)}
                  autoFocus
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "10px 12px",
                    fontSize: 22,
                    fontWeight: 700,
                    textAlign: "center",
                    background: "var(--surface-1)",
                    border: `2px solid rgba(89,212,255,0.4)`,
                    borderRadius: 8,
                    color: "var(--text-0)",
                    transition: "border-color 0.2s",
                  }}
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => {
                    const val = Math.min(99, Number(score1 || 0) + 1);
                    onScore1Change(String(val));
                  }}
                  style={{
                    width: 36,
                    height: 36,
                    padding: 0,
                    fontSize: 16,
                    fontWeight: 700,
                    background: "rgba(89,212,255,0.15)",
                    border: "1px solid rgba(89,212,255,0.3)",
                    borderRadius: 6,
                    color: "rgba(89,212,255,0.9)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s",
                    flexShrink: 0,
                  }}
                  disabled={isLoading}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(89,212,255,0.25)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(89,212,255,0.15)";
                  }}
                >
                  +
                </button>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>vs</span>
            </div>

            <div>
              <label style={{ display: "block", margin: "0 0 10px", fontSize: 12, fontWeight: 700, color: "rgba(89,212,255,0.9)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {match.team2Name || "Équipe 2"}
              </label>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => {
                    const val = Math.max(0, Number(score2 || 0) - 1);
                    onScore2Change(String(val));
                  }}
                  style={{
                    width: 36,
                    height: 36,
                    padding: 0,
                    fontSize: 16,
                    fontWeight: 700,
                    background: "rgba(89,212,255,0.15)",
                    border: "1px solid rgba(89,212,255,0.3)",
                    borderRadius: 6,
                    color: "rgba(89,212,255,0.9)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s",
                    flexShrink: 0,
                  }}
                  disabled={isLoading}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(89,212,255,0.25)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(89,212,255,0.15)";
                  }}
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={score2}
                  onChange={(e) => onScore2Change(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "10px 12px",
                    fontSize: 22,
                    fontWeight: 700,
                    textAlign: "center",
                    background: "var(--surface-1)",
                    border: `2px solid rgba(89,212,255,0.4)`,
                    borderRadius: 8,
                    color: "var(--text-0)",
                    transition: "border-color 0.2s",
                  }}
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => {
                    const val = Math.min(99, Number(score2 || 0) + 1);
                    onScore2Change(String(val));
                  }}
                  style={{
                    width: 36,
                    height: 36,
                    padding: 0,
                    fontSize: 16,
                    fontWeight: 700,
                    background: "rgba(89,212,255,0.15)",
                    border: "1px solid rgba(89,212,255,0.3)",
                    borderRadius: 6,
                    color: "rgba(89,212,255,0.9)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s",
                    flexShrink: 0,
                  }}
                  disabled={isLoading}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(89,212,255,0.25)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(89,212,255,0.15)";
                  }}
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 24, paddingTop: 20, borderTop: "1px solid rgba(89,212,255,0.2)" }}>
          <p
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.09em",
              color: "var(--text-2)",
              margin: "0 0 12px",
              fontWeight: 700,
            }}
          >
            Forfait
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => onForfeitChange(forfeitTeamId === match.team1Id ? undefined : match.team1Id ?? undefined)}
              style={{
                flex: 1,
                padding: "10px 12px",
                fontSize: 12,
                fontWeight: 600,
                background: forfeitTeamId === match.team1Id ? "rgba(255,157,46,0.2)" : "rgba(255,157,46,0.08)",
                border: `2px solid rgba(255,157,46,${forfeitTeamId === match.team1Id ? 0.5 : 0.25})`,
                borderRadius: 6,
                color: forfeitTeamId === match.team1Id ? "rgba(255,157,46,1)" : "rgba(255,157,46,0.6)",
                cursor: isLoading ? "not-allowed" : "pointer",
                transition: "all 0.2s",
              }}
              disabled={isLoading}
            >
              {match.team1Name || "Équipe 1"}
            </button>
            <button
              type="button"
              onClick={() => onForfeitChange(forfeitTeamId === match.team2Id ? undefined : match.team2Id ?? undefined)}
              style={{
                flex: 1,
                padding: "10px 12px",
                fontSize: 12,
                fontWeight: 600,
                background: forfeitTeamId === match.team2Id ? "rgba(255,157,46,0.2)" : "rgba(255,157,46,0.08)",
                border: `2px solid rgba(255,157,46,${forfeitTeamId === match.team2Id ? 0.5 : 0.25})`,
                borderRadius: 6,
                color: forfeitTeamId === match.team2Id ? "rgba(255,157,46,1)" : "rgba(255,157,46,0.6)",
                cursor: isLoading ? "not-allowed" : "pointer",
                transition: "all 0.2s",
              }}
              disabled={isLoading}
            >
              {match.team2Name || "Équipe 2"}
            </button>
            {forfeitTeamId && (
              <button
                type="button"
                onClick={() => onForfeitChange(undefined)}
                style={{
                  padding: "10px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  background: "rgba(89,212,255,0.08)",
                  border: "1px solid rgba(89,212,255,0.25)",
                  borderRadius: 6,
                  color: "rgba(89,212,255,0.6)",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                  whiteSpace: "nowrap",
                }}
                disabled={isLoading}
              >
                Annuler forfait
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: 12, alignItems: "stretch" }}>
          <button
            type="button"
            onClick={onClose}
            className="btn"
            style={{
              padding: "12px 16px",
              fontSize: 14,
              fontWeight: 600,
              background: "var(--surface-1)",
              borderColor: "var(--border)",
              color: "var(--text-1)",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
            disabled={isLoading}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSaveScoresOnly}
            className="btn"
            style={{
              padding: "12px 16px",
              fontSize: 13,
              fontWeight: 600,
              background: isValidScore ? "rgba(79,224,162,0.15)" : "rgba(79,224,162,0.05)",
              borderColor: "rgba(79,224,162,0.4)",
              color: isValidScore ? "rgba(79,224,162,1)" : "rgba(79,224,162,0.5)",
              cursor: isValidScore && !isLoading ? "pointer" : "not-allowed",
              opacity: isValidScore && !isLoading ? 1 : 0.5,
              transition: "all 0.2s",
            }}
            disabled={!isValidScore || isLoading}
          >
            {isLoading ? "..." : "OK"}
          </button>
          <button
            type="button"
            onClick={handleDefineWinner}
            className="btn"
            style={{
              padding: "12px 16px",
              fontSize: 13,
              fontWeight: 600,
              background: isValidScore ? "rgba(89,212,255,0.2)" : "rgba(89,212,255,0.08)",
              borderColor: "rgba(89,212,255,0.5)",
              color: isValidScore ? "rgba(89,212,255,1)" : "rgba(89,212,255,0.5)",
              cursor: isValidScore && !isLoading ? "pointer" : "not-allowed",
              opacity: isValidScore && !isLoading ? 1 : 0.5,
              transition: "all 0.2s",
            }}
            disabled={!isValidScore || isLoading}
          >
            {isLoading ? "..." : "✓ Gagnant"}
          </button>
        </div>
      </div>
    </>
  );
}

const SLOT_H = 140;
const CARD_W = 210;
const CONN_W = 40;
const BORDER = "var(--border, #444)";

function BracketMatchCard({
  match,
  reportable,
  adminResolvable,
  drafts,
  setDrafts,
  onSubmit,
  onOpenAdminModal,
  allMatches,
  roundNumber,
}: {
  match: BracketMatch;
  reportable: boolean;
  adminResolvable: boolean;
  drafts: MatchScoreDraft;
  setDrafts: React.Dispatch<React.SetStateAction<MatchScoreDraft>>;
  onSubmit: (match: BracketMatch, e: FormEvent) => Promise<void>;
  onOpenAdminModal: (match: BracketMatch) => void;
  allMatches: BracketMatch[];
  roundNumber: number;
}) {
  const team1Win = match.winnerTeamId !== null && match.winnerTeamId === match.team1Id;
  const team2Win = match.winnerTeamId !== null && match.winnerTeamId === match.team2Id;
  const hasWinner = match.winnerTeamId !== null;

  // Vérifier si les matchs suivants ont des scores (non 0-0).
  // On exclut les matchs BYE (une seule équipe présente) qui ont des scores auto-générés.
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

  // Show FF only if both teams are present (not a BYE) AND match is completed AND forfeit is declared
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
          <Link href={`/equipes/${match.team1Id}`} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, display: "block", textDecoration: "none", color: "inherit" }}>
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
          <Link href={`/equipes/${match.team2Id}`} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, display: "block", textDecoration: "none", color: "inherit" }}>
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

      {/* Formulaire équipe */}
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
            value={drafts[match.id]?.myScore || ""}
            onChange={(e) =>
              setDrafts((prev) => ({
                ...prev,
                [match.id]: { ...prev[match.id], myScore: e.target.value },
              }))
            }
            style={{ width: 52, fontSize: 12 }}
          />
          <input
            type="number"
            min={0}
            max={99}
            placeholder="Eux"
            value={drafts[match.id]?.opponentScore || ""}
            onChange={(e) =>
              setDrafts((prev) => ({
                ...prev,
                [match.id]: { ...prev[match.id], opponentScore: e.target.value },
              }))
            }
            style={{ width: 52, fontSize: 12 }}
          />
          <button className="btn" type="submit" style={{ padding: "3px 10px", fontSize: 12 }}>
            ✓
          </button>
        </form>
      )}

      {/* Bouton édition admin */}
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

function BracketTree({
  matches,
  allTournamentMatches,
  bracketType,
  canReport,
  adminResolvable,
  drafts,
  setDrafts,
  onSubmit,
  onOpenAdminModal,
}: {
  matches: BracketMatch[];
  allTournamentMatches: BracketMatch[];
  bracketType: BracketType;
  canReport: (m: BracketMatch) => boolean;
  adminResolvable: (m: BracketMatch) => boolean;
  drafts: MatchScoreDraft;
  setDrafts: React.Dispatch<React.SetStateAction<MatchScoreDraft>>;
  onSubmit: (match: BracketMatch, e: FormEvent) => Promise<void>;
  onOpenAdminModal: (match: BracketMatch) => void;
}) {
  const roundNums = [...new Set(matches.map((m) => m.roundNumber))].sort((a, b) => a - b);
  const totalRounds = roundNums.length;

  // Pré-calcul : liste triée de matchs par round
  const matchesByRound = new Map(
    roundNums.map((rn) => [
      rn,
      matches.filter((m) => m.roundNumber === rn).sort((a, b) => a.matchNumber - b.matchNumber),
    ]),
  );

  // Hauteur totale = (nombre max de matchs dans un round) × SLOT_H
  // → tous les rounds ont la même hauteur totale, ce qui garantit l'alignement des connecteurs
  const maxMatchCount = Math.max(...[...matchesByRound.values()].map((ms) => ms.length));
  const totalH = maxMatchCount * SLOT_H;

  // slotH d'un round = totalH / nombre de matchs dans ce round
  // Cas upper bracket (matchs divisés par 2 à chaque round) → équivalent à SLOT_H * 2^roundIdx
  // Cas lower bracket (ratio variable) → positions correctes pour les deux rounds adjacents
  const slotHByRound = new Map(
    roundNums.map((rn) => [rn, totalH / matchesByRound.get(rn)!.length]),
  );

  const roundLabel = (roundNum: number, idx: number) => {
    if (bracketType === "GRAND") return "Grande Finale";
    if (bracketType === "THIRD_PLACE") return "Petite Finale";
    if (idx === totalRounds - 1) return bracketType === "LOWER" ? "Finale perdants" : "Finale";
    return `Round ${roundNum}`;
  };

  const matchLabel = (matchNum: number, idx: number) => {
    if (bracketType === "GRAND") return null;
    if (bracketType === "THIRD_PLACE") return null;
    if (idx === totalRounds - 1) return bracketType === "LOWER" ? `Finale perdants ${matchNum}` : `Finale ${matchNum}`;
    if (idx === totalRounds - 2) return `Demi finale ${matchNum}`;
    if (idx === totalRounds - 3) return `Quart de finale ${matchNum}`;
    return `Match ${matchNum}`;
  };

  return (
    <div
      style={{
        display: "flex",
        overflowX: "auto",
        overflowY: "visible",
        paddingBottom: 16,
        marginBottom: 8,
        scrollBehavior: "smooth",
        minHeight: "fit-content",
      }}
      className="bracket-scroll"
    >
      {roundNums.map((roundNum, roundIdx) => {
        const roundMatches = matchesByRound.get(roundNum)!;
        const slotH = slotHByRound.get(roundNum)!;
        const isLast = roundIdx === totalRounds - 1;
        const nextRoundNum = roundNums[roundIdx + 1];
        const nextSlotH = nextRoundNum !== undefined ? slotHByRound.get(nextRoundNum)! : 0;
        const nextRoundMatches = nextRoundNum !== undefined ? (matchesByRound.get(nextRoundNum) ?? []) : [];

        return (
          <div key={roundNum} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <div
              style={{
                height: 26,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: CARD_W + (isLast ? 0 : CONN_W),
                fontSize: 11,
                color: "var(--text-2)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              {roundLabel(roundNum, roundIdx)}
            </div>

            <div style={{ display: "flex" }}>
              {/* Colonne des cartes match */}
              <div style={{ width: CARD_W, flexShrink: 0 }}>
                {roundMatches.map((match) => {
                  const label = matchLabel(match.matchNumber, roundIdx);
                  return (
                    <div key={match.id} style={{ height: slotH, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: label ? 2 : 0 }}>
                      {label && (
                        <div style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", lineHeight: 1 }}>
                          {label}
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center" }}>
                        <BracketMatchCard
                          match={match}
                          reportable={canReport(match)}
                          adminResolvable={adminResolvable(match)}
                          drafts={drafts}
                          setDrafts={setDrafts}
                          onSubmit={onSubmit}
                          onOpenAdminModal={onOpenAdminModal}
                          allMatches={allTournamentMatches}
                          roundNumber={roundNum}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Colonne des connecteurs (position absolue, hauteur fixe = totalH) */}
              {!isLast && (
                <div style={{ width: CONN_W, height: totalH, flexShrink: 0, position: "relative" }}>
                  {roundMatches.map((match, matchIdx) => {
                    // Centre vertical du match courant dans la colonne (en px)
                    const sourceCenterY = (matchIdx + 0.5) * slotH;

                    const leftStub: CSSProperties = {
                      position: "absolute",
                      top: Math.round(sourceCenterY) - 1,
                      left: 0,
                      width: "50%",
                      height: 2,
                      background: BORDER,
                    };

                    const targetId = match.nextWinnerMatchId ?? match.nextLoserMatchId;
                    if (!targetId) {
                      // Pas de prochain match : stub gauche seulement
                      return <div key={match.id} style={leftStub} />;
                    }

                    const targetMatchIdx = nextRoundMatches.findIndex((m) => m.id === targetId);
                    if (targetMatchIdx < 0) {
                      return <div key={match.id} style={leftStub} />;
                    }

                    // Centre vertical de la cible dans la prochaine colonne
                    const targetCenterY = (targetMatchIdx + 0.5) * nextSlotH;

                    const vertTop = Math.round(Math.min(sourceCenterY, targetCenterY));
                    const vertBottom = Math.round(Math.max(sourceCenterY, targetCenterY));
                    const hasVertical = vertBottom > vertTop;

                    return (
                      <Fragment key={match.id}>
                        {/* Stub gauche : sortie du match vers le milieu de la colonne */}
                        <div style={leftStub} />
                        {/* Ligne verticale : du centre source au centre cible */}
                        {hasVertical && (
                          <div
                            style={{
                              position: "absolute",
                              left: "calc(50% - 1px)",
                              width: 2,
                              top: vertTop,
                              height: vertBottom - vertTop,
                              background: BORDER,
                            }}
                          />
                        )}
                        {/* Stub droit : du milieu vers la prochaine colonne, à la hauteur de la cible */}
                        <div
                          style={{
                            position: "absolute",
                            top: Math.round(targetCenterY) - 1,
                            left: "50%",
                            right: 0,
                            height: 2,
                            background: BORDER,
                          }}
                        />
                      </Fragment>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function TournamentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tournamentId = Number(params.id);
  const { showError, showSuccess } = useToast();
  const setPalette = useSetPalette();
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [drafts, setDrafts] = useState<MatchScoreDraft>({});
  const [adminDrafts, setAdminDrafts] = useState<AdminDraft>({});
  const [selectedMatchForAdmin, setSelectedMatchForAdmin] = useState<BracketMatch | null>(null);
  const [isAdminLoading, setIsAdminLoading] = useState(false);

  useEffect(() => {
    setPalette("blue");
  }, [setPalette]);

  const load = useCallback(async () => {
    const response = await fetch(`/api/tournaments/${tournamentId}`, { cache: "no-store" });
    const payload = (await response.json()) as TournamentDetail & { error?: string };
    if (!response.ok) {
      const errorCode = payload.error || "TOURNAMENT_LOAD_FAILED";
      if (errorCode === "TOURNAMENT_NOT_FOUND") {
        showError(translateError(errorCode));
        setTimeout(() => router.push("/tournois"), 1500);
        return;
      }
      throw new Error(errorCode);
    }
    setDetail(payload);
  }, [tournamentId, router, showError]);

  useEffect(() => {
    load().catch((e) => showError((e as Error).message));
  }, [load, showError]);

  useEffect(() => {
    if (!tournamentId) return;
    const eventSource = new EventSource(`/api/tournaments/${tournamentId}/stream`);
    eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { type?: string };
      if (payload.type === "score_reported") playPing();
      load().catch(() => undefined);
    };
    eventSource.onerror = () => eventSource.close();
    return () => eventSource.close();
  }, [tournamentId, load]);

  const canReport = (match: BracketMatch): boolean => {
    if (!detail?.myTeamId) return false;
    if (match.winnerTeamId !== null) return false;
    if (match.team1Id === null || match.team2Id === null) return false;
    return (
      detail.canCreateReportsForTeamIds.includes(detail.myTeamId) &&
      (detail.myTeamId === match.team1Id || detail.myTeamId === match.team2Id)
    );
  };

  const canAdminResolve = (match: BracketMatch): boolean => {
    if (!detail?.isAdmin) return false;
    if (match.team1Id === null || match.team2Id === null) return false;
    // Permet de modifier un match complété si les matches suivants ne le sont pas
    // (vérification complète côté serveur)
    return true;
  };

  const submitScore = async (match: BracketMatch, event: FormEvent) => {
    event.preventDefault();
    const draft = drafts[match.id] || { myScore: "", opponentScore: "" };
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/matches/${match.id}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          myScore: Number(draft.myScore),
          opponentScore: Number(draft.opponentScore),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "SCORE_SUBMIT_FAILED");
      showSuccess(`Score transmis pour le match #${match.id}.`);
      await load();
    } catch (e) {
      showError(translateError((e as Error).message));
    }
  };

  const adminSaveScoresOnly = async (match: BracketMatch, score1?: number, score2?: number, forfeitTeamId?: number) => {
    setIsAdminLoading(true);
    try {
      const body: { team1Score?: number; team2Score?: number; forfeitTeamId?: number } = {};
      if (forfeitTeamId !== undefined) {
        body.forfeitTeamId = forfeitTeamId;
      } else {
        body.team1Score = score1;
        body.team2Score = score2;
      }
      const response = await fetch(`/api/admin/matches/${match.id}/scores`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "ADMIN_SAVE_SCORES_FAILED");
      showSuccess(`Scores sauvegardés pour le match #${match.id}.`);
      setAdminDrafts((prev) => {
        const next = { ...prev };
        delete next[match.id];
        return next;
      });
      await load();
    } catch (e) {
      showError(translateError((e as Error).message));
    } finally {
      setIsAdminLoading(false);
    }
  };

  const adminResolve = async (match: BracketMatch, score1?: number, score2?: number, forfeitTeamId?: number) => {
    setIsAdminLoading(true);
    try {
      const body: { team1Score?: number; team2Score?: number; forfeitTeamId?: number } = {};
      if (forfeitTeamId !== undefined) {
        body.forfeitTeamId = forfeitTeamId;
      } else {
        body.team1Score = score1;
        body.team2Score = score2;
      }
      const response = await fetch(`/api/admin/matches/${match.id}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "ADMIN_RESOLVE_FAILED");
      showSuccess(`Match #${match.id} résolu par l'admin.`);
      setAdminDrafts((prev) => {
        const next = { ...prev };
        delete next[match.id];
        return next;
      });
      await load();
    } catch (e) {
      showError(translateError((e as Error).message));
    } finally {
      setIsAdminLoading(false);
    }
  };

  const registerTeam = async () => {
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/register`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "REGISTRATION_FAILED");
      showSuccess("Inscription validée.");
      await load();
    } catch (e) {
      showError((e as Error).message);
    }
  };

  if (!detail) {
    return (
      <section className="ds-block" style={{ color: "var(--text-2)" }}>
        Chargement du tournoi...
      </section>
    );
  }

  const stateMeta = STATE_META[detail.card.state] ?? { label: detail.card.state, chipClass: "muted" };

  const bracketOrder: BracketType[] =
    detail.card.format === "SINGLE"
      ? detail.card.hasThirdPlaceMatch ? ["UPPER", "THIRD_PLACE"] : ["UPPER"]
      : ["UPPER", "LOWER", "GRAND"];
  const bracketLabels: Record<BracketType, string> = {
    UPPER: "Tableau principal",
    LOWER: "Tableau perdants",
    GRAND: "Grande Finale",
    THIRD_PLACE: "Petite Finale",
  };
  const brackets = bracketOrder
    .map((b) => ({ type: b, matches: detail.matches.filter((m) => m.bracket === b) }))
    .filter((b) => b.matches.length > 0);

  return (
    <>
      <Link href="/" className="cta-float-home home" style={{ bottom: 28 }}>
        ⌂ Accueil
      </Link>
      <section className="fade-in">

        <div className="ds-header green">
          <div className="ds-header-body">
            <button
              onClick={() => router.back()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "none",
                border: "none",
                color: "rgba(79,224,162,0.7)",
                cursor: "pointer",
                fontSize: 14,
                marginBottom: 12,
                padding: 0,
                fontWeight: 500,
                transition: "color 0.2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(79,224,162,1)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(79,224,162,0.7)")}
            >
              ← Retour
            </button>
            <h1 className="ds-title green" style={{ fontSize: "clamp(26px, 3vw, 42px)", marginBottom: 8 }}>
              {detail.card.name}
            </h1>
            {detail.card.description && (
              <p style={{ color: "var(--text-1)", margin: "0 0 20px", fontSize: 15, lineHeight: 1.6 }}>
                {detail.card.description}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Pill variant="blue">{detail.card.game}</Pill>
              <Pill variant={detail.card.state === "RUNNING" ? "live" : "blue"}>
                {stateMeta.label}
              </Pill>
              <Pill variant="blue">
                {detail.card.format === "SINGLE" ? "Simple élim." : "Double élim."}
              </Pill>
              {detail.card.hasThirdPlaceMatch && (
                <Pill variant="blue">Petite finale</Pill>
              )}
              <Pill variant="blue">{detail.card.registeredTeams}/{detail.card.maxTeams}</Pill>
              {detail.isAdmin && (
                <Pill variant="blue">⚙ Admin</Pill>
              )}
              {detail.canRegister && (
                <CyberButton
                  variant="primary"
                  onClick={registerTeam}
                  style={{ fontSize: 13, padding: "6px 16px" }}
                >
                  Inscrire mon équipe
                </CyberButton>
              )}
            </div>
          </div>
        </div>

        <div className="ds-block" style={{ marginBottom: 20 }}>
          <div className="ds-section-title green">
            <h2>Arbre du tournoi</h2>
          </div>

          {detail.card.state === "REGISTRATION" ? (
            <p style={{ color: "var(--text-2)", margin: 0, fontSize: 14 }}>
              Le bracket sera généré automatiquement au démarrage du tournoi.
            </p>
          ) : !detail.matches.length ? (
            <p style={{ color: "var(--text-2)", margin: 0, fontSize: 14 }}>
              Aucun match disponible pour l&apos;instant.
            </p>
          ) : (
            brackets.map(({ type, matches }) => (
              <div key={type} style={{ marginBottom: type !== brackets[brackets.length - 1].type ? 32 : 0, minHeight: 0, overflow: "visible" }}>
                {brackets.length > 1 && (
                  <p
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--text-2)",
                      marginBottom: 12,
                    }}
                  >
                    {bracketLabels[type]}
                  </p>
                )}
                <BracketTree
                  matches={matches}
                  allTournamentMatches={detail.matches}
                  bracketType={type}
                  canReport={canReport}
                  adminResolvable={canAdminResolve}
                  drafts={drafts}
                  setDrafts={setDrafts}
                  onSubmit={submitScore}
                  onOpenAdminModal={setSelectedMatchForAdmin}
                />
              </div>
            ))
          )}
        </div>

        <div className="ds-block">
          <div className="ds-section-title green">
            <h2>Inscriptions</h2>
          </div>
          <div className="table-like">
            <div className="table-row table-header">
              <span>Équipe</span>
              <span>Seed</span>
              <span>Inscription</span>
              <span>Classement final</span>
            </div>
            {detail.registrations.map((reg) => (
              <div key={reg.teamId} className="table-row">
                <span>{reg.teamName}</span>
                <span>{reg.seed ?? "-"}</span>
                <span>{formatLocalDateTime(reg.registeredAt)}</span>
                <span>{reg.finalRank ?? "-"}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modal d'édition des scores admin */}
      {selectedMatchForAdmin && (
        <AdminScoreModal
          match={selectedMatchForAdmin}
          score1={adminDrafts[selectedMatchForAdmin.id]?.score1 || String(selectedMatchForAdmin.team1Score ?? "")}
          score2={adminDrafts[selectedMatchForAdmin.id]?.score2 || String(selectedMatchForAdmin.team2Score ?? "")}
          forfeitTeamId={adminDrafts[selectedMatchForAdmin.id]?.forfeitTeamId}
          onScore1Change={(val) =>
            setAdminDrafts((prev) => ({
              ...prev,
              [selectedMatchForAdmin.id]: { ...prev[selectedMatchForAdmin.id], score1: val },
            }))
          }
          onScore2Change={(val) =>
            setAdminDrafts((prev) => ({
              ...prev,
              [selectedMatchForAdmin.id]: { ...prev[selectedMatchForAdmin.id], score2: val },
            }))
          }
          onForfeitChange={(teamId) =>
            setAdminDrafts((prev) => ({
              ...prev,
              [selectedMatchForAdmin.id]: { ...prev[selectedMatchForAdmin.id], forfeitTeamId: teamId },
            }))
          }
          onClose={() => setSelectedMatchForAdmin(null)}
          onSaveBoth={(s1, s2, forfeitId) => adminSaveScoresOnly(selectedMatchForAdmin, s1, s2, forfeitId)}
          onSubmit={(s1, s2, forfeitId) => adminResolve(selectedMatchForAdmin, s1, s2, forfeitId)}
          isLoading={isAdminLoading}
        />
      )}
    </>
  );
}
