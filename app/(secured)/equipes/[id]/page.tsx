"use client";

import { useCallback, useEffect } from "react";
import { useToast } from "@/components/ui/toast";
import { useParams } from "next/navigation";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useTeamPageText } from "@/components/i18n/team-page-text";
import { useStatsPanelI18n } from "@/components/i18n/stats-panel-i18n";
import { useTeamDetail } from "./_hooks/useTeamDetail";
import { useTeamPendingInvitations } from "./_hooks/useTeamPendingInvitations";
import { TeamHeader } from "./_components/TeamHeader";
import { MembersSection } from "./_components/MembersSection";
import { MembershipActions } from "./_components/MembershipActions";
import { TeamSettings } from "./_components/TeamSettings";
import { TeamHistory } from "./_components/TeamHistory";
import { ModerationLogoBar } from "./_components/ModerationLogoBar";
import { StatsPanel } from "@/components/stats/StatsPanel";
import styles from "./team.module.css";

export default function TeamDetailPage() {
  const params = useParams<{ id: string }>();
  const teamId = Number(params.id);
  const { team, loading, error, loadFailed, refresh } = useTeamDetail(teamId);
  const { t } = useTeamPageText();
  const { showError } = useToast();
  const statsI18n = useStatsPanelI18n();

  // Une fantôme n'a ni membre ni demande, une équipe dissoute plus rien à
  // gérer : la route refuserait (403), autant ne pas l'appeler.
  const managesRoster = Boolean(team?.canManage && !team.team.isGhost && !team.team.deletedAt);
  const pending = useTeamPendingInvitations(teamId, managesRoster);
  const reloadPending = pending.reload;
  const onPendingChanged = useCallback(() => void reloadPending(), [reloadPending]);
  // Une notification par échec ; « introuvable » a déjà la sienne (redirection).
  useEffect(() => {
    if (loadFailed) showError(t("page.loadError"));
  }, [loadFailed, showError, t]);

  if (error) {
    return (
      <section className={`ds-block ${styles.page}`}>
        <p className={styles.notice}>
          {loadFailed ? t("page.loadError") : t("page.notFound")}{" "}
          <LocaleLink href="/equipes" className="entity-link">
            {t("page.backToTeams")}
          </LocaleLink>
        </p>
      </section>
    );
  }

  if (loading || !team) {
    return (
      <section className={`ds-block ${styles.page}`} aria-busy="true">
        <p className={styles.notice}>{t("page.loading")}</p>
      </section>
    );
  }

  return (
    <section className={`fade-in ${styles.page}`}>
      <TeamHeader team={team} />
      <ModerationLogoBar team={team} onChanged={refresh} />
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
        <div className="ds-section-title purple">
          <h2 id="team-stats-title">{t("page.statsTitle")}</h2>
        </div>
        <StatsPanel stats={team.stats} accent="violet" ranking={team.ranking} i18n={statsI18n} />
      </section>

      <TeamHistory tournaments={team.tournaments} />
    </section>
  );
}
