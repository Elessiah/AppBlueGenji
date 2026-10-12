"use client";

import { useState } from "react";
import type { TeamDetailResponse, TeamJoinRequest } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { PlayerLink } from "@/components/entity-link";
import { formatLocalDate } from "@/lib/shared/dates";
import { useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useMembershipErrorMessage, useTeamErrorMessage } from "@/components/i18n/team-errors-text";
import { useTeamPageText } from "@/components/i18n/team-page-text";
import { jsonRequest, teamApi } from "../_lib/team-api";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import styles from "../team.module.css";

interface MembershipActionsProps {
  team: TeamDetailResponse;
  /** Demandes d'adhésion reçues (vue gestion) — vide pour les autres lecteurs. */
  requests: TeamJoinRequest[];
  onChanged: () => void;
  onRequestsChanged: () => void;
}

export function MembershipActions({ team, requests, onChanged, onRequestsChanged }: Readonly<MembershipActionsProps>) {
  const { showError, showSuccess } = useToast();
  const router = useLocaleRouter();
  const { t, locale } = useTeamPageText();
  const teamErrorMessage = useTeamErrorMessage();
  const membershipErrorMessage = useMembershipErrorMessage();
  const teamId = team.team.id;
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  /**
   * Un geste, qui rend son message de succès, et sa traduction d'erreur. Rend
   * l'issue pour que la modale de départ ne se ferme que sur un succès.
   */
  const act = async (
    request: () => Promise<string>,
    translate: (code: string) => string,
  ): Promise<boolean> => {
    setBusy(true);
    try {
      showSuccess(await request());
      onChanged();
      // La barre de navigation vient de la mise en page serveur de l'espace
      // connecté, que l'App Router ne rejoue pas d'une page à l'autre : sans
      // ce rafraîchissement, elle garderait l'état d'avant jusqu'au F5.
      router.refresh();
      onRequestsChanged();
      return true;
    } catch (e) {
      showError(translate((e as Error).message));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const join = () =>
    act(
      async () => {
        const payload = await teamApi<{ result?: "REQUESTED" | "JOINED" }>(
          `/api/teams/${teamId}/join`,
          { method: "POST" },
          "TEAM_JOIN_FAILED",
        );
        return payload.result === "JOINED" ? t("membership.joined") : t("membership.requested");
      },
      membershipErrorMessage,
    );

  const declineInvitation = () =>
    team.viewerInvitationId === null
      ? Promise.resolve(false)
      : act(
          async () => {
            await teamApi(`/api/invitations/${team.viewerInvitationId}`, jsonRequest("POST", { accept: false }), "INVITATION_RESPOND_FAILED");
            return t("membership.declined");
          },
          membershipErrorMessage,
        );

  // Reprise d'une fantôme : acceptée **par l'identifiant de l'invitation**, et
  // non par « Rejoindre » (`/join`). Sur une page restée ouverte pendant qu'un
  // autre joueur reprenait l'équipe, `/join` verrait une équipe ordinaire sans
  // invitation et y déposerait une demande d'adhésion ; l'invitation, elle, a
  // été annulée par cette reprise et répond `INVITATION_NOT_PENDING`.
  const acceptGhostClaim = () =>
    team.viewerInvitationId === null
      ? Promise.resolve(false)
      : act(
          async () => {
            await teamApi(`/api/invitations/${team.viewerInvitationId}`, jsonRequest("POST", { accept: true }), "INVITATION_RESPOND_FAILED");
            return t("membership.claimAccepted");
          },
          membershipErrorMessage,
        );

  const withdrawRequest = () =>
    team.viewerInvitationId === null
      ? Promise.resolve(false)
      : act(
          async () => {
            await teamApi(`/api/invitations/${team.viewerInvitationId}`, { method: "DELETE" }, "INVITATION_CANCEL_FAILED");
            return t("membership.withdrawn");
          },
          membershipErrorMessage,
        );

  const leave = () =>
    act(
      async () => {
        await teamApi(`/api/teams/${teamId}/leave`, { method: "POST" }, "TEAM_LEAVE_FAILED");
        return t("membership.left");
      },
      membershipErrorMessage,
    );

  const respondRequest = (request: TeamJoinRequest, accept: boolean) =>
    act(
      async () => {
        await teamApi(`/api/invitations/${request.id}`, jsonRequest("POST", { accept }), "INVITATION_RESPOND_FAILED");
        return accept
          ? t("membership.requestAccepted", { pseudo: request.pseudo })
          : t("membership.requestRefused", { pseudo: request.pseudo });
      },
      // Accepter la demande d'un autre : `USER_ALREADY_IN_TEAM` parle de lui.
      teamErrorMessage,
    );

  if (team.team.deletedAt) {
    return (
      <div className={`ds-block ${styles.block}`}>
        <p className={styles.notice}>{t("membership.dissolved")}</p>
      </div>
    );
  }

  // Équipe fantôme : aucun joueur à qui adresser une demande d'adhésion. Le
  // seul chemin vers un roster réel est la **reprise** que le staff propose à
  // un joueur — et que ce joueur accepte ici ou depuis son profil. Elle ne se
  // fait jamais sans lui : engagé d'office, il verrait ses contacts ouverts à
  // l'arbitrage d'un tournoi qu'il n'a pas choisi.
  if (team.team.isGhost) {
    return (
      <div className={`ds-block ${styles.block}`}>
        {team.viewerInvitation === "INVITED" ? (
          <div className={styles.actionsRow}>
            <p className={styles.notice}>{t("membership.ghostClaimOffer")}</p>
            <button
              type="button"
              className={`btn ${styles.primaryButton}`}
              onClick={() => void acceptGhostClaim()}
              disabled={busy || team.viewerInvitationId === null}
            >
              {t("membership.takeOver")}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void declineInvitation()}
              disabled={busy || team.viewerInvitationId === null}
            >
              {t("membership.decline")}
            </button>
          </div>
        ) : (
          <p className={styles.notice}>{t("membership.ghostNotice")}</p>
        )}
      </div>
    );
  }

  // Sans demande en cours : rejoindre sur invitation, ou demander à rejoindre.
  const joinPrompt =
    team.viewerInvitation === "INVITED" ? (
      <div className={styles.actionsRow}>
        <p className={styles.notice}>{t("membership.invited")}</p>
        <button type="button" className={`btn ${styles.primaryButton}`} onClick={() => void join()} disabled={busy}>
          {t("membership.join")}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => void declineInvitation()}
          disabled={busy || team.viewerInvitationId === null}
        >
          {t("membership.decline")}
        </button>
      </div>
    ) : (
      <button type="button" className={`btn ${styles.primaryButton}`} onClick={() => void join()} disabled={busy}>
        {t("membership.requestToJoin")}
      </button>
    );

  return (
    <>
      {team.viewerMembership === "NONE" && (
        <div className={`ds-block ${styles.block}`}>
          {team.viewerInvitation === "REQUESTED" ? (
            <div className={styles.actionsRow}>
              <p className={styles.notice}>{t("membership.requestPending")}</p>
              <button
                type="button"
                className={`btn ghost ${styles.smallButton}`}
                onClick={() => void withdrawRequest()}
                disabled={busy || team.viewerInvitationId === null}
              >
                {t("membership.withdrawRequest")}
              </button>
            </div>
          ) : (
            joinPrompt
          )}
        </div>
      )}

      {team.viewerMembership === "MEMBER" && (
        <div className={`ds-block ${styles.block} ${styles.leaveBlock}`}>
          <button type="button" className="btn ghost" onClick={() => setConfirmLeave(true)} disabled={busy}>
            {t("membership.leave")}
          </button>
        </div>
      )}

      {team.canManage && requests.length > 0 && (
        <section className={`ds-block ${styles.block}`} aria-labelledby="team-requests-title">
          <div className="ds-section-title purple">
            <h2 id="team-requests-title">{t("membership.requestsTitle", { count: requests.length })}</h2>
          </div>
          <ul className={styles.pendingList}>
            {requests.map((r) => (
              <li key={r.id} className={styles.pendingItem}>
                <span className={styles.pendingMain}>
                  <PlayerLink userId={r.userId}>{r.pseudo}</PlayerLink>
                  <span className={styles.pendingDate}>
                    {t("membership.receivedOn", { date: formatLocalDate(r.createdAt, locale) })}
                  </span>
                </span>
                <span className={styles.rowActions}>
                  <button
                    type="button"
                    className={`btn ${styles.smallButton}`}
                    onClick={() => void respondRequest(r, true)}
                    disabled={busy}
                    aria-label={t("membership.acceptLabel", { pseudo: r.pseudo })}
                  >
                    {t("membership.accept")}
                  </button>
                  <button
                    type="button"
                    className={`btn ghost ${styles.smallButton}`}
                    onClick={() => void respondRequest(r, false)}
                    disabled={busy}
                    aria-label={t("membership.refuseLabel", { pseudo: r.pseudo })}
                  >
                    {t("membership.refuse")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.help}>{t("membership.acceptedRoleHint")}</p>
        </section>
      )}

      {confirmLeave ? (
        <ConfirmActionDialog
          title={t("membership.leaveTitle")}
          confirmLabel={t("membership.leaveConfirm")}
          pendingLabel={t("membership.leavePending")}
          onClose={() => setConfirmLeave(false)}
          onConfirm={async () => {
            const ok = await leave();
            if (ok) setConfirmLeave(false);
            return ok;
          }}
        >
          <p>{t("membership.leaveBody", { team: team.team.name })}</p>
        </ConfirmActionDialog>
      ) : null}
    </>
  );
}
