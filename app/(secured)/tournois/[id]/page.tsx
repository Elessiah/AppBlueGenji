"use client";

import { FormEvent, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatLocalDateTime } from "@/lib/shared/dates";
import type { BracketMatch, BracketType } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { Pill, CyberButton } from "@/components/cyber";
import { useTournamentLive } from "./_hooks/useTournamentLive";
import { mapError } from "./_lib/error-map";
import { AdminScoreDialog } from "./_components/AdminScoreDialog";
import { MatchScoreDraft } from "./_components/BracketTree";
import { BracketSections } from "./_components/BracketSections";

const STATE_META: Record<string, { label: string; chipClass: string }> = {
  UPCOMING: { label: "Prochainement", chipClass: "teal" },
  REGISTRATION: { label: "Inscriptions", chipClass: "green" },
  RUNNING: { label: "En cours", chipClass: "lime" },
  FINISHED: { label: "Terminé", chipClass: "muted" },
};

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
                <BracketSections
                  bracketType={type}
                  bracketLabel={bracketLabels[type]}
                  showBracketLabel={brackets.length > 1}
                  matches={matches}
                  allTournamentMatches={detail.matches}
                  myTeamId={detail.myTeamId}
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

      <AdminScoreDialog
        match={selectedMatchForAdmin}
        open={!!selectedMatchForAdmin}
        onClose={() => setSelectedMatchForAdmin(null)}
        onSubmitted={() => setSelectedMatchForAdmin(null)}
      />
    </>
  );
}
