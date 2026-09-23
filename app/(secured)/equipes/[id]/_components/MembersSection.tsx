"use client";

import { FormEvent, useState } from "react";
import { PlayerLink } from "@/components/entity-link";
import { UserAvatar } from "@/components/user-avatar";
import { formatLocalDate } from "@/lib/shared/dates";
import type { TeamMember, TeamRole, TeamSentInvitation } from "@/lib/shared/types";
import { DEFAULT_INVITE_ROLES, sortTeamMembers } from "@/lib/shared/team-role-display";
import { useMemberManagement } from "../_hooks/useMemberManagement";
import { RolesDialog, type RolesDialogTarget } from "./RolesDialog";
import { RolePills } from "./RolePills";
import { RolePicker } from "./RolePicker";
import { ConfirmDialog } from "./ConfirmDialog";
import { PlayerPseudoCombobox } from "./PlayerPseudoCombobox";
import styles from "../team.module.css";

interface MembersSectionProps {
  teamId: number;
  teamName: string;
  members: TeamMember[];
  /** Le lecteur gère le roster (propriétaire ou manager d'une équipe réelle). */
  canManage: boolean;
  viewerUserId: number;
  invitations: TeamSentInvitation[];
  onChanged: () => void;
  onInvitationsChanged: () => void;
}

export function MembersSection({
  teamId,
  teamName,
  members,
  canManage,
  viewerUserId,
  invitations,
  onChanged,
  onInvitationsChanged,
}: MembersSectionProps) {
  const [memberPseudo, setMemberPseudo] = useState("");
  const [memberRoles, setMemberRoles] = useState<TeamRole[]>([...DEFAULT_INVITE_ROLES]);
  const [inviting, setInviting] = useState(false);
  const [rolesTarget, setRolesTarget] = useState<RolesDialogTarget | null>(null);
  const [kickTarget, setKickTarget] = useState<TeamMember | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const refreshAll = () => {
    onChanged();
    onInvitationsChanged();
  };
  const { addMember, removeMember, updateRoles, cancelInvitation } = useMemberManagement(teamId, refreshAll);

  const sortedMembers = sortTeamMembers(members);
  const canInvite = memberPseudo.trim().length > 0 && memberRoles.length > 0 && !inviting;

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    if (!canInvite) return;
    setInviting(true);
    const ok = await addMember(memberPseudo.trim(), memberRoles);
    setInviting(false);
    // Refus : la saisie reste, pour corriger une faute de frappe sans tout
    // retaper.
    if (ok) {
      setMemberPseudo("");
      setMemberRoles([...DEFAULT_INVITE_ROLES]);
    }
  };

  const withdraw = async (invitation: TeamSentInvitation) => {
    setCancellingId(invitation.id);
    await cancelInvitation(invitation.id, invitation.pseudo);
    setCancellingId(null);
  };

  return (
    <>
      <section
        className={`ds-block ${styles.block} ${canManage ? styles.overflowBlock : ""}`}
        aria-labelledby="team-members-title"
      >
        <div className={`ds-section-title orange ${styles.sectionHead}`}>
          <h2 id="team-members-title">Membres</h2>
          <span className={styles.count}>
            {members.length} {members.length > 1 ? "joueurs" : "joueur"}
          </span>
        </div>

        {members.length === 0 ? (
          <p className={styles.empty}>Aucun joueur dans cette équipe.</p>
        ) : (
          <div className={styles.roster} role="table" aria-label={`Roster de ${teamName}`}>
            <div role="rowgroup">
              <div
                role="row"
                className={`${styles.rosterRow} ${styles.rosterHeader} ${canManage ? styles.withActions : ""}`}
              >
                <span role="columnheader">Joueur</span>
                <span role="columnheader">Rôles</span>
                <span role="columnheader">Arrivée</span>
                {canManage ? (
                  <span role="columnheader" className={styles.visuallyHidden}>
                    Actions
                  </span>
                ) : null}
              </div>
            </div>
            <div role="rowgroup">
              {sortedMembers.map((member) => {
                const isOwner = member.roles.includes("OWNER");
                const isViewer = member.userId === viewerUserId;
                // Le serveur refuse qu'un manager touche aux rôles du
                // propriétaire ; le propriétaire, lui, édite les siens.
                const canEditRoles = !isOwner || isViewer;
                // Ni le propriétaire ni soi-même ne s'excluent : on quitte, on
                // transfère.
                const canKick = !isOwner && !isViewer;
                return (
                  <div
                    role="row"
                    key={member.membershipId}
                    className={`${styles.rosterRow} ${canManage ? styles.withActions : ""} ${isViewer ? styles.viewerRow : ""}`}
                  >
                    <span role="cell" className={styles.player}>
                      <UserAvatar
                        src={member.avatarUrl}
                        pseudo={member.pseudo}
                        size={28}
                        borderWidth={1}
                        borderColor="rgba(255,157,46,0.3)"
                        decorative
                      />
                      <PlayerLink userId={member.userId} className={styles.playerName}>
                        {member.pseudo}
                      </PlayerLink>
                      {isViewer ? <span className={styles.youTag}>Toi</span> : null}
                    </span>
                    <span role="cell">
                      <RolePills roles={member.roles} label={`Rôles de ${member.pseudo}`} />
                    </span>
                    <span role="cell" className={styles.joinedAt}>
                      <span className={styles.cellLabel}>Arrivée le </span>
                      {formatLocalDate(member.joinedAt)}
                    </span>
                    {canManage ? (
                      <span role="cell" className={styles.rowActions}>
                        {canEditRoles ? (
                          <button
                            type="button"
                            className={`btn ${styles.smallButton}`}
                            aria-label={`Modifier les rôles de ${member.pseudo}`}
                            onClick={() =>
                              setRolesTarget({
                                userId: member.userId,
                                pseudo: member.pseudo,
                                isOwner,
                                isViewer,
                                selected: member.roles.filter((r) => r !== "OWNER"),
                              })
                            }
                          >
                            Rôles
                          </button>
                        ) : null}
                        {canKick ? (
                          <button
                            type="button"
                            className={`btn ghost ${styles.smallButton} ${styles.dangerButton}`}
                            aria-label={`Exclure ${member.pseudo}`}
                            onClick={() => setKickTarget(member)}
                          >
                            Exclure
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {canManage ? (
          <form onSubmit={invite} className={styles.divider} aria-labelledby="team-invite-title">
            <h3 id="team-invite-title" className={styles.subTitle}>
              Inviter un joueur
            </h3>
            <div className={styles.inviteGrid}>
              <div className="field">
                <label htmlFor="team-invite-pseudo">Pseudo du joueur</label>
                <PlayerPseudoCombobox
                  id="team-invite-pseudo"
                  value={memberPseudo}
                  onChange={setMemberPseudo}
                  placeholder="Commence à taper un pseudo…"
                  describedBy="team-invite-help"
                  excludeUserIds={invitations.map((inv) => inv.userId)}
                />
                <p id="team-invite-help" className={styles.help}>
                  Seuls les joueurs sans équipe sont proposés. Le joueur rejoint l&apos;équipe quand
                  il accepte l&apos;invitation — tout de suite s&apos;il l&apos;avait lui-même demandé.
                </p>
              </div>
              <RolePicker selected={memberRoles} onChange={setMemberRoles} />
            </div>
            <div className={styles.formFooter}>
              {memberRoles.length === 0 ? (
                <span className={styles.help} role="status">
                  Choisis au moins un rôle.
                </span>
              ) : null}
              <button type="submit" className={`btn ${styles.primaryButton}`} disabled={!canInvite}>
                {inviting ? "Envoi…" : "Inviter"}
              </button>
            </div>
          </form>
        ) : null}

        {canManage && invitations.length > 0 ? (
          <div className={styles.divider}>
            <h3 className={styles.subTitle}>Invitations en attente ({invitations.length})</h3>
            <ul className={styles.pendingList}>
              {invitations.map((invitation) => (
                <li key={invitation.id} className={styles.pendingItem}>
                  <span className={styles.pendingMain}>
                    <PlayerLink userId={invitation.userId}>{invitation.pseudo}</PlayerLink>
                    <RolePills roles={invitation.roles} label={`Rôles proposés à ${invitation.pseudo}`} />
                    <span className={styles.pendingDate}>
                      envoyée le {formatLocalDate(invitation.createdAt)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={`btn ghost ${styles.smallButton}`}
                    disabled={cancellingId === invitation.id}
                    aria-label={`Retirer l'invitation de ${invitation.pseudo}`}
                    onClick={() => void withdraw(invitation)}
                  >
                    {cancellingId === invitation.id ? "Retrait…" : "Retirer"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {rolesTarget ? (
        <RolesDialog
          target={rolesTarget}
          onClose={() => setRolesTarget(null)}
          onSave={async (selected) => {
            const ok = await updateRoles(rolesTarget.userId, selected);
            if (ok) setRolesTarget(null);
            return ok;
          }}
        />
      ) : null}

      {kickTarget ? (
        <ConfirmDialog
          title={`Exclure ${kickTarget.pseudo} ?`}
          confirmLabel="Exclure"
          pendingLabel="Exclusion…"
          onClose={() => setKickTarget(null)}
          onConfirm={async () => {
            const ok = await removeMember(kickTarget.userId, kickTarget.pseudo);
            if (ok) setKickTarget(null);
            return ok;
          }}
        >
          <p>
            {kickTarget.pseudo} quitte le roster de {teamName} immédiatement. Ses matchs joués avec
            l&apos;équipe restent acquis, et une nouvelle invitation reste possible.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
