"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";
import { Coche } from "@/components/Coche";
import type { FullProfileResponse } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";

const VISIBILITY_LABELS: Record<string, string> = {
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
  const [isAdult, setIsAdult] = useState<string>("unknown");
  const [deleting, setDeleting] = useState(false);
  const [visibility, setVisibility] = useState({
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

  useEffect(() => {
    loadInvitations();
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
      setVisibility({ overwatch: !!v.overwatch, marvel: !!v.marvel, major: !!v.major });
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
        }),
      });
      const payload = (await response.json()) as FullProfileResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "PROFILE_UPDATE_FAILED");
      setData(payload);
      showSuccess("Profil mis à jour.");
    } catch (e) {
      showError((e as Error).message);
    }
  };

  const onDeleteAccount = async () => {
    if (!window.confirm(
      "Supprimer définitivement ton compte ? Tes informations personnelles seront effacées (le compte devient anonyme), mais tes statistiques resteront conservées. Cette action est irréversible.",
    )) {
      return;
    }
    setDeleting(true);
    try {
      const response = await fetch("/api/profile", { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "ACCOUNT_DELETE_FAILED");
      showSuccess("Compte supprimé. Tes statistiques restent conservées de façon anonyme.");
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
      if (!response.ok) throw new Error(payload.error || "AVATAR_UPLOAD_FAILED");
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
      <div className="ds-header">
        <div className="ds-header-body" style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Image
            className="avatar"
            src={data.profile.avatarUrl || "/vercel.svg"}
            alt={data.profile.pseudo}
            width={60}
            height={60}
            unoptimized
            referrerPolicy="no-referrer"
            style={{ width: 60, height: 60, borderRadius: "50%", border: "2px solid rgba(89,212,255,0.35)" }}
          />
          <div>
            <h1 className="ds-title blue" style={{ fontSize: "clamp(28px, 3vw, 42px)", marginBottom: 6 }}>
              Mon profil
            </h1>
            <p style={{ color: "var(--text-2)", margin: 0, fontSize: 14 }}>
              Informations personnelles masquées par défaut
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
            </div>
            <div className="field">
              <label>Tag Marvel Rivals</label>
              <input value={marvelRivalsTag} onChange={(e) => setMarvelRivalsTag(e.target.value)} />
            </div>
            <div className="field">
              <label>Pseudo Discord</label>
              <input value={discordPseudo} onChange={(e) => setDiscordPseudo(e.target.value)} placeholder="pseudo#0000 ou @pseudo" />
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

      {invitations.length > 0 && (
        <div className="ds-block" style={{ marginBottom: 20 }}>
          <div className="ds-section-title blue">
            <h2>Invitations d&apos;équipe ({invitations.length})</h2>
          </div>
          <div className="table-like">
            {invitations.map((inv) => (
              <div className="table-row" key={inv.id} style={{ alignItems: "center" }}>
                <span>{inv.teamName}</span>
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
        <LogoutButton />
      </div>
    </section>
  );
}
