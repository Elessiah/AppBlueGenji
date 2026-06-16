"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTeamDetail } from "./_hooks/useTeamDetail";
import { TeamHeader } from "./_components/TeamHeader";
import { MembersSection } from "./_components/MembersSection";
import { MembershipActions } from "./_components/MembershipActions";

export default function TeamDetailPage() {
  const params = useParams<{ id: string }>();
  const teamId = Number(params.id);
  const { team, loading, error, refresh } = useTeamDetail(teamId);
  const [viewerUserId, setViewerUserId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/profile", { cache: "no-store" });
        if (!res.ok) return;
        const payload = (await res.json()) as { profile?: { id: number } };
        if (payload.profile?.id) setViewerUserId(payload.profile.id);
      } catch {
        // silencieux
      }
    })();
  }, []);

  if (error) {
    return (
      <section style={{ color: "var(--text-2)" }}>
        Équipe non trouvée.{" "}
        <Link href="/equipes" style={{ color: "var(--blue-100)" }}>
          Retour aux équipes
        </Link>
      </section>
    );
  }

  if (loading || !team) {
    return (
      <section className="ds-block" style={{ color: "var(--text-2)" }}>
        Chargement de l'équipe…
      </section>
    );
  }

  const viewerIsOwner =
    viewerUserId && team.members.some((m) => m.userId === viewerUserId && m.roles.includes("OWNER"));

  return (
    <section className="fade-in">
      <TeamHeader team={team} onChanged={refresh} canManage={team.canManage} viewerIsOwner={viewerIsOwner || false} />
      <MembershipActions team={team} onChanged={refresh} />
      <MembersSection
        teamId={teamId}
        members={team.members}
        canManage={team.canManage}
        viewerUserId={viewerUserId}
        onChanged={refresh}
      />

      <div className="ds-block">
        <div className="ds-section-title orange">
          <h2>Historique tournois</h2>
        </div>
        <div className="table-like">
          <div className="table-row table-header">
            <span>Tournoi</span>
            <span>Statut</span>
            <span>Bilan</span>
            <span>Rank</span>
          </div>
          {team.tournaments.map((entry) => (
            <div className="table-row" key={`${entry.tournamentId}-${entry.playedAt}`}>
              <Link href={`/tournois/${entry.tournamentId}`}>{entry.tournamentName}</Link>
              <span>{entry.state}</span>
              <span>
                {entry.wins}W / {entry.losses}L
              </span>
              <span>{entry.finalRank ?? "-"}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
