"use client";

import { useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTeamDetail } from "./_hooks/useTeamDetail";
import { useTeamPendingInvitations } from "./_hooks/useTeamPendingInvitations";
import { TeamHeader } from "./_components/TeamHeader";
import { MembersSection } from "./_components/MembersSection";
import { MembershipActions } from "./_components/MembershipActions";
import { TeamSettings } from "./_components/TeamSettings";
import { TeamHistory } from "./_components/TeamHistory";
import { StatsPanel } from "@/components/stats/StatsPanel";
import styles from "./team.module.css";

export default function TeamDetailPage() {
  const params = useParams<{ id: string }>();
  const teamId = Number(params.id);
  const { team, loading, error, refresh } = useTeamDetail(teamId);

  // Une fantôme n'a ni membre ni demande, une équipe dissoute plus rien à
  // gérer : la route refuserait (403), autant ne pas l'appeler.
  const managesRoster = Boolean(team && team.canManage && !team.team.isGhost && !team.team.deletedAt);
  const pending = useTeamPendingInvitations(teamId, managesRoster);
  const reloadPending = pending.reload;
  const onPendingChanged = useCallback(() => void reloadPending(), [reloadPending]);

  if (error) {
    return (
      <section className={`ds-block ${styles.page}`}>
        <p className={styles.notice}>
          Cette équipe n&apos;existe pas ou n&apos;existe plus.{" "}
          <Link href="/equipes" className="entity-link">
            Retour aux équipes
          </Link>
        </p>
      </section>
    );
  }

  if (loading || !team) {
    return (
      <section className={`ds-block ${styles.page}`} aria-busy="true">
        <p className={styles.notice}>Chargement de l&apos;équipe…</p>
      </section>
    );
  }

  return (
    <section className={`fade-in ${styles.page}`}>
      <TeamHeader team={team} />
      <MembershipActions
        team={team}
        requests={pending.requests}
        onChanged={refresh}
        onRequestsChanged={onPendingChanged}
      />
      {/* Une fantôme n'a aucun membre et ne peut pas en recevoir : le staff
          l'attribue à un joueur, il n'y invite personne (la route refuse). */}
      <MembersSection
        teamId={teamId}
        teamName={team.team.name}
        members={team.members}
        canManage={managesRoster}
        viewerUserId={team.viewerUserId}
        invitations={pending.invitations}
        onChanged={refresh}
        onInvitationsChanged={onPendingChanged}
      />
      {team.canManage ? <TeamSettings team={team} onChanged={refresh} /> : null}

      <section className={`ds-block ${styles.block}`} aria-labelledby="team-stats-title">
        <div className="ds-section-title orange">
          <h2 id="team-stats-title">Statistiques</h2>
        </div>
        <StatsPanel stats={team.stats} accent="orange" ranking={team.ranking} />
      </section>

      <TeamHistory tournaments={team.tournaments} />
    </section>
  );
}
