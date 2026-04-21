"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { BracketMatch, BracketType, TournamentDetail } from "@/lib/shared/types";

type MatchScoreDraft = Record<number, { myScore: string; opponentScore: string }>;
type AdminDraft = Record<number, { score1: string; score2: string }>;

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

const SLOT_H = 90;
const CARD_W = 210;
const CONN_W = 40;
const BORDER = "var(--border, #444)";

function BracketMatchCard({
  match,
  reportable,
  adminResolvable,
  drafts,
  setDrafts,
  adminDrafts,
  setAdminDrafts,
  onSubmit,
  onAdminResolve,
}: {
  match: BracketMatch;
  reportable: boolean;
  adminResolvable: boolean;
  drafts: MatchScoreDraft;
  setDrafts: React.Dispatch<React.SetStateAction<MatchScoreDraft>>;
  adminDrafts: AdminDraft;
  setAdminDrafts: React.Dispatch<React.SetStateAction<AdminDraft>>;
  onSubmit: (match: BracketMatch, e: FormEvent) => Promise<void>;
  onAdminResolve: (match: BracketMatch, score1: number, score2: number) => Promise<void>;
}) {
  const team1Win = match.winnerTeamId !== null && match.winnerTeamId === match.team1Id;
  const team2Win = match.winnerTeamId !== null && match.winnerTeamId === match.team2Id;
  const hasWinner = match.winnerTeamId !== null;

  const rowStyle = (win: boolean): React.CSSProperties => ({
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "5px 8px",
    background: win ? "rgba(79,224,162,0.15)" : hasWinner ? "rgba(255,255,255,0.03)" : undefined,
    color: win ? "var(--text-0)" : hasWinner ? "var(--text-2)" : "var(--text-1)",
    fontWeight: win ? 600 : 400,
  });

  const handleAdminSubmit = (e: FormEvent) => {
    e.preventDefault();
    const draft = adminDrafts[match.id] ?? { score1: "", score2: "" };
    const s1 = Number(draft.score1);
    const s2 = Number(draft.score2);
    if (!Number.isFinite(s1) || !Number.isFinite(s2) || s1 === s2) return;
    void onAdminResolve(match, s1, s2);
  };

  return (
    <div
      style={{
        width: CARD_W,
        background: "var(--surface-1)",
        border: `1px solid ${adminResolvable ? "rgba(251,146,60,0.4)" : BORDER}`,
        borderRadius: 6,
        overflow: "hidden",
        fontSize: 13,
      }}
    >
      <div style={{ ...rowStyle(team1Win), borderBottom: `1px solid ${BORDER}` }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {match.team1Name || "TBD"}
        </span>
        <strong style={{ marginLeft: 8, color: team1Win ? "var(--green)" : "var(--text-2)" }}>
          {match.team1Score ?? "-"}
        </strong>
      </div>
      <div style={rowStyle(team2Win)}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {match.team2Name || "TBD"}
        </span>
        <strong style={{ marginLeft: 8, color: team2Win ? "var(--green)" : "var(--text-2)" }}>
          {match.team2Score ?? "-"}
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

      {/* Formulaire admin */}
      {adminResolvable && (
        <form
          onSubmit={handleAdminSubmit}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "5px 6px",
            background: "rgba(251,146,60,0.08)",
            borderTop: `1px solid rgba(251,146,60,0.25)`,
          }}
        >
          <span style={{ fontSize: 10, color: "rgba(251,146,60,0.9)", fontWeight: 700, letterSpacing: "0.06em", marginRight: 2 }}>
            ADM
          </span>
          <input
            type="number"
            min={0}
            max={99}
            placeholder={match.team1Name?.slice(0, 4) ?? "T1"}
            value={adminDrafts[match.id]?.score1 || ""}
            onChange={(e) =>
              setAdminDrafts((prev) => ({
                ...prev,
                [match.id]: { ...prev[match.id], score1: e.target.value },
              }))
            }
            style={{ width: 46, fontSize: 12 }}
          />
          <span style={{ color: "var(--text-2)", fontSize: 11 }}>–</span>
          <input
            type="number"
            min={0}
            max={99}
            placeholder={match.team2Name?.slice(0, 4) ?? "T2"}
            value={adminDrafts[match.id]?.score2 || ""}
            onChange={(e) =>
              setAdminDrafts((prev) => ({
                ...prev,
                [match.id]: { ...prev[match.id], score2: e.target.value },
              }))
            }
            style={{ width: 46, fontSize: 12 }}
          />
          <button
            className="btn"
            type="submit"
            style={{ padding: "3px 8px", fontSize: 12, background: "rgba(251,146,60,0.15)", borderColor: "rgba(251,146,60,0.4)" }}
          >
            ✓
          </button>
        </form>
      )}
    </div>
  );
}

function BracketTree({
  matches,
  bracketType,
  canReport,
  adminResolvable,
  drafts,
  setDrafts,
  adminDrafts,
  setAdminDrafts,
  onSubmit,
  onAdminResolve,
}: {
  matches: BracketMatch[];
  bracketType: BracketType;
  canReport: (m: BracketMatch) => boolean;
  adminResolvable: (m: BracketMatch) => boolean;
  drafts: MatchScoreDraft;
  setDrafts: React.Dispatch<React.SetStateAction<MatchScoreDraft>>;
  adminDrafts: AdminDraft;
  setAdminDrafts: React.Dispatch<React.SetStateAction<AdminDraft>>;
  onSubmit: (match: BracketMatch, e: FormEvent) => Promise<void>;
  onAdminResolve: (match: BracketMatch, score1: number, score2: number) => Promise<void>;
}) {
  const roundNums = [...new Set(matches.map((m) => m.roundNumber))].sort((a, b) => a - b);
  const totalRounds = roundNums.length;

  const roundLabel = (roundNum: number, idx: number) => {
    if (bracketType === "GRAND") return "Grande Finale";
    if (idx === totalRounds - 1) return bracketType === "LOWER" ? "Finale perdants" : "Finale";
    return `Round ${roundNum}`;
  };

  return (
    <div style={{ display: "flex", overflowX: "auto", paddingBottom: 8 }}>
      {roundNums.map((roundNum, roundIdx) => {
        const roundMatches = matches
          .filter((m) => m.roundNumber === roundNum)
          .sort((a, b) => a.matchNumber - b.matchNumber);

        const slotH = SLOT_H * Math.pow(2, roundIdx);
        const isLast = roundIdx === totalRounds - 1;

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
                {roundMatches.map((match) => (
                  <div
                    key={match.id}
                    style={{ height: slotH, display: "flex", alignItems: "center" }}
                  >
                    <BracketMatchCard
                      match={match}
                      reportable={canReport(match)}
                      adminResolvable={adminResolvable(match)}
                      drafts={drafts}
                      setDrafts={setDrafts}
                      adminDrafts={adminDrafts}
                      setAdminDrafts={setAdminDrafts}
                      onSubmit={onSubmit}
                      onAdminResolve={onAdminResolve}
                    />
                  </div>
                ))}
              </div>

              {!isLast && (
                <div style={{ width: CONN_W, flexShrink: 0 }}>
                  {roundMatches.map((match, idx) => {
                    const isTop = idx % 2 === 0;
                    return (
                      <div key={match.id} style={{ height: slotH, position: "relative" }}>
                        <div
                          style={{
                            position: "absolute",
                            top: "50%",
                            left: 0,
                            width: "100%",
                            height: 2,
                            background: BORDER,
                            transform: "translateY(-1px)",
                          }}
                        />
                        <div
                          style={{
                            position: "absolute",
                            left: "50%",
                            right: 0,
                            ...(isTop
                              ? { top: "50%", bottom: 0, borderBottom: `2px solid ${BORDER}` }
                              : { top: 0, bottom: "50%", borderTop: `2px solid ${BORDER}` }),
                            borderRight: `2px solid ${BORDER}`,
                          }}
                        />
                      </div>
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
  const tournamentId = Number(params.id);
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [drafts, setDrafts] = useState<MatchScoreDraft>({});
  const [adminDrafts, setAdminDrafts] = useState<AdminDraft>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/tournaments/${tournamentId}`, { cache: "no-store" });
    const payload = (await response.json()) as TournamentDetail & { error?: string };
    if (!response.ok) throw new Error(payload.error || "TOURNAMENT_LOAD_FAILED");
    setDetail(payload);
  }, [tournamentId]);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

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
    if (match.winnerTeamId !== null) return false;
    if (match.team1Id === null || match.team2Id === null) return false;
    return true;
  };

  const submitScore = async (match: BracketMatch, event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setStatus(null);
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
      setStatus(`Score transmis pour le match #${match.id}.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const adminResolve = async (match: BracketMatch, score1: number, score2: number) => {
    setError(null);
    setStatus(null);
    try {
      const response = await fetch(`/api/admin/matches/${match.id}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ team1Score: score1, team2Score: score2 }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "ADMIN_RESOLVE_FAILED");
      setStatus(`Match #${match.id} résolu par l'admin.`);
      setAdminDrafts((prev) => {
        const next = { ...prev };
        delete next[match.id];
        return next;
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const registerTeam = async () => {
    setError(null);
    setStatus(null);
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/register`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "REGISTRATION_FAILED");
      setStatus("Inscription validée.");
      await load();
    } catch (e) {
      setError((e as Error).message);
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
    detail.card.format === "SINGLE" ? ["UPPER"] : ["UPPER", "LOWER", "GRAND"];
  const bracketLabels: Record<BracketType, string> = {
    UPPER: "Tableau principal",
    LOWER: "Tableau perdants",
    GRAND: "Grande Finale",
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
            <h1 className="ds-title green" style={{ fontSize: "clamp(26px, 3vw, 42px)", marginBottom: 8 }}>
              {detail.card.name}
            </h1>
            {detail.card.description && (
              <p style={{ color: "var(--text-1)", margin: "0 0 20px", fontSize: 15, lineHeight: 1.6 }}>
                {detail.card.description}
              </p>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span className={`ds-chip ${stateMeta.chipClass}`.trim()}>{stateMeta.label}</span>
              <span className="ds-chip muted" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
                {detail.card.format === "SINGLE" ? "Simple élimination" : "Double élimination"}
              </span>
              <span className="ds-chip muted" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
                {detail.card.registeredTeams}/{detail.card.maxTeams} équipes
              </span>
              {detail.isAdmin && (
                <span
                  className="ds-chip"
                  style={{
                    background: "rgba(251,146,60,0.15)",
                    border: "1px solid rgba(251,146,60,0.4)",
                    color: "rgba(251,146,60,0.95)",
                    textTransform: "none",
                    letterSpacing: 0,
                    fontWeight: 700,
                  }}
                >
                  ⚙ Admin
                </span>
              )}
              {detail.canRegister && (
                <button
                  type="button"
                  onClick={registerTeam}
                  className="btn"
                  style={{
                    padding: "6px 16px",
                    fontSize: 13,
                    background: "rgba(79,224,162,0.12)",
                    borderColor: "rgba(79,224,162,0.35)",
                  }}
                >
                  Inscrire mon équipe
                </button>
              )}
            </div>
          </div>
        </div>

        {error && <p className="error" style={{ marginBottom: 16 }}>{error}</p>}
        {status && <p className="success" style={{ marginBottom: 16 }}>{status}</p>}

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
              <div key={type} style={{ marginBottom: type !== brackets[brackets.length - 1].type ? 32 : 0 }}>
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
                  bracketType={type}
                  canReport={canReport}
                  adminResolvable={canAdminResolve}
                  drafts={drafts}
                  setDrafts={setDrafts}
                  adminDrafts={adminDrafts}
                  setAdminDrafts={setAdminDrafts}
                  onSubmit={submitScore}
                  onAdminResolve={adminResolve}
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
                <span>{new Date(reg.registeredAt).toLocaleString()}</span>
                <span>{reg.finalRank ?? "-"}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
