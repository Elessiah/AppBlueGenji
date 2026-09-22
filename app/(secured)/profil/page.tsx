"use client";

import { UserAvatar } from "@/components/user-avatar";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";
import { Coche } from "@/components/Coche";
import type { FullProfileResponse } from "@/lib/shared/types";
import {
  accountDeletedWriteMessage,
  accountDeletionConfirmation,
  accountDeletionErrorMessage,
  accountDeletionOutcome,
  RETENTION_UNKNOWN,
  type AccountDeletionPlan,
  type AccountRetentionReason,
  type ConfirmationSubject,
} from "@/lib/shared/account-deletion";
import { useToast } from "@/components/ui/toast";
import { TeamLink } from "@/components/entity-link";
import { VerifiedBadge } from "@/components/discord-tag";
import { DiscordVerificationDialog } from "./DiscordVerificationDialog";
import { ConnectedAppsSection } from "./ConnectedAppsSection";

// Le pseudo n'est plus masquable : identité de base du joueur sur la plateforme.
const VISIBILITY_LABELS: Record<string, string> = {
  avatar: "Avatar",
  overwatch: "BattleTag OW",
  marvel: "Tag Marvel",
  major: "Majorité",
};

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export default function ProfilePage() {
  const router = useRouter();
  const { showError, showSuccess } = useToast();
  const [data, setData] = useState<FullProfileResponse | null>(null);

  const [pseudo, setPseudo] = useState("");
  const [overwatchBattletag, setOverwatchBattletag] = useState("");
  const [marvelRivalsTag, setMarvelRivalsTag] = useState("");
  const [discordPseudo, setDiscordPseudo] = useState("");
  // État Discord du compte, lu à part du formulaire : la certification porte sur
  // ce qui est **enregistré**, pas sur ce qui est en train d'être tapé. Un champ
  // modifié sans être sauvegardé ne doit ni gagner ni perdre la pastille.
  const [discordState, setDiscordState] = useState<{
    tag: string | null;
    verified: boolean;
    linked: boolean;
  }>({ tag: null, verified: false, linked: false });
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [isAdult, setIsAdult] = useState<string>("unknown");
  const [deleting, setDeleting] = useState(false);
  const [openToRecruitment, setOpenToRecruitment] = useState(true);
  const [visibility, setVisibility] = useState({
    avatar: false,
    overwatch: false,
    marvel: false,
    major: false,
  });
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [invitations, setInvitations] = useState<{ id: number; teamId: number; teamName: string }[]>([]);

  const loadInvitations = async () => {
    try {
      const res = await fetch("/api/me/invitations", { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as { invitations?: { id: number; teamId: number; teamName: string }[] };
      setInvitations(payload.invitations ?? []);
    } catch {
      // silencieux
    }
  };

  const loadDiscordState = async () => {
    try {
      const res = await fetch("/api/profile/discord", { cache: "no-store" });
      if (!res.ok) return;
      setDiscordState((await res.json()) as { tag: string | null; verified: boolean; linked: boolean });
    } catch {
      // silencieux : le formulaire reste utilisable sans la pastille.
    }
  };

  useEffect(() => {
    loadInvitations();
    loadDiscordState();
  }, []);

  const respondInvitation = async (invitationId: number, accept: boolean) => {
    try {
      const res = await fetch(`/api/invitations/${invitationId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "INVITATION_RESPOND_FAILED");
      showSuccess(accept ? "Invitation acceptée." : "Invitation refusée.");
      await loadInvitations();
    } catch (e) {
      showError((e as Error).message);
    }
  };

  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/profile", { cache: "no-store" });
      const payload = (await response.json()) as FullProfileResponse & { error?: string };
      if (!response.ok) {
        const errorCode = payload.error || "PROFILE_LOAD_FAILED";
        if (errorCode === "PROFILE_NOT_FOUND") {
          showError(errorCode);
          setTimeout(() => router.push("/"), 1500);
          return;
        }
        throw new Error(errorCode);
      }
      setData(payload);
      setPseudo(payload.profile.pseudo);
      setOverwatchBattletag(payload.profile.overwatchBattletag || "");
      setMarvelRivalsTag(payload.profile.marvelRivalsTag || "");
      setDiscordPseudo(payload.profile.discordPseudo || "");
      setIsAdult(payload.profile.isAdult === null ? "unknown" : payload.profile.isAdult ? "yes" : "no");
      const v = payload.profile.visibility;
      setOpenToRecruitment(payload.profile.openToRecruitment !== false);
      setVisibility({
        avatar: !!v.avatar,
        overwatch: !!v.overwatch,
        marvel: !!v.marvel,
        major: !!v.major,
      });
    };
    load().catch((e) => showError((e as Error).message));
  }, [showError, router]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pseudo,
          overwatchBattletag: overwatchBattletag.trim() ? overwatchBattletag.trim() : null,
          marvelRivalsTag: marvelRivalsTag.trim() ? marvelRivalsTag.trim() : null,
          discordPseudo: discordPseudo.trim() ? discordPseudo.trim() : null,
          isAdult: isAdult === "unknown" ? null : isAdult === "yes",
          visibility,
          openToRecruitment,
        }),
      });
      const payload = (await response.json()) as FullProfileResponse & { error?: string };
      if (!response.ok) {
        throw new Error(accountDeletedWriteMessage(payload.error, "PROFILE_UPDATE_FAILED"));
      }
      setData(payload);
      // Une sauvegarde qui change le tag **annule la certification** côté
      // serveur : la pastille doit tomber dans le même geste, sinon l'écran
      // annonce une exposition qui n'existe plus.
      await loadDiscordState();
      showSuccess("Profil mis à jour.");
    } catch (e) {
      showError((e as Error).message);
    }
  };

  const onDeleteAccount = async () => {
    // Le bouton se ferme **avant** l'aller-retour d'aperçu, et non après la
    // confirmation : `window.confirm` bloquait à lui seul le second clic tant
    // qu'il était la première instruction, mais un `await` posé devant lui
    // rouvre la fenêtre — deux clics, deux confirmations, deux `DELETE`, dont
    // le second échoue en 400 et affiche une erreur juste après le succès.
    if (deleting) return;
    setDeleting(true);

    // Le motif est demandé avant la confirmation : « effacé » et « anonymisé »
    // ne sont pas la même promesse, et « tes statistiques restent » ne veut
    // rien dire à qui n'en a aucune. Le serveur repose la question à l'écriture
    // — ceci informe, cela tranche.
    //
    // Tant que l'aperçu n'a pas répondu, l'écran ne sait **rien** — pas même
    // lequel des deux modes s'appliquera. Il partait d'une hypothèse
    // (`TOURNAMENTS`), qu'il gardait quand la requête échouait : le joueur
    // consentait alors à devenir anonyme et pouvait être effacé entièrement.
    // Sur un geste irréversible, on décrit l'incertitude plutôt que d'inventer
    // la moitié rassurante.
    let subject: ConfirmationSubject = RETENTION_UNKNOWN;
    let previewed: AccountRetentionReason | null = null;
    try {
      const preview = await fetch("/api/profile/deletion", { cache: "no-store" });
      if (preview.ok) {
        previewed = ((await preview.json()) as AccountDeletionPlan).reason;
        subject = previewed;
      }
    } catch {
      // Injoignable : la phrase qui ne promet ni conservation ni effacement.
    }
    if (!window.confirm(accountDeletionConfirmation(subject))) {
      setDeleting(false);
      return;
    }

    try {
      const response = await fetch("/api/profile", { method: "DELETE" });
      const payload = (await response.json()) as { error?: string } & Partial<AccountDeletionPlan>;
      // Le corps porte un **code**, pas une phrase : la traduction vit dans le
      // module pur, et un code inconnu retombe sur la phrase générique plutôt
      // que de s'afficher tel quel.
      if (!response.ok) throw new Error(accountDeletionErrorMessage(payload.error));
      // `reason` vaut `null` sur un effacement complet : c'est une réponse, pas
      // une absence de réponse. Le `mode` sert donc de témoin — il dit que le
      // serveur a bien répondu, là où un `??` sur le motif retomberait sur
      // l'aperçu au moment précis où le serveur annonce qu'il n'a rien gardé.
      const applied = payload.mode ? payload.reason ?? null : previewed;
      showSuccess(accountDeletionOutcome(applied));
      setTimeout(() => {
        window.location.href = "/";
      }, 1200);
    } catch (e) {
      showError((e as Error).message);
      setDeleting(false);
    }
  };

  const onAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES) {
      showError("Image trop lourde ou format non supporté");
      return;
    }

    setAvatarBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as { avatarUrl?: string | null; error?: string };
      if (!response.ok) {
        throw new Error(accountDeletedWriteMessage(payload.error, "AVATAR_UPLOAD_FAILED"));
      }
      setData((prev) =>
        prev ? { ...prev, profile: { ...prev.profile, avatarUrl: payload.avatarUrl ?? null } } : prev,
      );
      showSuccess("Avatar mis à jour.");
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setAvatarBusy(false);
    }
  };

  const onAvatarDelete = async () => {
    setAvatarBusy(true);
    try {
      const response = await fetch("/api/profile/avatar", { method: "DELETE" });
      const payload = (await response.json()) as { avatarUrl?: string | null; error?: string };
      if (!response.ok) throw new Error(payload.error || "AVATAR_DELETE_FAILED");
      setData((prev) =>
        prev ? { ...prev, profile: { ...prev.profile, avatarUrl: null } } : prev,
      );
      showSuccess("Avatar supprimé.");
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setAvatarBusy(false);
    }
  };

  if (!data) return <section className="ds-block" style={{ color: "var(--text-2)" }}>Chargement du profil...</section>;

  return (
    <section className="fade-in">
      {verifyOpen && (
        <DiscordVerificationDialog
          initialTag={discordPseudo}
          linked={discordState.linked}
          onClose={() => setVerifyOpen(false)}
          onVerified={(tag) => {
            setVerifyOpen(false);
            setDiscordPseudo(tag);
            setDiscordState((prev) => ({ ...prev, tag, verified: true, linked: true }));
          }}
        />
      )}
      <div className="ds-header">
        <div className="ds-header-body" style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <UserAvatar
            src={data.profile.avatarUrl}
            pseudo={data.profile.pseudo}
            size={60}
          />
          <div>
            <h1 className="ds-title blue" style={{ fontSize: "clamp(28px, 3vw, 42px)", marginBottom: 6 }}>
              Mon profil
            </h1>
            <p style={{ color: "var(--text-2)", margin: 0, fontSize: 14 }}>
              Pseudo et avatar publics par défaut — chaque information reste masquable
            </p>
          </div>
        </div>
      </div>

      <div className="ds-block" style={{ marginBottom: 20 }}>
        <div className="ds-section-title blue">
          <h2>Informations</h2>
        </div>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="form-grid">
            <div className="field">
              <label>Pseudo site</label>
              <input value={pseudo} onChange={(e) => setPseudo(e.target.value)} />
            </div>
            <div className="field">
              <label>Avatar</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onAvatarChange}
                style={{ display: "none" }}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  disabled={avatarBusy}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: "9px 18px",
                    fontSize: 13,
                    opacity: avatarBusy ? 0.6 : 1,
                    cursor: avatarBusy ? "not-allowed" : "pointer",
                  }}
                >
                  {avatarBusy ? "Envoi…" : "Changer l'avatar"}
                </button>
                {data?.profile.avatarUrl ? (
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={avatarBusy}
                    onClick={onAvatarDelete}
                    style={{
                      padding: "9px 18px",
                      fontSize: 13,
                      opacity: avatarBusy ? 0.6 : 1,
                      cursor: avatarBusy ? "not-allowed" : "pointer",
                    }}
                  >
                    Supprimer
                  </button>
                ) : null}
              </div>
              <p style={{ fontSize: 11, color: "var(--text-2)", margin: "6px 0 0" }}>
                PNG, JPEG ou WebP — 5 Mo max
              </p>
            </div>
            <div className="field">
              <label>BattleTag Overwatch</label>
              <input value={overwatchBattletag} onChange={(e) => setOverwatchBattletag(e.target.value)} placeholder="Pseudo#1234" />
              <p style={{ fontSize: 11, color: "var(--text-2)", margin: "6px 0 0" }}>
                Sert uniquement à ce que les autres joueurs puissent t&apos;ajouter en jeu — jamais pour des statistiques.
              </p>
            </div>
            <div className="field">
              <label>Tag Marvel Rivals</label>
              <input value={marvelRivalsTag} onChange={(e) => setMarvelRivalsTag(e.target.value)} />
              <p style={{ fontSize: 11, color: "var(--text-2)", margin: "6px 0 0" }}>
                Sert uniquement à ce que les autres joueurs puissent t&apos;ajouter en jeu — jamais pour des statistiques.
              </p>
            </div>
            <div className="field">
              <label htmlFor="profile-discord">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Pseudo Discord
                  {discordState.verified ? <VerifiedBadge /> : null}
                </span>
              </label>
              <input
                id="profile-discord"
                value={discordPseudo}
                onChange={(e) => setDiscordPseudo(e.target.value)}
                placeholder="ton_pseudo"
                aria-describedby="profile-discord-hint"
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setVerifyOpen(true)}
                  /* « Recertifier » seul ne dit pas quoi : le libellé
                     accessible commence par le texte visible (WCAG 2.5.3) et
                     ajoute l'objet. */
                  aria-label={
                    discordState.verified
                      ? "Recertifier mon tag Discord"
                      : "Certifier mon tag Discord"
                  }
                  style={{ padding: "7px 14px", fontSize: 12 }}
                >
                  {discordState.verified ? "Recertifier" : "Certifier mon tag"}
                </button>
              </div>
              <p id="profile-discord-hint" style={{ fontSize: 11, color: "var(--text-2)", margin: "6px 0 0", lineHeight: 1.6 }}>
                {discordState.verified
                  ? "Tag certifié : les administrateurs le voient, et les arbitres pendant tes tournois. Le modifier annule la certification."
                  : "Tag non certifié : personne ne le voit, pas même les administrateurs. Certifie-le pour que l'organisation puisse te joindre pendant un tournoi."}
              </p>
            </div>
            <div className="field">
              <label>Statut majeur</label>
              <select value={isAdult} onChange={(e) => setIsAdult(e.target.value)}>
                <option value="unknown">Non renseigné</option>
                <option value="yes">Oui (18+)</option>
                <option value="no">Non (mineur)</option>
              </select>
            </div>
          </div>

          <div>
            <p
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.09em",
                color: "var(--text-2)",
                margin: "0 0 12px",
              }}
            >
              Visibilité publique
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {Object.entries(visibility).map(([key, value]) => (
                <Coche
                  key={key}
                  label={VISIBILITY_LABELS[key] ?? key}
                  checked={value}
                  theme="joueur"
                  onChange={() =>
                    setVisibility((prev) => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))
                  }
                />
              ))}
            </div>
            <p style={{ fontSize: 11, color: "var(--text-2)", margin: "10px 0 0" }}>
              Ton pseudo reste toujours visible : c&apos;est lui qui t&apos;identifie dans les
              brackets, les rosters et les feuilles de match.
            </p>
          </div>

          <div>
            <p
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.09em",
                color: "var(--text-2)",
                margin: "0 0 12px",
              }}
            >
              Recrutement
            </p>
            <Coche
              label="Ouvert aux propositions d'équipe"
              checked={openToRecruitment}
              theme="joueur"
              onChange={() => setOpenToRecruitment((v) => !v)}
            />
            <p style={{ fontSize: 11, color: "var(--text-2)", margin: "10px 0 0" }}>
              Décoché, tu n&apos;apparais plus dans le filtre « Free agents » de l&apos;annuaire et
              les équipes savent que tu ne souhaites pas être contacté.
            </p>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              className="btn"
              style={{
                padding: "11px 28px",
                background: "rgba(89,212,255,0.15)",
                borderColor: "rgba(89,212,255,0.35)",
              }}
            >
              Sauvegarder
            </button>
          </div>
        </form>
      </div>

      <ConnectedAppsSection onChanged={loadDiscordState} />

      {invitations.length > 0 && (
        <div className="ds-block" style={{ marginBottom: 20 }}>
          <div className="ds-section-title blue">
            <h2>Invitations d&apos;équipe ({invitations.length})</h2>
          </div>
          <div className="table-like">
            {invitations.map((inv) => (
              <div className="table-row" key={inv.id} style={{ alignItems: "center" }}>
                <TeamLink teamId={inv.teamId}>{inv.teamName}</TeamLink>
                <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => respondInvitation(inv.id, true)}
                    style={{ padding: "4px 12px", fontSize: 12 }}
                  >
                    Accepter
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => respondInvitation(inv.id, false)}
                    style={{ padding: "4px 12px", fontSize: 12 }}
                  >
                    Refuser
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ds-block">
        <div className="ds-section-title blue">
          <h2>Statistiques plateforme</h2>
        </div>
        <div className="ds-stats">
          {[
            { label: "Tournois joués", value: data.stats.tournamentsPlayed },
            { label: "Tournois gagnés", value: data.stats.tournamentsWon },
            { label: "Victoires", value: data.stats.matchesWon },
            { label: "Défaites", value: data.stats.matchesLost },
            { label: "Meilleur rang", value: data.stats.bestRank ?? "—" },
          ].map((stat) => (
            <div key={stat.label} className="ds-stat">
              <div className="ds-stat-label">{stat.label}</div>
              <div className="ds-stat-value">{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          paddingTop: 20,
          borderTop: "1px solid var(--line)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a
            href="/api/profile/export"
            download
            className="btn ghost"
            style={{
              padding: "10px 18px",
              fontSize: 13,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            Exporter mes données
          </a>
          <button
            type="button"
            className="btn ghost"
            onClick={onDeleteAccount}
            disabled={deleting}
            style={{
              padding: "10px 18px",
              fontSize: 13,
              color: "var(--red-live, #ff5a6e)",
              borderColor: "rgba(255,90,110,0.4)",
              opacity: deleting ? 0.6 : 1,
              cursor: deleting ? "not-allowed" : "pointer",
            }}
          >
            {deleting ? "Suppression…" : "Supprimer mon compte"}
          </button>
        </div>
        <LogoutButton />
      </div>
    </section>
  );
}
