"use client";

import { useRef, useState } from "react";
import type { TeamDetailResponse, TeamJoinRequest } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { PlayerLink } from "@/components/entity-link";
import { formatLocalDate } from "@/lib/shared/dates";
import { useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useMembershipErrorMessage, useTeamErrorMessage } from "@/components/i18n/team-errors-text";
import { useTeamPageText } from "@/components/i18n/team-page-text";
import { jsonRequest, teamApi } from "../_lib/team-api";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { BusyButton } from "@/components/ui/busy-button";
import { useBusyGuard } from "@/lib/shared/hooks/useBusyGuard";
import { useFocusRescue } from "@/lib/shared/hooks/useFocusRescue";
import { armedRescueSelector, neighbourRescueSelectors } from "@/lib/shared/focus-rescue";
import { gestureState } from "@/lib/shared/gesture-state";
import styles from "../team.module.css";

interface MembershipActionsProps {
  team: TeamDetailResponse;
  /** Demandes d'adhésion reçues (vue gestion) — vide pour les autres lecteurs. */
  requests: TeamJoinRequest[];
  onChanged: () => void;
  onRequestsChanged: () => void;
}

/** Repli du focus après un geste : le premier geste encore actif du bloc. */
const MEMBERSHIP_RESCUE = [armedRescueSelector("membership"), '[data-focus-rescue="membership"]'] as const;

export function MembershipActions({ team, requests, onChanged, onRequestsChanged }: Readonly<MembershipActionsProps>) {
  const { showError, showSuccess } = useToast();
  const router = useLocaleRouter();
  const { t, locale } = useTeamPageText();
  const teamErrorMessage = useTeamErrorMessage();
  const membershipErrorMessage = useMembershipErrorMessage();
  const teamId = team.team.id;
  // Un geste à la fois (garde synchrone) ; seul le bouton pressé s'annonce
  // occupé (`pendingGesture`), les autres sont refusés sans attente annoncée.
  const { busy, run, whenIdle } = useBusyGuard();
  const [pendingGesture, setPendingGesture] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Le bouton pressé disparaît souvent au retour (« Rejoindre » devient
  // « Retirer ma demande », une demande traitée quitte la liste) : le focus,
  // tombé sur la page, revient au premier geste **actif** du bloc
  // (`data-focus-rescue="membership"`) — une demande traitée, au **même**
  // bouton de sa voisine (« Refuser » après un refus, jamais « Accepter »).
  // Suivi de `team` et `requests` : rien ne se rend avant leur relecture — la
  // fenêtre de départ, fermée avant, rend d'abord le focus à « Quitter ».
  const rootRef = useRef<HTMLDivElement>(null);
  const rescueFocus = useFocusRescue(rootRef, [team, requests]);
  /** État d'un bouton : occupé s'il est le geste en cours, refusé si un autre l'est (`gestureState`). */
  const gesture = (name: string) => gestureState(pendingGesture, name);
  /** Geste qui répond à l'invitation du lecteur : refusé aussi sans invitation connue. */
  const gestureWithInvitation = (name: string) => {
    const state = gesture(name);
    return { ...state, blocked: state.blocked || team.viewerInvitationId === null };
  };
  /**
   * Geste sur l'invitation du lecteur (`gestureWithInvitation` le refuse déjà
   * au clic sans invitation) : la seule garde du code, l'URL n'est jamais bâtie sur `null`.
   */
  const actOnInvitation = (name: string, request: (invitationId: number) => Promise<string>) => {
    const invitationId = team.viewerInvitationId;
    return invitationId === null ? Promise.resolve(false) : act(name, () => request(invitationId), membershipErrorMessage);
  };

  /**
   * Un geste, qui rend son message de succès, et sa traduction d'erreur. Rend
   * l'issue pour que la modale de départ ne se ferme que sur un succès.
   */
  const act = async (
    name: string,
    request: () => Promise<string>,
    translate: (code: string) => string,
    rescue: readonly string[] = MEMBERSHIP_RESCUE,
  ): Promise<boolean> => {
    // Les boutons restent focalisables pendant un geste (`aria-disabled`) : la
    // garde synchrone (`run`) écarte le second clic parti avant le rendu.
    const outcome = await run(async () => {
      setPendingGesture(name);
      try {
        showSuccess(await request());
        rescueFocus(rescue);
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
        setPendingGesture(null);
      }
    });
    return outcome ?? false;
  };

  const join = () =>
    act(
      "join",
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
    actOnInvitation("decline", async (invitationId) => {
      await teamApi(`/api/invitations/${invitationId}`, jsonRequest("POST", { accept: false }), "INVITATION_RESPOND_FAILED");
      return t("membership.declined");
    });

  // Reprise d'une fantôme : acceptée **par l'identifiant de l'invitation**, et
  // non par « Rejoindre » (`/join`). Sur une page restée ouverte pendant qu'un
  // autre joueur reprenait l'équipe, `/join` verrait une équipe ordinaire sans
  // invitation et y déposerait une demande d'adhésion ; l'invitation, elle, a
  // été annulée par cette reprise et répond `INVITATION_NOT_PENDING`.
  const acceptGhostClaim = () =>
    actOnInvitation("takeOver", async (invitationId) => {
      await teamApi(`/api/invitations/${invitationId}`, jsonRequest("POST", { accept: true }), "INVITATION_RESPOND_FAILED");
      return t("membership.claimAccepted");
    });

  const withdrawRequest = () =>
    actOnInvitation("withdrawRequest", async (invitationId) => {
      await teamApi(`/api/invitations/${invitationId}`, { method: "DELETE" }, "INVITATION_CANCEL_FAILED");
      return t("membership.withdrawn");
    });

  const leave = () =>
    act(
      "leave",
      async () => {
        await teamApi(`/api/teams/${teamId}/leave`, { method: "POST" }, "TEAM_LEAVE_FAILED");
        return t("membership.left");
      },
      membershipErrorMessage,
    );

  const respondRequest = (request: TeamJoinRequest, accept: boolean) => {
    // Ordre affiché avant la réponse : la demande voisine reçoit le focus.
    const keys = requests.map((pending) => pending.id);
    return act(
      `${accept ? "accept" : "refuse"}-${request.id}`,
      async () => {
        await teamApi(`/api/invitations/${request.id}`, jsonRequest("POST", { accept }), "INVITATION_RESPOND_FAILED");
        return accept
          ? t("membership.requestAccepted", { pseudo: request.pseudo })
          : t("membership.requestRefused", { pseudo: request.pseudo });
      },
      // Accepter la demande d'un autre : `USER_ALREADY_IN_TEAM` parle de lui.
      teamErrorMessage,
      [...neighbourRescueSelectors(accept ? "request-accept" : "request-refuse", keys, request.id), ...MEMBERSHIP_RESCUE],
    );
  };

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
      <div ref={rootRef} className={styles.contents}>
        <div className={`ds-block ${styles.block}`}>
          {team.viewerInvitation === "INVITED" ? (
            <div className={styles.actionsRow}>
              <p className={styles.notice}>{t("membership.ghostClaimOffer")}</p>
              <BusyButton
                className={`btn ${styles.primaryButton}`}
                data-focus-rescue="membership"
                onClick={() => void acceptGhostClaim()}
                {...gestureWithInvitation("takeOver")}
              >
                {t("membership.takeOver")}
              </BusyButton>
              <BusyButton
                className="btn ghost"
                data-focus-rescue="membership"
                onClick={() => void declineInvitation()}
                {...gestureWithInvitation("decline")}
              >
                {t("membership.decline")}
              </BusyButton>
            </div>
          ) : (
            <p className={styles.notice}>{t("membership.ghostNotice")}</p>
          )}
        </div>
      </div>
    );
  }

  // Sans demande en cours : rejoindre sur invitation, ou demander à rejoindre.
  const joinPrompt =
    team.viewerInvitation === "INVITED" ? (
      <div className={styles.actionsRow}>
        <p className={styles.notice}>{t("membership.invited")}</p>
        <BusyButton
          className={`btn ${styles.primaryButton}`}
          data-focus-rescue="membership"
          onClick={() => void join()}
          {...gesture("join")}
        >
          {t("membership.join")}
        </BusyButton>
        <BusyButton
          className="btn ghost"
          data-focus-rescue="membership"
          onClick={() => void declineInvitation()}
          {...gestureWithInvitation("decline")}
        >
          {t("membership.decline")}
        </BusyButton>
      </div>
    ) : (
      <BusyButton
          className={`btn ${styles.primaryButton}`}
          data-focus-rescue="membership"
          onClick={() => void join()}
          {...gesture("join")}
        >
        {t("membership.requestToJoin")}
      </BusyButton>
    );

  // `display: contents` : le conteneur du secours de focus ne change rien à la mise en page.
  return (
    <div ref={rootRef} className={styles.contents}>
      {team.viewerMembership === "NONE" && (
        <div className={`ds-block ${styles.block}`}>
          {team.viewerInvitation === "REQUESTED" ? (
            <div className={styles.actionsRow}>
              <p className={styles.notice}>{t("membership.requestPending")}</p>
              <BusyButton
                className={`btn ghost ${styles.smallButton}`}
                data-focus-rescue="membership"
                onClick={() => void withdrawRequest()}
                {...gestureWithInvitation("withdrawRequest")}
              >
                {t("membership.withdrawRequest")}
              </BusyButton>
            </div>
          ) : (
            joinPrompt
          )}
        </div>
      )}

      {team.viewerMembership === "MEMBER" && (
        <div className={`ds-block ${styles.block} ${styles.leaveBlock}`}>
          <BusyButton
            className="btn ghost"
            data-focus-rescue="membership"
            busy={false}
            blocked={busy}
            onClick={whenIdle(() => setConfirmLeave(true))}
          >
            {t("membership.leave")}
          </BusyButton>
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
                  <BusyButton
                    className={`btn ${styles.smallButton}`}
                    data-focus-rescue="request-accept"
                    data-focus-rescue-key={r.id}
                    onClick={() => void respondRequest(r, true)}
                    {...gesture(`accept-${r.id}`)}
                    aria-label={t("membership.acceptLabel", { pseudo: r.pseudo })}
                  >
                    {t("membership.accept")}
                  </BusyButton>
                  <BusyButton
                    className={`btn ghost ${styles.smallButton}`}
                    data-focus-rescue="request-refuse"
                    data-focus-rescue-key={r.id}
                    onClick={() => void respondRequest(r, false)}
                    {...gesture(`refuse-${r.id}`)}
                    aria-label={t("membership.refuseLabel", { pseudo: r.pseudo })}
                  >
                    {t("membership.refuse")}
                  </BusyButton>
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
    </div>
  );
}
