"use client";

import { useId, useState } from "react";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useToast } from "@/components/ui/toast";
import { ModerationReasonField, isModerationReasonReady } from "@/components/moderation/ModerationReasonField";
import {
  SUSPENSION_DURATION_PRESETS,
  SUSPENSION_GROUNDS,
  SUSPENSION_GROUND_DEFINITIONS,
  suspensionErrorMessage,
  suspensionReference,
  suspensionSpan,
  type SuspensionGround,
} from "@/lib/shared/account-suspension";
import { moderationReasonErrorMessage } from "@/lib/shared/logo-quarantine";
import type { FullProfileResponse } from "@/lib/shared/types";
import styles from "../player.module.css";

/**
 * Bandeau de modération de la fiche d'un joueur (permission `moderation`) :
 * retrait de l'avatar — même geste que `ModerationLogoBar` sur la fiche
 * d'équipe — et suspension du compte (`lib/shared/account-suspension.ts`).
 *
 * Les deux gestes sont des décisions motivées : le **motif** saisi est envoyé
 * au joueur avec la décision (DSA, art. 17). Rien n'est rendu pour un compte
 * supprimé, ni hors modération (`canModerate`, dont découlent les deux
 * drapeaux du profil).
 */
export function PlayerModerationBar({
  profile,
  deleted,
  onChanged,
}: Readonly<{
  profile: FullProfileResponse;
  deleted: boolean;
  onChanged: () => void;
}>) {
  const [dialog, setDialog] = useState<"avatar" | "suspend" | "lift" | null>(null);
  const suspension = profile.moderationSuspension;
  const showAvatar = profile.moderationAvatarPresent;
  const showSuspension = suspension !== null || profile.moderationSuspendable;

  if (deleted || !profile.canModerate || (!showAvatar && !showSuspension)) return null;

  const close = () => setDialog(null);
  const done = () => {
    setDialog(null);
    onChanged();
  };

  return (
    <fieldset className={`native-group ${styles.moderationBar}`} aria-label="Modération">
      <span className={styles.moderationLabel}>MODÉRATION</span>
      {suspension && (
        <span className={styles.moderationStatus}>
          Compte suspendu {suspensionSpan(suspension.endsAt)} ({suspensionReference(suspension.id)})
        </span>
      )}
      {showAvatar && (
        <button type="button" className="btn ghost" onClick={() => setDialog("avatar")}>
          Retirer l&apos;avatar
        </button>
      )}
      {suspension ? (
        <button type="button" className="btn ghost" onClick={() => setDialog("lift")}>
          Lever la suspension
        </button>
      ) : (
        profile.moderationSuspendable && (
          <button type="button" className="btn ghost" onClick={() => setDialog("suspend")}>
            Suspendre le compte
          </button>
        )
      )}
      {dialog === "avatar" && <AvatarRemovalDialog profile={profile} onClose={close} onDone={done} />}
      {dialog === "suspend" && <SuspendDialog profile={profile} onClose={close} onDone={done} />}
      {dialog === "lift" && suspension && (
        <LiftDialog profile={profile} reference={suspensionReference(suspension.id)} onClose={close} onDone={done} />
      )}
    </fieldset>
  );
}

/** Appel JSON d'une route de modération ; rend le code du refus, ou `null`. */
async function moderationRequest(url: string, method: "POST" | "DELETE", body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return null;
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return payload.error || "FAILED";
  } catch {
    return "NETWORK_ERROR";
  }
}

function avatarErrorMessage(code: string): string {
  switch (code) {
    case "USER_NOT_FOUND":
      return "Ce compte n'existe plus.";
    case "USER_HAS_NO_AVATAR":
      return "Ce joueur n'a déjà plus d'avatar.";
    case "MODERATION_REASON_REQUIRED":
    case "MODERATION_REASON_TOO_LONG":
      return moderationReasonErrorMessage(code);
    default:
      return "L'avatar n'a pas pu être retiré. Réessaie dans un instant.";
  }
}

function AvatarRemovalDialog({
  profile,
  onClose,
  onDone,
}: Readonly<{
  profile: FullProfileResponse;
  onClose: () => void;
  onDone: () => void;
}>) {
  const { showError, showSuccess } = useToast();
  const [reason, setReason] = useState("");
  const pseudo = profile.profile.pseudo;
  return (
    <ConfirmActionDialog
      title={`Retirer l'avatar de ${pseudo} ?`}
      confirmLabel="Retirer l'avatar"
      pendingLabel="Retrait…"
      disabled={!isModerationReasonReady(reason)}
      focusContent
      closeOnSuccess={false}
      onClose={onClose}
      onConfirm={async () => {
        const error = await moderationRequest(`/api/admin/users/${profile.profile.id}/avatar`, "DELETE", { reason });
        if (error) {
          showError(avatarErrorMessage(error));
          return false;
        }
        showSuccess("Avatar retiré. Le joueur s'affiche désormais avec l'initiale de son pseudo.");
        onDone();
        return true;
      }}
    >
      <p>
        L&apos;avatar de « {pseudo} » est effacé du site et de la sauvegarde des images. Le joueur garde tout le
        reste ; il pourra en envoyer un autre.
      </p>
      <ModerationReasonField value={reason} onChange={setReason} recipient="le joueur" />
    </ConfirmActionDialog>
  );
}

function SuspendDialog({
  profile,
  onClose,
  onDone,
}: Readonly<{
  profile: FullProfileResponse;
  onClose: () => void;
  onDone: () => void;
}>) {
  const { showError, showSuccess } = useToast();
  const groundId = useId();
  const durationId = useId();
  const [reason, setReason] = useState("");
  const [ground, setGround] = useState<SuspensionGround | "">("");
  // Rien de présélectionné : la durée, la sanction elle-même, se choisit.
  const [duration, setDuration] = useState<string>("");
  const pseudo = profile.profile.pseudo;
  const ready = isModerationReasonReady(reason) && ground !== "" && duration !== "";

  return (
    <ConfirmActionDialog
      title={`Suspendre le compte de ${pseudo} ?`}
      confirmLabel="Suspendre le compte"
      pendingLabel="Suspension…"
      disabled={!ready}
      focusContent
      closeOnSuccess={false}
      onClose={onClose}
      onConfirm={async () => {
        const error = await moderationRequest(`/api/admin/users/${profile.profile.id}/suspension`, "POST", {
          reason,
          ground,
          durationDays: duration === "indefinite" ? null : Number(duration),
        });
        if (error) {
          showError(suspensionErrorMessage(error));
          return false;
        }
        showSuccess("Compte suspendu. Ses sessions sont fermées et le joueur est prévenu.");
        onDone();
        return true;
      }}
    >
      <p>
        Toutes les sessions de « {pseudo} » sont fermées et aucune connexion n&apos;est possible tant que la
        suspension court. Le joueur reçoit la décision, les faits retenus, la clause invoquée et le moyen de la
        contester.
      </p>
      <ModerationReasonField value={reason} onChange={setReason} recipient="le joueur" />
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor={groundId}>Clause des conditions d&apos;utilisation</label>
        <select id={groundId} value={ground} onChange={(event) => setGround(event.target.value as SuspensionGround)}>
          <option value="" disabled>
            Choisir…
          </option>
          {SUSPENSION_GROUNDS.map((value) => (
            <option key={value} value={value}>
              {SUSPENSION_GROUND_DEFINITIONS[value].label}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor={durationId}>Durée</label>
        <select id={durationId} value={duration} onChange={(event) => setDuration(event.target.value)}>
          <option value="" disabled>
            Choisir…
          </option>
          {SUSPENSION_DURATION_PRESETS.map((days) =>
            days === null ? (
              <option key="indefinite" value="indefinite">
                Durée indéterminée (jusqu&apos;à levée)
              </option>
            ) : (
              <option key={days} value={String(days)}>
                {days} jour{days > 1 ? "s" : ""}
              </option>
            ),
          )}
        </select>
      </div>
    </ConfirmActionDialog>
  );
}

function LiftDialog({
  profile,
  reference,
  onClose,
  onDone,
}: Readonly<{
  profile: FullProfileResponse;
  reference: string;
  onClose: () => void;
  onDone: () => void;
}>) {
  const { showError, showSuccess } = useToast();
  return (
    <ConfirmActionDialog
      title="Lever la suspension ?"
      confirmLabel="Lever la suspension"
      pendingLabel="Levée…"
      closeOnSuccess={false}
      onClose={onClose}
      onConfirm={async () => {
        const error = await moderationRequest(`/api/admin/users/${profile.profile.id}/suspension`, "DELETE");
        if (error) {
          showError(suspensionErrorMessage(error));
          return false;
        }
        showSuccess("Suspension levée. Le joueur peut de nouveau se connecter et en est prévenu.");
        onDone();
        return true;
      }}
    >
      <p>
        La suspension {reference} de « {profile.profile.pseudo} » prend fin maintenant : le joueur peut de nouveau
        se connecter, et il en est prévenu.
      </p>
    </ConfirmActionDialog>
  );
}
