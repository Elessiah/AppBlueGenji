"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TeamDetailResponse, TeamJoinRequest } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { PlayerLink } from "@/components/entity-link";
import { formatLocalDate } from "@/lib/shared/dates";
import { membershipErrorMessage, teamErrorMessage } from "../../_lib/team-errors";
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
  const router = useRouter();
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
        return payload.result === "JOINED" ? "Tu as rejoint l'équipe !" : "Demande envoyée à l'équipe.";
      },
      membershipErrorMessage,
    );

  const declineInvitation = () =>
    team.viewerInvitationId === null
      ? Promise.resolve(false)
      : act(
          async () => {
            await teamApi(`/api/invitations/${team.viewerInvitationId}`, jsonRequest("POST", { accept: false }), "INVITATION_RESPOND_FAILED");
            return "Invitation déclinée.";
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
            return "Tu es désormais propriétaire de l'équipe.";
          },
          membershipErrorMessage,
        );

  const withdrawRequest = () =>
    team.viewerInvitationId === null
      ? Promise.resolve(false)
      : act(
          async () => {
            await teamApi(`/api/invitations/${team.viewerInvitationId}`, { method: "DELETE" }, "INVITATION_CANCEL_FAILED");
            return "Demande retirée.";
          },
          membershipErrorMessage,
        );

  const leave = () =>
    act(
      async () => {
        await teamApi(`/api/teams/${teamId}/leave`, { method: "POST" }, "TEAM_LEAVE_FAILED");
        return "Tu as quitté l'équipe.";
      },
      membershipErrorMessage,
    );

  const respondRequest = (request: TeamJoinRequest, accept: boolean) =>
    act(
      async () => {
        await teamApi(`/api/invitations/${request.id}`, jsonRequest("POST", { accept }), "INVITATION_RESPOND_FAILED");
        return accept ? `${request.pseudo} a rejoint l'équipe.` : `Demande de ${request.pseudo} refusée.`;
      },
      // Accepter la demande d'un autre : `USER_ALREADY_IN_TEAM` parle de lui.
      teamErrorMessage,
    );

  if (team.team.deletedAt) {
    return (
      <div className={`ds-block ${styles.block}`}>
        <p className={styles.notice}>
          🛑 Équipe dissoute — ses statistiques et son historique restent consultables, mais elle
          ne peut plus être rejointe ni administrée.
        </p>
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
            <p className={styles.notice}>
              👻 Le staff te propose de reprendre cette équipe fantôme&nbsp;: en acceptant, tu en
              deviens propriétaire, historique de tournois compris.
            </p>
            <button
              type="button"
              className={`btn ${styles.primaryButton}`}
              onClick={() => void acceptGhostClaim()}
              disabled={busy || team.viewerInvitationId === null}
            >
              Reprendre l&apos;équipe
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void declineInvitation()}
              disabled={busy || team.viewerInvitationId === null}
            >
              Décliner
            </button>
          </div>
        ) : (
          <p className={styles.notice}>
            👻 Équipe fantôme — créée par le staff pour les tournois, sans joueur rattaché. Elle ne
            peut pas être rejointe&nbsp;: seul le staff peut la proposer à un joueur.
          </p>
        )}
      </div>
    );
  }

  // Sans demande en cours : rejoindre sur invitation, ou demander à rejoindre.
  const joinPrompt =
    team.viewerInvitation === "INVITED" ? (
      <div className={styles.actionsRow}>
        <p className={styles.notice}>Tu as reçu une invitation pour cette équipe.</p>
        <button type="button" className={`btn ${styles.primaryButton}`} onClick={() => void join()} disabled={busy}>
          Rejoindre
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => void declineInvitation()}
          disabled={busy || team.viewerInvitationId === null}
        >
          Décliner
        </button>
      </div>
    ) : (
      <button type="button" className={`btn ${styles.primaryButton}`} onClick={() => void join()} disabled={busy}>
        Demander à rejoindre l&apos;équipe
      </button>
    );

  return (
    <>
      {team.viewerMembership === "NONE" && (
        <div className={`ds-block ${styles.block}`}>
          {team.viewerInvitation === "REQUESTED" ? (
            <div className={styles.actionsRow}>
              <p className={styles.notice}>
                Demande envoyée — en attente de validation par la gestion de l&apos;équipe.
              </p>
              <button
                type="button"
                className={`btn ghost ${styles.smallButton}`}
                onClick={() => void withdrawRequest()}
                disabled={busy || team.viewerInvitationId === null}
              >
                Retirer ma demande
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
            Quitter l&apos;équipe
          </button>
        </div>
      )}

      {team.canManage && requests.length > 0 && (
        <section className={`ds-block ${styles.block}`} aria-labelledby="team-requests-title">
          <div className="ds-section-title purple">
            <h2 id="team-requests-title">Demandes d&apos;adhésion ({requests.length})</h2>
          </div>
          <ul className={styles.pendingList}>
            {requests.map((r) => (
              <li key={r.id} className={styles.pendingItem}>
                <span className={styles.pendingMain}>
                  <PlayerLink userId={r.userId}>{r.pseudo}</PlayerLink>
                  <span className={styles.pendingDate}>reçue le {formatLocalDate(r.createdAt)}</span>
                </span>
                <span className={styles.rowActions}>
                  <button
                    type="button"
                    className={`btn ${styles.smallButton}`}
                    onClick={() => void respondRequest(r, true)}
                    disabled={busy}
                    aria-label={`Accepter la demande de ${r.pseudo}`}
                  >
                    Accepter
                  </button>
                  <button
                    type="button"
                    className={`btn ghost ${styles.smallButton}`}
                    onClick={() => void respondRequest(r, false)}
                    disabled={busy}
                    aria-label={`Refuser la demande de ${r.pseudo}`}
                  >
                    Refuser
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.help}>Un joueur accepté arrive avec le rôle DPS : ajuste-le ensuite dans le roster.</p>
        </section>
      )}

      {confirmLeave ? (
        <ConfirmActionDialog
          title="Quitter l'équipe ?"
          confirmLabel="Quitter"
          pendingLabel="Départ…"
          onClose={() => setConfirmLeave(false)}
          onConfirm={async () => {
            const ok = await leave();
            if (ok) setConfirmLeave(false);
            return ok;
          }}
        >
          <p>
            Tu quittes le roster de {team.team.name}. Tes matchs joués avec l&apos;équipe restent à
            ton palmarès ; pour revenir, il faudra une nouvelle invitation ou une demande acceptée.
          </p>
        </ConfirmActionDialog>
      ) : null}
    </>
  );
}
