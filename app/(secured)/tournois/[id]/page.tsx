"use client";

import { CSSProperties, FormEvent, Fragment, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatLocalDateTime } from "@/lib/shared/dates";
import type { BracketMatch, BracketType } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { Pill, CyberButton } from "@/components/cyber";
import { useTournamentLive } from "./_hooks/useTournamentLive";
import { mapError } from "./_lib/error-map";
import { MatchRow } from "./_components/MatchRow";
import { ScoreInputDialog } from "./_components/ScoreInputDialog";

type MatchScoreDraft = Record<number, { myScore: string; opponentScore: string }>;

const STATE_META: Record<string, { label: string; chipClass: string }> = {
  UPCOMING: { label: "Prochainement", chipClass: "teal" },
  REGISTRATION: { label: "Inscriptions", chipClass: "green" },
  RUNNING: { label: "En cours", chipClass: "lime" },
  FINISHED: { label: "Terminé", chipClass: "muted" },
};

const SLOT_H = 140;
const CARD_W = 210;
const CONN_W = 40;
const BORDER = "var(--border, #444)";

interface BracketTreeProps {
  matches: BracketMatch[];
  allTournamentMatches: BracketMatch[];
  bracketType: BracketType;
  canReport: (m: BracketMatch) => boolean;
  adminResolvable: (m: BracketMatch) => boolean;
  drafts: MatchScoreDraft;
  onScoreChange: (matchId: number, field: "myScore" | "opponentScore", value: string) => void;
  onSubmit: (match: BracketMatch, e: FormEvent) => Promise<void>;
  onOpenAdminModal: (match: BracketMatch) => void;
}

function BracketTree({
  matches,
  allTournamentMatches,
  bracketType,
  canReport,
  adminResolvable,
  drafts,
  onScoreChange,
  onSubmit,
  onOpenAdminModal,
}: BracketTreeProps) {
  const roundNums = [...new Set(matches.map((m) => m.roundNumber))].sort((a, b) => a - b);
  const totalRounds = roundNums.length;

  const matchesByRound = new Map(
    roundNums.map((rn) => [
      rn,
      matches.filter((m) => m.roundNumber === rn).sort((a, b) => a.matchNumber - b.matchNumber),
    ]),
  );

  const maxMatchCount = Math.max(...[...matchesByRound.values()].map((ms) => ms.length));
  const totalH = maxMatchCount * SLOT_H;

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
                        <MatchRow
                          match={match}
                          reportable={canReport(match)}
                          adminResolvable={adminResolvable(match)}
                          onScoreChange={onScoreChange}
                          myScore={drafts[match.id]?.myScore || ""}
                          opponentScore={drafts[match.id]?.opponentScore || ""}
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

              {!isLast && (
                <div style={{ width: CONN_W, height: totalH, flexShrink: 0, position: "relative" }}>
                  {roundMatches.map((match, matchIdx) => {
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
                      return <div key={match.id} style={leftStub} />;
                    }

                    const targetMatchIdx = nextRoundMatches.findIndex((m) => m.id === targetId);
                    if (targetMatchIdx < 0) {
                      return <div key={match.id} style={leftStub} />;
                    }

                    const targetCenterY = (targetMatchIdx + 0.5) * nextSlotH;

                    const vertTop = Math.round(Math.min(sourceCenterY, targetCenterY));
                    const vertBottom = Math.round(Math.max(sourceCenterY, targetCenterY));
                    const hasVertical = vertBottom > vertTop;

                    return (
                      <Fragment key={match.id}>
                        <div style={leftStub} />
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

  const { tournament: detail } = useTournamentLive(tournamentId);
  const [drafts, setDrafts] = useState<MatchScoreDraft>({});
  const [selectedMatchForAdmin, setSelectedMatchForAdmin] = useState<BracketMatch | null>(null);

  if (!detail) {
    return (
      <section className="ds-block" style={{ color: "var(--text-2)" }}>
        Chargement du tournoi...
      </section>
    );
  }

  const handleScoreChange = (matchId: number, field: "myScore" | "opponentScore", value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [matchId]: { ...prev[matchId], [field]: value },
    }));
  };

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
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[match.id];
        return next;
      });
    } catch (e) {
      showError(mapError((e as Error).message));
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
    } catch (e) {
      showError(mapError((e as Error).message));
    }
  };

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
                  onScoreChange={handleScoreChange}
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

      <ScoreInputDialog
        match={selectedMatchForAdmin}
        open={!!selectedMatchForAdmin}
        onClose={() => setSelectedMatchForAdmin(null)}
        onSubmitted={() => setSelectedMatchForAdmin(null)}
      />
    </>
  );
}
