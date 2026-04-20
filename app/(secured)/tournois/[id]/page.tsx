"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { BracketMatch, TournamentDetail } from "@/lib/shared/types";

type MatchScoreDraft = Record<number, { myScore: string; opponentScore: string }>;

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

function groupMatches(matches: BracketMatch[]) {
  const map = new Map<string, BracketMatch[]>();
  for (const match of matches) {
    const key = `${match.bracket}-${match.roundNumber}`;
    const current = map.get(key) || [];
    current.push(match);
    map.set(key, current);
  }
  return Array.from(map.entries())
    .map(([key, grouped]) => ({ key, grouped }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

const STATE_META: Record<string, { label: string; chipClass: string }> = {
  UPCOMING: { label: "Prochainement", chipClass: "" },
  REGISTRATION: { label: "Inscriptions", chipClass: "green" },
  RUNNING: { label: "En cours", chipClass: "orange" },
  FINISHED: { label: "Termine", chipClass: "muted" },
};

export default function TournamentDetailPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = Number(params.id);
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [drafts, setDrafts] = useState<MatchScoreDraft>({});
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

  const groups = useMemo(() => groupMatches(detail?.matches || []), [detail?.matches]);

  const canReport = (match: BracketMatch): boolean => {
    if (!detail?.myTeamId) return false;
    if (match.winnerTeamId !== null) return false;
    if (match.team1Id === null || match.team2Id === null) return false;
    return (
      detail.canCreateReportsForTeamIds.includes(detail.myTeamId) &&
      (detail.myTeamId === match.team1Id || detail.myTeamId === match.team2Id)
    );
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

  const registerTeam = async () => {
    setError(null);
    setStatus(null);
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/register`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "REGISTRATION_FAILED");
      setStatus("Inscription validee.");
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

  return (
    <section className="fade-in">
      <Link href="/" className="cta-float-home" style={{ bottom: 28 }}>
        ⌂ Accueil
      </Link>

      <div className="ds-header">
        <div className="ds-header-body">
          <h1 className="ds-title blue" style={{ fontSize: "clamp(26px, 3vw, 42px)", marginBottom: 8 }}>
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
              {detail.card.format === "SINGLE" ? "Simple elimination" : "Double elimination"}
            </span>
            <span className="ds-chip muted" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
              {detail.card.registeredTeams}/{detail.card.maxTeams} equipes
            </span>
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
                Inscrire mon equipe
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <p className="error" style={{ marginBottom: 16 }}>{error}</p>}
      {status && <p className="success" style={{ marginBottom: 16 }}>{status}</p>}

      <div className="ds-block" style={{ marginBottom: 20 }}>
        <div className="ds-section-title orange">
          <h2>Arbre du tournoi</h2>
        </div>

        {!groups.length ? (
          <p style={{ color: "var(--text-2)", margin: 0, fontSize: 14 }}>
            Le bracket sera genere automatiquement au demarrage du tournoi.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="bracket-group">
              <p className="bracket-title">{group.key.replace("-", " - Round ")}</p>
              <div className="bracket-grid">
                {group.grouped.map((match) => {
                  const team1Win = match.winnerTeamId !== null && match.winnerTeamId === match.team1Id;
                  const team2Win = match.winnerTeamId !== null && match.winnerTeamId === match.team2Id;
                  return (
                    <article key={match.id} className="match-card">
                      <div className="match-head">
                        <span>Match #{match.id}</span>
                        <span>{match.status}</span>
                      </div>
                      <div className={`team-line ${team1Win ? "win" : match.winnerTeamId ? "lose" : ""}`}>
                        <span>{match.team1Name || "BYE"}</span>
                        <strong>{match.team1Score ?? "-"}</strong>
                      </div>
                      <div className={`team-line ${team2Win ? "win" : match.winnerTeamId ? "lose" : ""}`}>
                        <span>{match.team2Name || "BYE"}</span>
                        <strong>{match.team2Score ?? "-"}</strong>
                      </div>
                      {canReport(match) && (
                        <form className="inline" style={{ marginTop: 8 }} onSubmit={(e) => submitScore(match, e)}>
                          <input
                            type="number"
                            min={0}
                            max={99}
                            placeholder="Mon score"
                            value={drafts[match.id]?.myScore || ""}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [match.id]: {
                                  myScore: e.target.value,
                                  opponentScore: prev[match.id]?.opponentScore || "",
                                },
                              }))
                            }
                            style={{ width: 90 }}
                          />
                          <input
                            type="number"
                            min={0}
                            max={99}
                            placeholder="Score adverse"
                            value={drafts[match.id]?.opponentScore || ""}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [match.id]: {
                                  myScore: prev[match.id]?.myScore || "",
                                  opponentScore: e.target.value,
                                },
                              }))
                            }
                            style={{ width: 110 }}
                          />
                          <button className="btn" type="submit" style={{ padding: "6px 14px", fontSize: 13 }}>
                            Envoyer
                          </button>
                        </form>
                      )}
                    </article>
                  );
                })}
              </div>
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
            <span>Equipe</span>
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
  );
}
