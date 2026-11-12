"use client";

import { FormEvent, useState } from "react";
import { PlayerLink } from "@/components/entity-link";
import { UserAvatar } from "@/components/user-avatar";
import { formatLocalDate } from "@/lib/shared/dates";
import { shownEntityName } from "@/lib/shared/entity-fallback-name";
import type { TeamMember, TeamRole, TeamSentInvitation } from "@/lib/shared/types";
import { sortTeamMembers } from "@/lib/shared/team-role-display";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { PLAYER_PSEUDO_FIELD_ERRORS } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { useTeamPageText } from "@/components/i18n/team-page-text";
import { useMemberManagement } from "../_hooks/useMemberManagement";
import { RolesDialog, type RolesDialogTarget } from "./RolesDialog";
import { RolePills } from "./RolePills";
import { InviteRolesDialog } from "./InviteRolesDialog";
import { MyRolesBlock } from "./MyRolesBlock";
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
  /** Pseudo dont la modale des rôles d'invitation est ouverte. */
  const [inviteTarget, setInviteTarget] = useState<string | null>(null);
  const [rolesTarget, setRolesTarget] = useState<RolesDialogTarget | null>(null);
  const [kickTarget, setKickTarget] = useState<TeamMember | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const { t, locale } = useTeamPageText();
  // Un pseudo ancien fait de caractères invisibles se lit « Joueur #id » partout, noms accessibles compris.
  const playerName = (pseudo: string, userId: number) => shownEntityName(pseudo, "player", userId, locale);
  const fieldErrors = useFieldErrors(PLAYER_PSEUDO_FIELD_ERRORS, INVITE_FIELD_IDS);

  const refreshAll = () => {
    onChanged();
    onInvitationsChanged();
  };
  const { addMember, removeMember, updateRoles, updateOwnRoles, cancelInvitation } = useMemberManagement(
    teamId,
    refreshAll,
  );

  const sortedMembers = sortTeamMembers(members);
  const viewerMember = members.find((member) => member.userId === viewerUserId) ?? null;
  const canInvite = memberPseudo.trim().length > 0 && inviteTarget === null;

  // Premier temps : le pseudo seul. Les rôles se choisissent dans la modale
  // (`InviteRolesDialog`) — inline, on les prenait pour les siens.
  const invite = (event: FormEvent) => {
    event.preventDefault();
    if (!canInvite) return;
    fieldErrors.clear();
    setInviteTarget(memberPseudo.trim());
  };

  const sendInvitation = async (pseudo: string, roles: TeamRole[]): Promise<boolean> => {
    let pseudoRefused = false;
    // Un pseudo refusé (introuvable, déjà invité…) est signalé sur le champ :
    // la modale se ferme pour le montrer, et le champ reprend le focus sans
    // rouvrir ses suggestions. Les autres refus gardent la modale ouverte.
    const ok = await addMember(pseudo, roles, (code, message) => {
      pseudoRefused = fieldErrors.report(code, message);
    });
    // Refus : la saisie reste, pour corriger une faute de frappe sans tout
    // retaper.
    if (ok) setMemberPseudo("");
    if (ok || pseudoRefused) setInviteTarget(null);
    return ok;
  };

  const withdraw = async (invitation: TeamSentInvitation) => {
    if (cancellingId === invitation.id) return;
    setCancellingId(invitation.id);
    await cancelInvitation(invitation.id, playerName(invitation.pseudo, invitation.userId));
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
                      <RolePills roles={member.roles} label={t("members.rolesOf", { pseudo: playerName(member.pseudo, member.userId) })} />
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
                            aria-label={t("members.editRolesLabel", { pseudo: playerName(member.pseudo, member.userId) })}
                            onClick={() =>
                              setRolesTarget({
                                userId: member.userId,
                                pseudo: playerName(member.pseudo, member.userId),
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
                            aria-label={t("members.kickLabel", { pseudo: playerName(member.pseudo, member.userId) })}
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

        {viewerMember ? (
          <MyRolesBlock
            // Rôles changés ailleurs (modale de la gestion) : le bloc repart
            // de ceux qui sont enregistrés.
            key={viewerMember.roles.toString()}
            roles={viewerMember.roles}
            onSave={updateOwnRoles}
          />
        ) : null}

        {canManage ? (
          <form onSubmit={invite} className={styles.divider} aria-labelledby="team-invite-title">
            <h3 id="team-invite-title" className={styles.subTitle}>
              {t("members.inviteTitle")}
            </h3>
            <div className={styles.inviteRow}>
              <div className="field">
                {/* Qui est proposé et quand le joueur rejoint : derrière le « i »,
                    toujours cité par le champ (INFO_HINTS.md). */}
                <InfoHintRow>
                  <label htmlFor="team-invite-pseudo">{t("members.pseudo")}</label>
                  <InfoHint id="team-invite-help" subject={t("members.pseudo")}>
                    <p>{t("members.inviteHelp")}</p>
                  </InfoHint>
                </InfoHintRow>
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
              </div>
            </div>
            <div className={styles.formFooter}>
              {/* Jamais `disabled` : champ vide comme modale ouverte, le
                  bouton garde le focus clavier (`aria-disabled`) ; le
                  gestionnaire ignore tout envoi hors `canInvite`. */}
              <button
                type="submit"
                className={`btn ${styles.primaryButton}`}
                aria-disabled={!canInvite || undefined}
              >
                {t("members.invite")}
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
                    <RolePills roles={invitation.roles} label={t("members.proposedRoles", { pseudo: playerName(invitation.pseudo, invitation.userId) })} />
                    <span className={styles.pendingDate}>
                      {t("members.sentOn", { date: formatLocalDate(invitation.createdAt, locale) })}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={`btn ghost ${styles.smallButton}`}
                    aria-disabled={cancellingId === invitation.id || undefined}
                    aria-busy={cancellingId === invitation.id || undefined}
                    aria-label={t("members.withdrawLabel", { pseudo: playerName(invitation.pseudo, invitation.userId) })}
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

      {inviteTarget === null ? null : (
        <InviteRolesDialog
          pseudo={inviteTarget}
          onClose={() => setInviteTarget(null)}
          onConfirm={(roles) => sendInvitation(inviteTarget, roles)}
        />
      )}

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
          title={t("members.kickTitle", { pseudo: playerName(kickTarget.pseudo, kickTarget.userId) })}
          confirmLabel={t("members.kick")}
          pendingLabel={t("members.kickPending")}
          onClose={() => setKickTarget(null)}
          onConfirm={async () => {
            const ok = await removeMember(kickTarget.userId, playerName(kickTarget.pseudo, kickTarget.userId));
            if (ok) setKickTarget(null);
            return ok;
          }}
        >
          <p>{t("members.kickBody", { pseudo: playerName(kickTarget.pseudo, kickTarget.userId), team: teamName })}</p>
        </ConfirmActionDialog>
      ) : null}
    </>
  );
}
