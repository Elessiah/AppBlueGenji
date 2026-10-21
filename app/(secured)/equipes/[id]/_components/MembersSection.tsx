"use client";

import { FormEvent, useState } from "react";
import { PlayerLink } from "@/components/entity-link";
import { UserAvatar } from "@/components/user-avatar";
import { formatLocalDate } from "@/lib/shared/dates";
import type { TeamMember, TeamRole, TeamSentInvitation } from "@/lib/shared/types";
import { DEFAULT_INVITE_ROLES, sortTeamMembers } from "@/lib/shared/team-role-display";
import { useToast } from "@/components/ui/toast";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { PLAYER_PSEUDO_FIELD_ERRORS } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { useTeamErrorMessage } from "@/components/i18n/team-errors-text";
import { useTeamPageText } from "@/components/i18n/team-page-text";
import { useMemberManagement } from "../_hooks/useMemberManagement";
import { RolesDialog, type RolesDialogTarget } from "./RolesDialog";
import { RolePills } from "./RolePills";
import { RolePicker } from "./RolePicker";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { PlayerPseudoCombobox } from "./PlayerPseudoCombobox";
import styles from "../team.module.css";

const INVITE_FIELD_IDS = { pseudo: "team-invite-pseudo" } as const;

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
}: Readonly<MembersSectionProps>) {
  const [memberPseudo, setMemberPseudo] = useState("");
  const [memberRoles, setMemberRoles] = useState<TeamRole[]>([...DEFAULT_INVITE_ROLES]);
  const [inviting, setInviting] = useState(false);
  const [rolesTarget, setRolesTarget] = useState<RolesDialogTarget | null>(null);
  const [kickTarget, setKickTarget] = useState<TeamMember | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const { showError } = useToast();
  const { t, locale } = useTeamPageText();
  const teamErrorMessage = useTeamErrorMessage();
  const fieldErrors = useFieldErrors(PLAYER_PSEUDO_FIELD_ERRORS, INVITE_FIELD_IDS);

  const refreshAll = () => {
    onChanged();
    onInvitationsChanged();
  };
  const { addMember, removeMember, updateRoles, cancelInvitation } = useMemberManagement(teamId, refreshAll);

  const sortedMembers = sortTeamMembers(members);
  const canInvite = memberPseudo.trim().length > 0 && !inviting;

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    if (!canInvite) return;
    fieldErrors.clear();
    // Refus dit en notification, pas par un bouton grisé muet.
    if (memberRoles.length === 0) {
      showError(teamErrorMessage("MISSING_ROLE"));
      return;
    }
    setInviting(true);
    // Un pseudo refusé (introuvable, déjà invité…) est signalé sur le champ,
    // qui reprend le focus sans rouvrir ses suggestions.
    const ok = await addMember(memberPseudo.trim(), memberRoles, fieldErrors.report);
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
        <div className={`ds-section-title purple ${styles.sectionHead}`}>
          <h2 id="team-members-title">{t("members.title")}</h2>
          <span className={styles.count}>{t("members.count", { count: members.length })}</span>
        </div>

        {members.length === 0 ? (
          <p className={styles.empty}>{t("members.empty")}</p>
        ) : (
          <div className={styles.roster} role="table" aria-label={t("members.rosterLabel", { team: teamName })}>
            <div role="rowgroup">
              <div
                role="row"
                className={`${styles.rosterRow} ${styles.rosterHeader} ${canManage ? styles.withActions : ""}`}
              >
                <span role="columnheader">{t("members.column.player")}</span>
                <span role="columnheader">{t("members.column.roles")}</span>
                <span role="columnheader">{t("members.column.joined")}</span>
                {canManage ? (
                  <span role="columnheader" className={styles.visuallyHidden}>
                    {t("members.column.actions")}
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
                        borderColor="rgba(var(--violet-400-rgb), 0.35)"
                        decorative
                      />
                      <PlayerLink userId={member.userId} className={styles.playerName} truncate>
                        {member.pseudo}
                      </PlayerLink>
                      {isViewer ? <span className={styles.youTag}>{t("members.you")}</span> : null}
                    </span>
                    <span role="cell">
                      <RolePills roles={member.roles} label={t("members.rolesOf", { pseudo: member.pseudo })} />
                    </span>
                    <span role="cell" className={styles.joinedAt}>
                      <span className={styles.cellLabel}>{t("members.joinedOnLabel")}</span>{" "}
                      {formatLocalDate(member.joinedAt, locale)}
                    </span>
                    {canManage ? (
                      <span role="cell" className={styles.rowActions}>
                        {canEditRoles ? (
                          <button
                            type="button"
                            className={`btn ${styles.smallButton}`}
                            aria-label={t("members.editRolesLabel", { pseudo: member.pseudo })}
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
                            {t("members.editRoles")}
                          </button>
                        ) : null}
                        {canKick ? (
                          <button
                            type="button"
                            className={`btn ghost ${styles.smallButton} ${styles.dangerButton}`}
                            aria-label={t("members.kickLabel", { pseudo: member.pseudo })}
                            onClick={() => setKickTarget(member)}
                          >
                            {t("members.kick")}
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
              {t("members.inviteTitle")}
            </h3>
            <div className={styles.inviteGrid}>
              <div className="field">
                <label htmlFor="team-invite-pseudo">{t("members.pseudo")}</label>
                <PlayerPseudoCombobox
                  id={INVITE_FIELD_IDS.pseudo}
                  value={memberPseudo}
                  onChange={(value) => {
                    setMemberPseudo(value);
                    fieldErrors.clear("pseudo");
                  }}
                  placeholder={t("members.pseudoPlaceholder")}
                  aria={fieldErrors.aria("pseudo", "team-invite-help")}
                  excludeUserIds={invitations.map((inv) => inv.userId)}
                />
                <FieldErrorText fieldId={INVITE_FIELD_IDS.pseudo} message={fieldErrors.message("pseudo")} />
                <p id="team-invite-help" className={styles.help}>
                  {t("members.inviteHelp")}
                </p>
              </div>
              <RolePicker selected={memberRoles} onChange={setMemberRoles} />
            </div>
            <div className={styles.formFooter}>
              <button type="submit" className={`btn ${styles.primaryButton}`} disabled={!canInvite}>
                {inviting ? t("members.sending") : t("members.invite")}
              </button>
            </div>
          </form>
        ) : null}

        {canManage && invitations.length > 0 ? (
          <div className={styles.divider}>
            <h3 className={styles.subTitle}>{t("members.pendingTitle", { count: invitations.length })}</h3>
            <ul className={styles.pendingList}>
              {invitations.map((invitation) => (
                <li key={invitation.id} className={styles.pendingItem}>
                  <span className={styles.pendingMain}>
                    <PlayerLink userId={invitation.userId}>{invitation.pseudo}</PlayerLink>
                    <RolePills roles={invitation.roles} label={t("members.proposedRoles", { pseudo: invitation.pseudo })} />
                    <span className={styles.pendingDate}>
                      {t("members.sentOn", { date: formatLocalDate(invitation.createdAt, locale) })}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={`btn ghost ${styles.smallButton}`}
                    disabled={cancellingId === invitation.id}
                    aria-label={t("members.withdrawLabel", { pseudo: invitation.pseudo })}
                    onClick={() => void withdraw(invitation)}
                  >
                    {cancellingId === invitation.id ? t("members.withdrawing") : t("members.withdraw")}
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
        <ConfirmActionDialog
          title={t("members.kickTitle", { pseudo: kickTarget.pseudo })}
          confirmLabel={t("members.kick")}
          pendingLabel={t("members.kickPending")}
          onClose={() => setKickTarget(null)}
          onConfirm={async () => {
            const ok = await removeMember(kickTarget.userId, kickTarget.pseudo);
            if (ok) setKickTarget(null);
            return ok;
          }}
        >
          <p>{t("members.kickBody", { pseudo: kickTarget.pseudo, team: teamName })}</p>
        </ConfirmActionDialog>
      ) : null}
    </>
  );
}
